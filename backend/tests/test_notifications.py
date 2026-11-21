"""One stock-mismatch happening is one notification with both values."""

import pytest
from sqlalchemy import select

from app.data import data_root
from app.db import get_session
from app.main import app
from app.models import Notification, SourceFile
from app.pipeline import _reconcile

needs_data = pytest.mark.skipif(
    not (data_root() / "soony").exists(), reason="Soony data folder not available"
)
SCAN = "soony/receiving/DC-HAM/20261118_WZ-261116-473.jpg"


@needs_data
async def test_notification_carries_sources_and_keeps_status_across_runs(client):
    sessions = app.dependency_overrides[get_session]()  # keep a reference: a
    session = await anext(sessions)  # collected generator would close the session
    try:
        scan = SourceFile(path=SCAN, sha256="a" * 64, size_bytes=1)
        scan.extracted = {"lines": [{"part": "CMP-GAM-008", "final_qty": 8000}]}
        session.add(scan)
        await session.flush()
        assert await _reconcile(session) == 1
        await session.commit()

        (note,) = (await client.get("/notifications")).json()
        assert set(note) == {
            "id", "attr", "erp_val", "customer_val", "data", "seen_at"
        }  # fmt: skip
        assert (note["attr"], note["erp_val"], note["customer_val"]) == (
            "quantity",
            "80000",
            "8000",
        )
        data = note["data"]
        assert (data["kind"], data["status"], data["subject"]) == (
            "stock_mismatch",
            "open",
            "CMP-GAM-008",
        )
        assert data["refs"]["customer"]["ref"] == SCAN

        # A person acknowledges it; a re-run must update it, not duplicate or reopen it
        row = await session.scalar(select(Notification))
        row.data = {**row.data, "status": "acknowledged"}
        await session.commit()
        first_seen = row.seen_at
        assert await _reconcile(session) == 0
        await session.commit()
        rows = (await session.scalars(select(Notification))).all()
        assert len(rows) == 1
        assert rows[0].data["status"] == "acknowledged"
        assert rows[0].seen_at >= first_seen
    finally:
        await sessions.aclose()  # an open session would block dropping the test DB
