from fastapi import APIRouter

from app.readiness import DEADLINE, parts_readiness, remaining_units, verdict

router = APIRouter(prefix="/status", tags=["status"])


@router.get("")
def get_status():
    """Return launch readiness: verdict, remaining copies and per-part gaps."""
    parts = parts_readiness()
    return {
        "deadline": DEADLINE,
        "verdict": verdict(parts),
        "remaining_units": remaining_units(),
        "parts": parts,
    }
