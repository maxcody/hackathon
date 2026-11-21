from fastapi import APIRouter
from sqlalchemy import select

from app.db import SessionDep
from app.models import SourceFile
from app.readiness import DEADLINE, parts_readiness, remaining_units, verdict
from app.stocktruth import find_mismatches, stock_adjustments

router = APIRouter(prefix="/status", tags=["status"])


@router.get("")
async def get_status(session: SessionDep):
    """Return launch readiness with stock corrected by what delivery notes show."""
    scans = await session.scalars(
        select(SourceFile).where(SourceFile.extracted.is_not(None))
    )
    mismatches = find_mismatches({f.path: f.extracted for f in scans})
    parts = parts_readiness(stock_adjustments(mismatches))
    return {
        "deadline": DEADLINE,
        "verdict": verdict(parts),
        "remaining_units": remaining_units(),
        "stock_corrections": [
            {"part": m.part, "delivery_note": m.delivery_note, "delta": m.delta}
            for m in mismatches
            if m.in_stock
        ],
        "parts": parts,
    }
