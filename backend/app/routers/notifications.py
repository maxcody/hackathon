from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.db import SessionDep
from app.models import Notification
from app.pipeline import RunSummary, run
from app.portal import PortalError
from app.schemas.notification import NotificationRead

router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=list[NotificationRead])
async def list_notifications(session: SessionDep):
    """Return all notifications, newest first."""
    query = select(Notification).order_by(Notification.id.desc())
    return (await session.scalars(query)).all()


@router.post("/pipeline/run")
async def run_pipeline(session: SessionDep) -> RunSummary:
    """Sync the portal, read new or changed scans and refresh the notifications."""
    try:
        return await run(session)
    except PortalError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
