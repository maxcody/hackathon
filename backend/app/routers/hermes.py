"""Submit a dashboard task to the configured Hermes gateway."""

from secrets import compare_digest
from typing import Annotated

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, StringConstraints

from app.config import settings

router = APIRouter(prefix="/api/hermes", tags=["hermes"])


class HermesTask(BaseModel):
    """A task entered explicitly in the dashboard."""

    task: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8000)
    ]


class HermesReply(BaseModel):
    """Text returned by Hermes."""

    reply: str


@router.post("/run")
async def run_hermes(
    task: HermesTask,
    trigger_key: Annotated[str, Header(alias="X-Hermes-Trigger-Key")] = "",
) -> HermesReply:
    """Trigger Hermes and return the final reply to the dashboard."""
    base_url = settings.hermes_base_url
    api_key = settings.hermes_api_key
    expected_key = settings.hermes_trigger_key
    if not base_url or not api_key or not expected_key:
        raise HTTPException(503, "Hermes is not configured on the dashboard server.")
    if not compare_digest(trigger_key.encode(), expected_key.encode()):
        raise HTTPException(403, "The dashboard access key is incorrect.")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=10)) as client:
            response = await client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": "hermes-agent",
                    "messages": [{"role": "user", "content": task.task}],
                    "stream": False,
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            return HermesReply(reply=content)
    except httpx.TimeoutException as error:
        raise HTTPException(
            504, "Hermes timed out. The task may still be running."
        ) from error
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as error:
        raise HTTPException(502, "Hermes did not return a usable reply.") from error
