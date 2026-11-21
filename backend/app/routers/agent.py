"""Run a dashboard task against the configured OpenAI model."""

from secrets import compare_digest
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException
from openai import APITimeoutError, AsyncOpenAI, OpenAIError
from pydantic import BaseModel, StringConstraints

from app.config import settings

router = APIRouter(prefix="/api/agents", tags=["agents"])


class AgentTask(BaseModel):
    """A task submitted in the dashboard."""

    task: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8000)
    ]


class AgentReply(BaseModel):
    """Text returned by the configured model."""

    reply: str


@router.post("/ask")
async def ask_agent(
    task: AgentTask,
    access_key: Annotated[str, Header(alias="X-Agent-Access-Key")] = "",
) -> AgentReply:
    """Send an explicitly submitted task to OpenAI and return its reply."""
    api_key, model, expected_key = (
        settings.llm_api_key,
        settings.llm_model,
        settings.agent_access_key,
    )
    if not api_key or not model or not expected_key:
        raise HTTPException(503, "The OpenAI agent is not configured.")
    if not compare_digest(access_key.encode(), expected_key.encode()):
        raise HTTPException(403, "The dashboard access key is incorrect.")

    try:
        async with AsyncOpenAI(
            api_key=api_key,
            base_url=settings.llm_base_url or "https://api.openai.com/v1",
            timeout=60.0,
            max_retries=0,
        ) as client:
            response = await client.responses.create(
                model=model, input=task.task, store=False
            )
    except APITimeoutError as error:
        raise HTTPException(504, "The OpenAI request timed out.") from error
    except OpenAIError as error:
        raise HTTPException(502, "OpenAI could not complete the task.") from error

    if not response.output_text.strip():
        raise HTTPException(502, "OpenAI returned no text.")
    return AgentReply(reply=response.output_text)
