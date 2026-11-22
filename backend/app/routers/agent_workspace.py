"""Create, list, and chat with user-defined Linewatch agents."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from openai import (
    APIConnectionError,
    APITimeoutError,
    AuthenticationError,
    OpenAIError,
    RateLimitError,
)
from starlette.concurrency import run_in_threadpool

from app.codex_agent import (
    CodexError,
    CodexStreamClosed,
    first_prompt,
    run_turn,
    stream_turn,
)
from app.config import settings
from app.llm import LLMError, reply_to_agent
from app.schemas.agent_workspace import (
    AgentCreate,
    AgentSummary,
    ChatInput,
    ChatMessage,
    WorkspaceAgent,
)
from app.services.agent_workspace import AgentWorkspace

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agent-workspace", tags=["agent workspace"])
workspace = AgentWorkspace(settings.agents_db)
# Strong references to chat turns that outlive their stream (asyncio keeps weak ones)
_running_turns: set[asyncio.Task] = set()


@router.get("")
def list_agents() -> list[AgentSummary]:
    """List agents created in this workspace."""
    return workspace.list_agents()


@router.post("", status_code=201)
def create_agent(definition: AgentCreate) -> WorkspaceAgent:
    """Create an agent without starting a model request."""
    return workspace.create(definition)


def _load(agent_id: str) -> tuple[WorkspaceAgent, int]:
    result = workspace.load(agent_id)
    if result is None:
        raise HTTPException(404, "Agent not found.")
    return result


@router.get("/{agent_id}")
def get_agent(agent_id: str) -> WorkspaceAgent:
    """Return an agent and its own saved chat."""
    return _load(agent_id)[0]


@router.post("/{agent_id}/chat")
async def chat(agent_id: str, payload: ChatInput) -> WorkspaceAgent:
    """Get a model reply and save the completed conversation turn."""
    return await _chat(agent_id, payload)


@router.post("/{agent_id}/chat/stream")
async def chat_stream(agent_id: str, payload: ChatInput) -> StreamingResponse:
    """Send text deltas followed by the saved conversation as JSON lines."""

    async def events() -> AsyncIterator[str]:
        # Unbounded, so the turn never blocks once the client has gone away
        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()

        async def emit(text: str) -> None:
            await queue.put({"type": "delta", "text": text})

        async def finish() -> None:
            try:
                agent = await _chat(agent_id, payload, emit)
                await queue.put({"type": "done", "agent": agent.model_dump()})
            except HTTPException as error:
                await queue.put({"type": "error", "detail": error.detail})
            except Exception:
                logger.exception("Chat turn for agent %s failed", agent_id)
                await queue.put({"type": "error", "detail": "The chat stream failed."})

        # If the client leaves mid-reply, the turn keeps running and is saved, so
        # the answer is there when the chat is reopened.
        task = asyncio.create_task(finish())
        _running_turns.add(task)
        task.add_done_callback(_running_turns.discard)
        while True:
            event = await queue.get()
            yield json.dumps(event) + "\n"
            if event["type"] != "delta":
                break

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def _chat(
    agent_id: str,
    payload: ChatInput,
    emit: Callable[[str], Awaitable[None]] | None = None,
) -> WorkspaceAgent:
    agent, revision = await run_in_threadpool(_load, agent_id)
    thread = None
    if settings.chat_engine == "codex":
        thread = await run_in_threadpool(workspace.codex_thread, agent_id)
        prompt = payload.message
        if thread is None:
            history = [m.model_dump() for m in agent.messages]
            prompt = first_prompt(agent.instructions, history, payload.message)
        try:
            if emit:
                try:
                    reply, thread = await stream_turn(prompt, thread, emit)
                except CodexStreamClosed as closed:
                    # The streaming server died mid-turn: finish the same session
                    # without streaming, so long skill runs still complete.
                    logger.warning("Codex stream closed; continuing without streaming")
                    resume = closed.thread_id
                    retry = "Continue the task and finish it." if resume else prompt
                    reply, thread = await run_in_threadpool(run_turn, retry, resume)
                    await emit(reply)
            else:
                reply, thread = await run_in_threadpool(run_turn, prompt, thread)
        except CodexError as error:
            raise HTTPException(502, f"Codex could not reply: {error}") from error
        agent.messages.append(ChatMessage(role="user", content=payload.message))
    else:
        if not settings.llm_model or not settings.llm_api_key:
            raise HTTPException(
                503, "Set LLM_MODEL and LLM_API_KEY on the backend to enable chat."
            )
        agent.messages.append(ChatMessage(role="user", content=payload.message))
        try:
            reply = (
                await reply_to_agent(agent, emit)
                if emit
                else await reply_to_agent(agent)
            )
        except APITimeoutError as error:
            raise HTTPException(504, "The model timed out. Try again.") from error
        except RateLimitError as error:
            raise HTTPException(
                429, "The model provider is limiting requests. Try again shortly."
            ) from error
        except AuthenticationError as error:
            raise HTTPException(
                502, "The model provider rejected the backend API key."
            ) from error
        except APIConnectionError as error:
            raise HTTPException(
                502, "The backend could not reach the model provider."
            ) from error
        except (LLMError, OpenAIError) as error:
            raise HTTPException(
                502, "The model could not reply. Check the backend model settings."
            ) from error
    agent.messages.append(ChatMessage(role="assistant", content=reply))
    if not await run_in_threadpool(workspace.save, agent, revision, thread):
        raise HTTPException(
            409, "This conversation changed. Reopen it before retrying."
        )
    return agent
