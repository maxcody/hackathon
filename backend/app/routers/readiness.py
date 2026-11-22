"""Launch readiness computed from the ERP files in the data folder."""

from fastapi import APIRouter, HTTPException
from starlette.concurrency import run_in_threadpool

from app.readiness import Readiness, compute

router = APIRouter(prefix="/readiness", tags=["readiness"])


@router.get("")
async def get_readiness() -> Readiness:
    """Packed per edition and whether part stock covers what is left to pack."""
    try:
        return await run_in_threadpool(compute)
    except FileNotFoundError as exc:
        raise HTTPException(409, f"{exc} (run /import/sync?)") from exc
