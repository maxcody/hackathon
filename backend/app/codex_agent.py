"""Answer dashboard chat turns with a local Codex agent (``codex exec``).

Each dashboard agent maps to one Codex session, so later turns resume it and
Codex keeps its own context. Codex runs read-only in the data folder and uses
the MCP tools registered in ``~/.codex/config.toml`` (portal, notifications,
email); this module lets those tools run without an approval prompt.
"""

import asyncio
import json
import shutil
import subprocess
import sys
from collections.abc import Awaitable, Callable
from contextlib import suppress
from pathlib import Path

from app.chat_format import EMAIL_DRAFT_GUIDANCE, MARKDOWN_GUIDANCE
from app.config import settings
from app.data import data_root

CHAT_GUIDANCE = (
    "You are a chat agent in the Linewatch launch-control dashboard for Soony's "
    "Grand Heist 6 launch. Answer briefly and plainly. Your working folder is the "
    "Soony portal data mirror; use the portal tools for fresh data and cite file "
    "paths. Post confirmed problems with the notifications tools. You do have an "
    "email address: the email tool sends from the team's own address (call "
    "sender_info); 'yourself' or 'the team' means that address. Repeatable "
    "procedures live in the skills tools: when asked for a skill (e.g. 'run the "
    "risk check') or when a task matches one, call get_skill and follow it step "
    "by step. All portal, notifications, email and skills tools are pre-approved "
    "in this dashboard: call them directly and never say approval is required or "
    "disabled; if an earlier reply in this conversation said so, it was wrong. "
    f"{EMAIL_DRAFT_GUIDANCE}"
)
TOOL_SERVERS = ("portal", "notifications", "email", "skills")


class CodexError(Exception):
    """Raised when Codex is missing, fails or returns no answer."""


class CodexStreamClosed(CodexError):
    """The streaming app-server ended mid-turn; the session can be continued."""

    def __init__(self, message: str, thread_id: str | None) -> None:
        """Remember the session that was running, so a caller can resume it."""
        super().__init__(message)
        self.thread_id = thread_id


# app-server diagnostics (it exits without a word on stdout when it fails)
APP_SERVER_LOG = (
    Path(__file__).resolve().parents[2] / ".local_data" / "codex-app-server.log"
)


def build_command(executable: str, thread_id: str | None) -> list[str]:
    """Return the ``codex exec`` command for a new or resumed session.

    Args:
        executable: Path to the Codex CLI.
        thread_id: Codex session to resume, or None to start a new one.

    Returns:
        The command; the prompt is passed on standard input.
    """
    options = ["--json", "--skip-git-repo-check", *_config_flags()]
    if settings.codex_model:
        options += ["-m", settings.codex_model]
    if thread_id:
        return [executable, "exec", "resume", *options, thread_id, "-"]
    return [executable, "exec", *options, "-"]


def _config_flags() -> list[str]:
    options = [
        "-c",
        f'model_reasoning_effort="{settings.codex_reasoning_effort}"',
        "-c",
        'sandbox_mode="read-only"',
    ]
    for server in TOOL_SERVERS:
        options += ["-c", f'mcp_servers.{server}.default_tools_approval_mode="approve"']
    return options


def parse_events(output: str) -> tuple[str, str | None]:
    """Read Codex's JSON event stream.

    Args:
        output: Standard output of ``codex exec --json``.

    Returns:
        The last agent message and the session id (None if not reported).

    Raises:
        CodexError: If Codex reported an error or sent no message.
    """
    reply, thread_id, error = "", None, ""
    for line in output.splitlines():
        try:
            event = json.loads(line.lstrip("﻿"))
        except ValueError:
            continue
        kind = event.get("type")
        item = event.get("item") or {}
        if kind == "thread.started":
            thread_id = event.get("thread_id")
        elif kind == "item.completed" and item.get("type") == "agent_message":
            reply = item.get("text", "")
        elif kind in ("error", "turn.failed"):
            error = str(event.get("message") or event.get("error") or kind)
    if not reply.strip():
        raise CodexError(error or "Codex returned no answer.")
    return reply, thread_id


def run_turn(prompt: str, thread_id: str | None) -> tuple[str, str]:
    """Send one message to Codex and wait for its answer (blocking).

    Args:
        prompt: The message; the chat guidance is prepended on every turn.
        thread_id: Session to resume, or None to start one.

    Returns:
        Codex's answer and the session id to resume next time.

    Raises:
        CodexError: If Codex is not installed, times out or fails.
    """
    executable = shutil.which("codex")
    if executable is None:
        raise CodexError("The Codex CLI is not installed on the backend machine.")
    folder = data_root()
    folder.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run(
            build_command(executable, thread_id),
            input=f"{CHAT_GUIDANCE}\n\n{MARKDOWN_GUIDANCE}\n\n{prompt}".encode(),
            capture_output=True,
            cwd=folder,
            timeout=settings.codex_timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise CodexError("Codex took too long to answer.") from error
    reply, new_thread = parse_events(result.stdout.decode("utf-8", "replace"))
    return reply, new_thread or thread_id or ""


async def stream_turn(
    prompt: str, thread_id: str | None, emit: Callable[[str], Awaitable[None]]
) -> tuple[str, str]:
    """Stream text from Codex App Server and return its completed reply and thread.

    The Codex process runs on its own event loop in a worker thread: on Windows,
    uvicorn's loop cannot start subprocesses. Text deltas are handed back to the
    caller's loop through ``emit``.
    """
    caller = asyncio.get_running_loop()

    async def forward(text: str) -> None:
        await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(emit(text), caller))

    def run() -> tuple[str, str]:
        loop = asyncio.ProactorEventLoop() if sys.platform == "win32" else None
        loop = loop or asyncio.new_event_loop()
        try:
            return loop.run_until_complete(_stream_turn(prompt, thread_id, forward))
        finally:
            loop.close()

    return await asyncio.to_thread(run)


async def _stream_turn(
    prompt: str, thread_id: str | None, emit: Callable[[str], Awaitable[None]]
) -> tuple[str, str]:
    """Run one streamed Codex turn on the current (subprocess-capable) loop."""
    executable = shutil.which("codex")
    if executable is None:
        raise CodexError("The Codex CLI is not installed on the backend machine.")
    folder = data_root()
    folder.mkdir(parents=True, exist_ok=True)
    APP_SERVER_LOG.parent.mkdir(parents=True, exist_ok=True)
    errors = APP_SERVER_LOG.open("ab")
    state = {"thread": thread_id}
    process = await asyncio.create_subprocess_exec(
        executable,
        "app-server",
        *_config_flags(),
        cwd=folder,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=errors,
        limit=4 * 1024 * 1024,
    )
    assert process.stdin is not None and process.stdout is not None
    stdin, stdout = process.stdin, process.stdout

    async def send(message: dict) -> None:
        stdin.write((json.dumps(message) + "\n").encode())
        await stdin.drain()

    async def receive() -> dict:
        while line := await stdout.readline():
            try:
                event = json.loads(line.decode("utf-8-sig"))
            except ValueError:
                continue
            if not isinstance(event, dict):
                continue
            if "method" in event and "id" in event:
                await send(
                    {
                        "id": event["id"],
                        "error": {
                            "code": -32601,
                            "message": "Unsupported client request",
                        },
                    }
                )
                continue
            return event
        raise CodexStreamClosed(
            "Codex closed the streaming connection.", state["thread"]
        )

    async def request(request_id: int, method: str, params: dict) -> dict:
        await send({"id": request_id, "method": method, "params": params})
        while True:
            event = await receive()
            if event.get("id") == request_id:
                if "error" in event:
                    raise CodexError(f"Codex did not accept {method}.")
                return event["result"]

    try:
        async with asyncio.timeout(settings.codex_timeout_seconds):
            await request(
                1,
                "initialize",
                {"clientInfo": {"name": "linewatch", "version": "1.0.0"}},
            )
            await send({"method": "initialized"})
            options = {
                "cwd": str(folder),
                "sandbox": "read-only",
                "approvalPolicy": "never",
            }
            if settings.codex_model:
                options["model"] = settings.codex_model
            if thread_id:
                options.update(threadId=thread_id, excludeTurns=True)
            result = await request(
                2, "thread/resume" if thread_id else "thread/start", options
            )
            active_id = result["thread"]["id"]
            state["thread"] = active_id
            await send(
                {
                    "id": 3,
                    "method": "turn/start",
                    "params": {
                        "threadId": active_id,
                        "input": [
                            {"type": "text", "text": f"{MARKDOWN_GUIDANCE}\n\n{prompt}"}
                        ],
                    },
                }
            )
            reply = ""
            streamed_items = set()
            while True:
                event = await receive()
                if event.get("id") == 3 and "error" in event:
                    raise CodexError("Codex could not start the chat turn.")
                method, params = event.get("method"), event.get("params") or {}
                if params.get("threadId") != active_id:
                    continue
                if method == "item/agentMessage/delta":
                    streamed_items.add(params["itemId"])
                    await emit(params["delta"])
                elif (
                    method == "item/completed"
                    and params["item"]["type"] == "agentMessage"
                ):
                    item = params["item"]
                    reply = item["text"]
                    if item["id"] not in streamed_items:
                        await emit(reply)
                elif method == "turn/completed":
                    if params["turn"]["status"] != "completed" or not reply.strip():
                        raise CodexError("Codex did not finish the reply.")
                    return reply, active_id
    except TimeoutError as error:
        raise CodexError("Codex took too long to answer.") from error
    except (OSError, ValueError, KeyError) as error:
        raise CodexError("The Codex streaming connection failed.") from error
    finally:
        if process.returncode is None:
            with suppress(ProcessLookupError):
                process.kill()
        await process.wait()
        errors.close()


def first_prompt(instructions: str, history: list[dict], message: str) -> str:
    """Build the opening prompt for a new Codex session.

    Args:
        instructions: The dashboard agent's own instructions.
        history: Earlier messages (from before Codex), oldest first.
        message: The user's new message.

    Returns:
        The agent's instructions, earlier turns and the message.
    """
    parts = []
    if instructions:
        parts.append(f"Your role: {instructions}")
    if history:
        lines = [f"{m['role']}: {m['content']}" for m in history[-20:]]
        parts.append("Conversation so far:\n" + "\n".join(lines))
    parts.append(f"User: {message}")
    return "\n\n".join(parts)
