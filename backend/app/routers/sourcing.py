"""Who can supply a part (used by agents to find a second source)."""

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from app import sourcing

router = APIRouter(prefix="/sourcing", tags=["sourcing"])


@router.get("/{component_id}")
async def sourcing_options(component_id: str) -> list[sourcing.Source]:
    """Suppliers for a part: primary, second sources, then same category."""
    return await run_in_threadpool(sourcing.options, component_id)
