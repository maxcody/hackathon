from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.db import SessionDep
from app.models import SheetRow
from app.schemas.sheet import SheetRowRead
from app.sheet_import import SIGNATURES, SheetImportSummary, import_sheets

router = APIRouter(prefix="/sheets", tags=["sheets"])


@router.post("/import")
async def run_import(session: SessionDep) -> SheetImportSummary:
    """Reload launch plan and status, shipment tracker and price lists."""
    return await import_sheets(session)


@router.get("/{kind}", response_model=list[SheetRowRead])
async def list_rows(session: SessionDep, kind: str):
    """Return the rows of one kind (see the 404 message for the valid kinds)."""
    if kind not in SIGNATURES:
        raise HTTPException(
            status_code=404, detail=f"kind must be one of {sorted(SIGNATURES)}"
        )
    query = (
        select(SheetRow)
        .where(SheetRow.kind == kind)
        .order_by(SheetRow.source, SheetRow.sheet, SheetRow.row_no)
    )
    return (await session.scalars(query)).all()
