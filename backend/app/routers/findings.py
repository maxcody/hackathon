from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.db import SessionDep
from app.models import Finding
from app.pipeline import RunSummary, run
from app.portal import PortalError
from app.schemas.finding import FindingRead

router = APIRouter(tags=["findings"])


@router.get("/findings", response_model=list[FindingRead])
async def list_findings(session: SessionDep):
    """Return all findings, newest first."""
    return (await session.scalars(select(Finding).order_by(Finding.id.desc()))).all()


@router.post("/pipeline/run")
async def run_pipeline(session: SessionDep) -> RunSummary:
    """Sync the portal, read new or changed scans and refresh the findings."""
    try:
        return await run(session)
    except PortalError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
