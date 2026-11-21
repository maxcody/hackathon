"""The pipeline: sync the portal, track files by hash, read new scans, find problems.

Unchanged files are skipped (same SHA-256 and parser version). Bump
``PARSER_VERSION`` after improving a reader and the affected files are read again.
"""

import asyncio
import hashlib
import re
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.data import data_root
from app.llm import read_delivery_note
from app.models import Notification, SourceFile
from app.models.notification import NotificationStatus
from app.models.source_file import FileStatus
from app.portal import list_files, make_client, sync
from app.stocktruth import Mismatch, find_mismatches

PARSER_VERSION = 2  # 2: scans are read as rows ("lines"), quantities as printed text
SCAN_PATTERN = re.compile(r"^soony/receiving/DC-HAM/.+\.(jpe?g|png)$", re.I)
STOCK_MISMATCH = "stock_mismatch"
CONCURRENT_READS = 2  # free-tier model keys rate-limit quickly


@dataclass
class RunSummary:
    """What one pipeline run did."""

    downloaded: int
    files_tracked: int
    scans_read: int
    scans_failed: int
    notifications_open: int


def _utcnow() -> datetime:
    return datetime.now(UTC)


async def _track(session: AsyncSession, listing: list[dict]) -> list[SourceFile]:
    """Upsert one row per portal file and return those that need processing."""
    rows = {f.path: f for f in await session.scalars(select(SourceFile))}
    seen = set()
    for item in listing:
        path = item["path"]
        seen.add(path)
        row = rows.get(path)
        if row is None:
            row = rows[path] = SourceFile(
                path=path, sha256=item["sha256"], size_bytes=item["bytes"]
            )
            session.add(row)
        elif row.sha256 != item["sha256"]:
            row.sha256, row.size_bytes, row.extracted = (
                item["sha256"],
                item["bytes"],
                None,
            )
            row.status = FileStatus.PENDING
        elif row.status != FileStatus.PROCESSED or row.parser_version < PARSER_VERSION:
            row.status = FileStatus.PENDING
    for path, row in rows.items():
        if path not in seen:
            row.status = FileStatus.REMOVED
    await session.flush()
    return [r for r in rows.values() if r.status == FileStatus.PENDING]


async def _read_scan(row: SourceFile, gate: asyncio.Semaphore) -> dict | Exception:
    async with gate:
        try:
            image = (data_root() / row.path).read_bytes()
            mime = "image/png" if row.path.lower().endswith(".png") else "image/jpeg"
            return await read_delivery_note(image, mime)
        except Exception as exc:  # one bad file must not stop the run
            return exc


async def _extract(pending: list[SourceFile]) -> tuple[int, int]:
    """Read pending scans with the model; mark every other pending file processed."""
    scans = [r for r in pending if SCAN_PATTERN.match(r.path)]
    for row in pending:
        if row not in scans:
            row.status, row.parser_version = FileStatus.PROCESSED, PARSER_VERSION
            row.processed_at = _utcnow()
    gate = asyncio.Semaphore(CONCURRENT_READS)
    results = await asyncio.gather(*(_read_scan(r, gate) for r in scans))
    failed = 0
    for row, result in zip(scans, results, strict=True):
        row.processed_at = _utcnow()
        if isinstance(result, Exception):
            failed += 1
            row.status, row.error = (
                FileStatus.FAILED,
                f"{type(result).__name__}: {result}"[:500],
            )
        else:
            row.status, row.extracted, row.error = FileStatus.PROCESSED, result, None
            row.parser_version = PARSER_VERSION
    return len(scans) - failed, failed


def _fingerprint(m: Mismatch) -> str:
    key = f"{STOCK_MISMATCH}:{m.delivery_note}:{m.part}"
    return hashlib.sha1(key.encode()).hexdigest()


def _refs(m: Mismatch) -> dict:
    """Return where each side of a mismatch came from, for the UI to link to."""
    return {
        "erp": {
            "ref": m.gr_number,
            "po_number": m.po_number,
            "supplier_id": m.supplier_id,
            "in_stock": m.in_stock,
        },
        "customer": {"ref": m.path, "handwritten_correction": m.correction},
    }


def _describe(m: Mismatch) -> str:
    """Return the short headline for a mismatch."""
    return (
        f"{m.delivery_note}: ERP booked {m.booked:,} but the delivery note "
        f"says {m.actual:,} ({m.part})"
    )


async def _reconcile(session: AsyncSession) -> int:
    """Turn scan-versus-receipt mismatches into notifications; return the open count."""
    scans = {
        f.path: f
        for f in await session.scalars(
            select(SourceFile).where(SourceFile.extracted.is_not(None))
        )
    }
    mismatches = find_mismatches({p: f.extracted for p, f in scans.items()})
    existing = {
        n.data["fingerprint"]: n
        for n in await session.scalars(
            select(Notification).where(
                Notification.data["kind"].astext == STOCK_MISMATCH
            )
        )
    }
    current = set()
    for m in mismatches:
        fingerprint = _fingerprint(m)
        current.add(fingerprint)
        title = _describe(m)
        note = existing.get(fingerprint)
        if note is None:
            note = existing[fingerprint] = Notification(attr="quantity", data={})
            session.add(note)
        status = note.data.get("status", NotificationStatus.OPEN)
        if status == NotificationStatus.RESOLVED:
            status = NotificationStatus.OPEN  # the problem is back
        note.erp_val, note.customer_val = str(m.booked), str(m.actual)
        # A new dict, so the JSON column notices the change
        note.data = {
            "fingerprint": fingerprint,
            "kind": STOCK_MISMATCH,
            "status": status,
            "title": title,
            "subject": m.part,
            "refs": _refs(m),
        }
        note.seen_at = _utcnow()
    for fingerprint, note in existing.items():
        if (
            fingerprint not in current
            and note.data["status"] == NotificationStatus.OPEN
        ):
            note.data = {**note.data, "status": NotificationStatus.RESOLVED}
    await session.flush()
    open_notes = await session.scalars(
        select(Notification).where(
            Notification.data["status"].astext == NotificationStatus.OPEN
        )
    )
    return len(open_notes.all())


async def run(session: AsyncSession) -> RunSummary:
    """Sync the portal, read new or changed scans and refresh the notifications.

    Raises:
        PortalError: If the portal rejects the request.
    """
    async with make_client() as client:
        synced = await sync(client)
        listing = await list_files(client)
    pending = await _track(session, listing)
    read, failed = await _extract(pending)
    open_count = await _reconcile(session)
    await session.commit()
    return RunSummary(
        downloaded=len(synced.added) + len(synced.changed),
        files_tracked=len(listing),
        scans_read=read,
        scans_failed=failed,
        notifications_open=open_count,
    )
