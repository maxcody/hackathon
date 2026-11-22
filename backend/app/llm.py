"""Direct LLM chat on the OpenAI SDK, used when ``CHAT_ENGINE=openai``.

Set ``LLM_MODEL``, ``LLM_API_KEY`` and (for non-OpenAI providers) ``LLM_BASE_URL``.
"""

from collections.abc import Awaitable, Callable

from openai import AsyncOpenAI

from app.chat_format import MARKDOWN_GUIDANCE
from app.config import settings
from app.schemas.agent_workspace import WorkspaceAgent


class LLMError(Exception):
    """Raised when the model is not configured or returns no reply."""


def _client() -> AsyncOpenAI:
    if not (settings.llm_api_key and settings.llm_model):
        raise LLMError("LLM_API_KEY and LLM_MODEL must be set in backend/.env")
    return AsyncOpenAI(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url or None,
        timeout=90,
        max_retries=4,  # providers return 429/503 under load
    )


async def reply_to_agent(
    agent: WorkspaceAgent, emit: Callable[[str], Awaitable[None]] | None = None
) -> str:
    """Reply using the agent's instructions and up to 20 recent messages."""
    instructions = agent.instructions or f"You are {agent.name}, a helpful assistant."
    messages = [
        {"role": "system", "content": f"{instructions}\n\n{MARKDOWN_GUIDANCE}"},
        *[message.model_dump() for message in agent.messages[-20:]],
    ]
    async with _client() as client:
        if emit:
            pieces = []
            stream = await client.chat.completions.create(
                model=settings.llm_model, messages=messages, store=False, stream=True
            )
            async with stream:
                async for chunk in stream:
                    delta = chunk.choices[0].delta.content if chunk.choices else None
                    if delta:
                        pieces.append(delta)
                        await emit(delta)
            reply = "".join(pieces)
        else:
            response = await client.chat.completions.create(
                model=settings.llm_model, messages=messages, store=False
            )
            reply = response.choices[0].message.content if response.choices else None
    if not reply or not reply.strip():
        raise LLMError("The configured model returned no reply.")
    return reply
