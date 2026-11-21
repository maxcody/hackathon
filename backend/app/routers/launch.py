"""Launch readiness and supplier follow-up endpoints."""

import hashlib
from pathlib import PurePosixPath
from typing import Annotated
from urllib.parse import quote

import httpx
from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from app.config import settings
from app.services.archive_store import ArchiveStore
from app.services.data_intake import (
    MAX_ARCHIVE_BYTES,
    MAX_ARCHIVE_FILES,
    MAX_EXPANDED_BYTES,
)
from app.services.launch_control import build_launch_brief, build_supplier_draft

router = APIRouter(prefix="/api", tags=["launch control"])
archive_store = ArchiveStore(settings.data_dir)


@router.get("/launch")
async def get_launch_brief() -> dict[str, object]:
    """Return the current evidence-backed launch readiness brief."""
    return await run_agents()


@router.post("/agents/run")
async def run_agents() -> dict[str, object]:
    """Run baseline and imported-data specialists, then prioritize their findings."""
    documents = archive_store.documents()
    brief = build_launch_brief(documents)
    imported = archive_store.summary(documents)
    data_fields = (
        "imported",
        "file_count",
        "row_count",
        "warning_count",
        "imported_at",
    )
    brief["data"] = {key: imported[key] for key in data_fields}
    brief["data"]["portal_sync_enabled"] = bool(
        settings.soony_portal_url and settings.soony_portal_token
    )
    brief["risks"] = imported["risks"] + brief["risks"]
    brief["events"] = imported["events"]
    brief["agents"].extend(
        [
            {
                "name": "Document & Change Monitor",
                "status": "complete" if imported["imported"] else "waiting_for_data",
                "result": (
                    f"Inspected {imported['file_count']} files and "
                    f"{imported['row_count']} rows; "
                    f"found {len(imported['risks'])} evidence-backed signals."
                    if imported["imported"]
                    else "Waiting for a Soony portal archive import."
                ),
            },
            {
                "name": "Event Impact Triage",
                "status": "complete" if imported["events"] else "waiting_for_data",
                "result": (
                    f"Tracked {len(imported['events'])} recent file changes "
                    "across archive snapshots."
                    if imported["events"]
                    else "Re-import after a data drop to detect file-level changes."
                ),
            },
        ]
    )
    return brief


@router.get("/data")
async def get_imported_data() -> dict[str, object]:
    """Return the current import inventory, event log, and detected signals."""
    return archive_store.summary()


@router.post("/data/import")
async def import_archive(file: Annotated[UploadFile, File()]) -> dict[str, object]:
    """Import a Soony portal archive zip into local ignored storage."""
    if file.filename and not file.filename.casefold().endswith(".zip"):
        raise HTTPException(
            status_code=400,
            detail="Upload the .zip archive downloaded from the Soony portal.",
        )
    try:
        content = await file.read(60 * 1024 * 1024 + 1)
        result = archive_store.import_archive(content)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return result


@router.post("/data/sync")
async def sync_portal() -> dict[str, object]:
    """Fetch changed portal files only and preserve the prior local snapshot."""
    if not settings.soony_portal_url or not settings.soony_portal_token:
        raise HTTPException(
            status_code=409,
            detail=(
                "Set SOONY_PORTAL_URL and SOONY_PORTAL_TOKEN in backend/.env, "
                "then restart the server."
            ),
        )
    headers = {}
    token_value = settings.soony_portal_token
    if settings.soony_portal_token_prefix:
        token_value = f"{settings.soony_portal_token_prefix} {token_value}"
    headers[settings.soony_portal_token_header] = token_value
    base_url = settings.soony_portal_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            listing_response = await client.get(
                f"{base_url}/api/v1/files", headers=headers
            )
            listing_response.raise_for_status()
            try:
                listing = listing_response.json()
            except ValueError as error:
                raise HTTPException(
                    status_code=502,
                    detail="Portal returned an unreadable file inventory.",
                ) from error
            if not isinstance(listing, dict):
                raise HTTPException(
                    status_code=502, detail="Portal returned an invalid file inventory."
                )
            file_items = listing.get("files", [])
            if not isinstance(file_items, list) or len(file_items) > MAX_ARCHIVE_FILES:
                raise HTTPException(
                    status_code=502, detail="Portal returned an invalid file inventory."
                )

            remote: dict[str, str] = {}
            remote_sizes: dict[str, int] = {}
            expanded_bytes = 0
            for item in file_items:
                if not isinstance(item, dict):
                    raise HTTPException(
                        status_code=502,
                        detail="Portal returned malformed file metadata.",
                    )
                path = item.get("path")
                digest = item.get("sha256")
                size = item.get("bytes")
                if (
                    not isinstance(path, str)
                    or not path
                    or "\\" in path
                    or PurePosixPath(path).is_absolute()
                    or ".." in PurePosixPath(path).parts
                    or not isinstance(digest, str)
                    or len(digest) != 64
                    or any(
                        character not in "0123456789abcdefABCDEF"
                        for character in digest
                    )
                    or not isinstance(size, int)
                    or size < 0
                    or path in remote
                ):
                    raise HTTPException(
                        status_code=502,
                        detail="Portal returned malformed file metadata.",
                    )
                remote[path] = digest.casefold()
                remote_sizes[path] = size
                expanded_bytes += size
            if expanded_bytes > MAX_EXPANDED_BYTES:
                raise HTTPException(
                    status_code=502,
                    detail="Portal data exceeds the 250 MB processing limit.",
                )

            to_download = archive_store.files_to_download(remote)
            downloaded: dict[str, bytes] = {}
            downloaded_bytes = 0
            for path in to_download:
                file_url = f"{base_url}/api/v1/files/{quote(path, safe='/')}"
                response = await client.get(file_url, headers=headers)
                response.raise_for_status()
                content = response.content
                downloaded_bytes += len(content)
                if downloaded_bytes > MAX_ARCHIVE_BYTES:
                    raise HTTPException(
                        status_code=502,
                        detail="Changed files exceed the 60 MB sync limit.",
                    )
                if len(content) != remote_sizes[path]:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Size mismatch while downloading {path}.",
                    )
                if hashlib.sha256(content).hexdigest() != remote[path]:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Checksum mismatch while downloading {path}.",
                    )
                downloaded[path] = content
    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Portal returned HTTP {error.response.status_code}; "
                "check the token and portal URL."
            ),
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not reach the Soony portal. Check the URL and network "
                "connection."
            ),
        ) from error
    try:
        result = archive_store.commit_remote_files(remote, downloaded)
    except ValueError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return result


@router.get("/supplier-draft")
async def get_supplier_draft(
    edition: Annotated[str, Query(description="Standard or Collector's Edition")],
) -> dict[str, str]:
    """Build a supplier follow-up draft for human approval."""
    try:
        return build_supplier_draft(edition, archive_store.documents())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
