"""Load data from the portal and the data folder into the tables.

An import replaces the rows of the tables it fills, so edits made through the
CRUD endpoints to those tables are overwritten by the next import.
"""

from fastapi import APIRouter, HTTPException

from app.db import SessionDep
from app.master_import import ImportSummary, import_master
from app.portal import PortalError, SyncResult, sync
from app.sheet_import import SheetImportSummary, import_sheets

router = APIRouter(prefix="/import", tags=["import"])


@router.post("/sync")
async def run_sync() -> SyncResult:
    """Pull new or replaced files from the Soony portal into the data folder."""
    try:
        return await sync()
    except PortalError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/master")
async def run_master_import(session: SessionDep) -> ImportSummary:
    """Reload products, components, BOM lines and BOM changes from the CSVs."""
    try:
        return await import_master(session)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=409, detail=f"{exc} (run /import/sync?)"
        ) from exc


@router.post("/sheets")
async def run_sheets_import(session: SessionDep) -> SheetImportSummary:
    """Reload the sheet rows from every xlsx in the data folder."""
    return await import_sheets(session)
