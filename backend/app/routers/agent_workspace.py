"""Create, list, and chat with user-defined Linewatch agents."""

from fastapi import APIRouter, HTTPException
from openai import (
    APIConnectionError,
    APITimeoutError,
    AuthenticationError,
    OpenAIError,
    RateLimitError,
)
from starlette.concurrency import run_in_threadpool

from app.codex_agent import CodexError, first_prompt, run_turn
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

router = APIRouter(prefix="/api/agent-workspace", tags=["agent workspace"])
workspace = AgentWorkspace(settings.agents_db)


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
    agent, revision = await run_in_threadpool(_load, agent_id)
    thread = None
    if settings.chat_engine == "codex":
        thread = await run_in_threadpool(workspace.codex_thread, agent_id)
        prompt = payload.message
        if thread is None:
            history = [m.model_dump() for m in agent.messages]
            prompt = first_prompt(agent.instructions, history, payload.message)
        try:
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
            reply = await reply_to_agent(agent)
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
