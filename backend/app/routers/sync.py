from fastapi import APIRouter, HTTPException

from app.portal import PortalError, SyncResult, sync

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("")
async def run_sync() -> SyncResult:
    """Pull new or replaced files from the Soony portal into the data folder."""
    try:
        return await sync()
    except PortalError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
