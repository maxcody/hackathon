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
from app.models import Finding, SourceFile
from app.models.finding import FindingStatus, Severity
from app.models.source_file import FileStatus
from app.portal import list_files, make_client, sync
from app.stocktruth import Mismatch, find_mismatches

PARSER_VERSION = 2  # 2: scans are read as rows ("lines"), quantities as printed text
SCAN_PATTERN = re.compile(r"^soony/receiving/DC-HAM/.+\.(jpe?g|png)$", re.I)
STOCK_MISMATCH = "stock_mismatch"
CRITICAL_RATIO = 0.10  # a difference above 10% of the booked quantity is critical
CONCURRENT_READS = 2  # free-tier model keys rate-limit quickly


@dataclass
class RunSummary:
    """What one pipeline run did."""

    downloaded: int
    files_tracked: int
    scans_read: int
    scans_failed: int
    findings_open: int


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


def _describe(m: Mismatch) -> tuple[str, str, str]:
    """Return (severity, title, detail) for a mismatch."""
    ratio = abs(m.delta) / max(m.booked, 1)
    severity = Severity.CRITICAL if ratio >= CRITICAL_RATIO else Severity.WARNING
    title = (
        f"{m.delivery_note}: ERP booked {m.booked:,} but the delivery note "
        f"says {m.actual:,} ({m.part})"
    )
    detail = (
        f"Goods receipt {m.gr_number} (PO {m.po_number}, supplier {m.supplier_id}) "
        f"booked {m.booked:,}; the scan shows {m.actual:,}"
    )
    if m.correction:
        detail += f" (handwritten correction {m.correction:,})"
    direction = "overstated" if m.delta < 0 else "understated"
    detail += f". ERP stock is {direction} by {abs(m.delta):,}."
    return severity, title, detail


async def _reconcile(session: AsyncSession) -> int:
    """Turn scan-versus-receipt mismatches into findings; return the open count."""
    scans = {
        f.path: f
        for f in await session.scalars(
            select(SourceFile).where(SourceFile.extracted.is_not(None))
        )
    }
    mismatches = find_mismatches({p: f.extracted for p, f in scans.items()})
    existing = {
        f.fingerprint: f
        for f in await session.scalars(
            select(Finding).where(Finding.kind == STOCK_MISMATCH)
        )
    }
    current = set()
    for m in mismatches:
        fingerprint = _fingerprint(m)
        current.add(fingerprint)
        severity, title, detail = _describe(m)
        finding = existing.get(fingerprint)
        if finding is None:
            finding = Finding(fingerprint=fingerprint, kind=STOCK_MISMATCH)
            session.add(finding)
        elif finding.status == FindingStatus.RESOLVED:
            finding.status = FindingStatus.OPEN  # the problem is back
        finding.severity, finding.title, finding.detail = severity, title, detail
        finding.part, finding.source_file_id = m.part, scans[m.path].id
    for fingerprint, finding in existing.items():
        if fingerprint not in current and finding.status == FindingStatus.OPEN:
            finding.status = FindingStatus.RESOLVED
    await session.flush()
    open_count = await session.scalars(
        select(Finding).where(Finding.status == FindingStatus.OPEN)
    )
    return len(open_count.all())


async def run(session: AsyncSession) -> RunSummary:
    """Sync the portal, read new or changed scans and refresh the findings.

    Raises:
        PortalError: If the portal rejects the request.
    """
    async with make_client() as client:
        synced = await sync(client)
        listing = await list_files(client)
    pending = await _track(session, listing)
    read, failed = await _extract(pending)
    open_findings = await _reconcile(session)
    await session.commit()
    return RunSummary(
        downloaded=len(synced.added) + len(synced.changed),
        files_tracked=len(listing),
        scans_read=read,
        scans_failed=failed,
        findings_open=open_findings,
    )
