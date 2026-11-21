"""Client for the Soony portal API: list files and sync new or replaced ones.

The portal changes during the hack without notice (files appear and existing
files are replaced), so a file counts as changed when its SHA-256 differs.
"""

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote

import httpx

from app.config import settings
from app.data import data_root


class PortalError(Exception):
    """Raised when the portal rejects a request or sends unsafe data."""


@dataclass
class SyncResult:
    """Outcome of one sync run."""

    added: list[str] = field(default_factory=list)
    changed: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    unchanged: int = 0


def make_client() -> httpx.AsyncClient:
    """Build an authenticated client from ``PORTAL_URL`` and ``PORTAL_TOKEN``."""
    if not (settings.portal_url and settings.portal_token):
        raise PortalError("PORTAL_URL and PORTAL_TOKEN must be set in backend/.env")
    return httpx.AsyncClient(
        base_url=settings.portal_url,
        headers={"Authorization": f"Bearer {settings.portal_token}"},
        timeout=60,
    )


def _check(response: httpx.Response) -> None:
    if response.status_code == 401:
        raise PortalError("portal rejected the team token (401)")
    response.raise_for_status()


async def list_files(client: httpx.AsyncClient) -> list[dict]:
    """Return every portal file as ``{path, bytes, sha256, url}``."""
    response = await client.get("/api/v1/files")
    _check(response)
    return response.json()["files"]


def _safe_target(dest: Path, rel: str) -> Path:
    """Resolve ``rel`` under ``dest`` and refuse paths that escape it."""
    target = (dest / rel).resolve()
    if not target.is_relative_to(dest.resolve()):
        raise PortalError(f"unsafe path from portal: {rel}")
    return target


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


async def sync(
    client: httpx.AsyncClient | None = None, dest: Path | None = None
) -> SyncResult:
    """Download files that are new or whose SHA-256 differs from the local copy.

    Files are fetched by path through the authenticated client, never by the
    listed ``url``, so the token cannot be sent to another host. Files removed
    on the portal are left alone locally.

    Args:
        client: Portal client; defaults to one built from settings.
        dest: Local folder to mirror into; defaults to ``DATA_DIR``.

    Returns:
        Which paths were added, changed or failed, and how many were unchanged.

    Raises:
        PortalError: On a rejected token or a path that escapes ``dest``.
    """
    dest = dest or data_root()
    own_client = client is None
    client = client or make_client()
    result = SyncResult()
    try:
        for item in await list_files(client):
            target = _safe_target(dest, item["path"])
            if target.exists() and _sha256(target) == item["sha256"]:
                result.unchanged += 1
                continue
            response = await client.get(f"/api/v1/files/{quote(item['path'])}")
            if response.status_code != 200 and response.status_code != 401:
                result.failed.append(item["path"])  # e.g. a proxy blocked it
                continue
            _check(response)
            if hashlib.sha256(response.content).hexdigest() != item["sha256"]:
                result.failed.append(item["path"])  # replaced mid-sync; next run
                continue
            existed = target.exists()
            target.parent.mkdir(parents=True, exist_ok=True)
            partial = target.with_name(target.name + ".part")
            partial.write_bytes(response.content)
            partial.replace(target)
            (result.changed if existed else result.added).append(item["path"])
    finally:
        if own_client:
            await client.aclose()
    return result
