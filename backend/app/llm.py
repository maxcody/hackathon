"""Direct LLM chat on the OpenAI SDK, used when ``CHAT_ENGINE=openai``.

Set ``LLM_MODEL``, ``LLM_API_KEY`` and (for non-OpenAI providers) ``LLM_BASE_URL``.
"""

from openai import AsyncOpenAI

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


async def reply_to_agent(agent: WorkspaceAgent) -> str:
    """Reply using the agent's instructions and up to 20 recent messages."""
    instructions = agent.instructions or f"You are {agent.name}, a helpful assistant."
    async with _client() as client:
        response = await client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": instructions},
                *[message.model_dump() for message in agent.messages[-20:]],
            ],
            store=False,
        )
    reply = response.choices[0].message.content if response.choices else None
    if not reply or not reply.strip():
        raise LLMError("The configured model returned no reply.")
    return reply
