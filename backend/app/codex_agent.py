"""Answer dashboard chat turns with a local Codex agent (``codex exec``).

Each dashboard agent maps to one Codex session, so later turns resume it and
Codex keeps its own context. Codex runs read-only in the data folder and uses
the MCP tools registered in ``~/.codex/config.toml`` (portal, notifications,
email); this module lets those tools run without an approval prompt.
"""

import json
import shutil
import subprocess

from app.config import settings
from app.data import data_root

CHAT_GUIDANCE = (
    "You are a chat agent in the Linewatch launch-control dashboard for Soony's "
    "Grand Heist 6 launch. Answer briefly and plainly. Your working folder is the "
    "Soony portal data mirror; use the portal tools for fresh data and cite file "
    "paths. Post confirmed problems with the notifications tools. Before sending "
    "any email, show the full draft (recipients, subject, body) and send only "
    "after the user explicitly confirms in a later message."
)
TOOL_SERVERS = ("portal", "notifications", "email")


class CodexError(Exception):
    """Raised when Codex is missing, fails or returns no answer."""


def build_command(executable: str, thread_id: str | None) -> list[str]:
    """Return the ``codex exec`` command for a new or resumed session.

    Args:
        executable: Path to the Codex CLI.
        thread_id: Codex session to resume, or None to start a new one.

    Returns:
        The command; the prompt is passed on standard input.
    """
    options = [
        "--json",
        "--skip-git-repo-check",
        "-c",
        f'model_reasoning_effort="{settings.codex_reasoning_effort}"',
        "-c",
        'sandbox_mode="read-only"',
    ]
    for server in TOOL_SERVERS:
        options += ["-c", f'mcp_servers.{server}.default_tools_approval_mode="approve"']
    if settings.codex_model:
        options += ["-m", settings.codex_model]
    if thread_id:
        return [executable, "exec", "resume", *options, thread_id, "-"]
    return [executable, "exec", *options, "-"]


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
        prompt: The message, including guidance on a session's first turn.
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
            input=prompt.encode("utf-8"),
            capture_output=True,
            cwd=folder,
            timeout=settings.codex_timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise CodexError("Codex took too long to answer.") from error
    reply, new_thread = parse_events(result.stdout.decode("utf-8", "replace"))
    return reply, new_thread or thread_id or ""


def first_prompt(instructions: str, history: list[dict], message: str) -> str:
    """Build the opening prompt for a new Codex session.

    Args:
        instructions: The dashboard agent's own instructions.
        history: Earlier messages (from before Codex), oldest first.
        message: The user's new message.

    Returns:
        Guidance, the agent's instructions, earlier turns and the message.
    """
    parts = [CHAT_GUIDANCE]
    if instructions:
        parts.append(f"Your role: {instructions}")
    if history:
        lines = [f"{m['role']}: {m['content']}" for m in history[-20:]]
        parts.append("Conversation so far:\n" + "\n".join(lines))
    parts.append(f"User: {message}")
    return "\n\n".join(parts)
