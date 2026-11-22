"""MCP server that lets agents (Codex, Claude Code, ...) use the Soony portal API.

Run it over stdio from an MCP client, e.g. in ``~/.codex/config.toml``::

    [mcp_servers.portal]
    command = "<repo>/.venv/Scripts/python.exe"
    args = ["<repo>/backend/scripts/portal_mcp.py"]

It mirrors the portal into ``DATA_DIR`` via ``app.portal`` and reads files
from that mirror, so agents share one cache and the token never leaves this
process. Needs ``PORTAL_TOKEN`` in ``backend/.env``.
"""

import asyncio
import os
import sys
from pathlib import Path

import truststore

# Trust the OS certificate store (needed behind TLS-inspecting company proxies).
truststore.inject_into_ssl()

BACKEND = Path(__file__).resolve().parents[1]
# app.config reads ".env" relative to the working directory.
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))

from docx import Document  # noqa: E402
from mcp.server import MCPServer  # noqa: E402
from pypdf import PdfReader  # noqa: E402

from app import portal  # noqa: E402
from app.data import data_root, read_workbook  # noqa: E402

MAX_CHARS = 60_000
TEXT_SUFFIXES = {".csv", ".tsv", ".txt", ".md", ".json", ".eml", ".xml", ".html"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".tif", ".tiff"}


def file_status(listing: list[dict], root: Path) -> dict[str, list[str]]:
    """Compare the portal listing with the local mirror.

    Args:
        listing: Portal files as ``{path, sha256, ...}``.
        root: Local mirror folder.

    Returns:
        Paths that are ``new`` or ``changed`` on the portal, and paths that
        exist locally but were ``removed`` from the portal.
    """
    status: dict[str, list[str]] = {"new": [], "changed": [], "removed": []}
    for item in listing:
        target = root / item["path"]
        if not target.exists():
            status["new"].append(item["path"])
        elif portal._sha256(target) != item["sha256"]:
            status["changed"].append(item["path"])
    listed = {item["path"] for item in listing}
    for folder in ("soony", "suppliers"):
        for path in (root / folder).rglob("*"):
            rel = path.relative_to(root).as_posix()
            if path.is_file() and not rel.endswith(".part") and rel not in listed:
                status["removed"].append(rel)
    return status


def extract_text(path: Path) -> str:
    """Return readable text for a mirrored file.

    Args:
        path: Local file path.

    Returns:
        Text content (PDF, DOCX and XLSX converted), or a note for images and
        unknown binary formats telling the agent to open the file itself.
    """
    suffix = path.suffix.casefold()
    if suffix in TEXT_SUFFIXES:
        return path.read_bytes().decode("utf-8", errors="replace")
    if suffix == ".pdf":
        pages = PdfReader(path).pages
        text = "\n".join(page.extract_text() or "" for page in pages)
        return text if text.strip() else f"Scanned PDF without text: open {path}"
    if suffix == ".docx":
        return "\n".join(p.text for p in Document(path).paragraphs)
    if suffix == ".xlsx":
        lines = []
        for name, rows in read_workbook(path).items():
            lines.append(f"## Sheet: {name}")
            for number, cells in sorted(rows.items()):
                lines.append(f"{number}: " + " | ".join(cells.values()))
        return "\n".join(lines)
    if suffix in IMAGE_SUFFIXES:
        return f"Image (scan). Open it to read it: {path}"
    return f"Binary file, no text extraction: {path}"


server = MCPServer(
    "soony-portal",
    instructions=(
        "Soony supplier portal. Files change without notice: call check_updates "
        "or sync_portal before relying on data. Suppliers write in their own "
        "language; scans need to be opened as images. Cite file paths."
    ),
)


@server.tool()
async def list_portal_files(prefix: str = "") -> str:
    """List portal files with size and SHA-256, optionally under a path prefix.

    Args:
        prefix: Only list paths starting with this, e.g. ``suppliers/SUP-0028``.

    Returns:
        One line per file: path, bytes, sha256.
    """
    async with portal.make_client() as client:
        listing = await portal.list_files(client)
    rows = [f for f in listing if f["path"].startswith(prefix)]
    lines = [f"{f['path']}\t{f['bytes']}\t{f['sha256']}" for f in rows]
    return f"{len(rows)} files\n" + "\n".join(lines)


@server.tool()
async def check_updates() -> str:
    """Report what changed on the portal compared with the local mirror.

    Returns:
        New, changed and removed paths. Nothing is downloaded.
    """
    async with portal.make_client() as client:
        listing = await portal.list_files(client)
    status = await asyncio.to_thread(file_status, listing, data_root())
    parts = [f"{len(listing)} files on the portal."]
    for key, paths in status.items():
        parts.append(f"{key} ({len(paths)}):" + "".join(f"\n  {p}" for p in paths))
    return "\n".join(parts)


@server.tool()
async def sync_portal() -> str:
    """Download every new or replaced portal file into the local mirror.

    Returns:
        Added, changed and failed paths, the unchanged count and the mirror path.
    """
    result = await portal.sync()
    lines = [
        f"Mirror: {data_root()}",
        f"unchanged: {result.unchanged}",
        f"added ({len(result.added)}):" + "".join(f"\n  {p}" for p in result.added),
        f"changed ({len(result.changed)}):"
        + "".join(f"\n  {p}" for p in result.changed),
        f"failed ({len(result.failed)}):" + "".join(f"\n  {p}" for p in result.failed),
    ]
    return "\n".join(lines)


@server.tool()
async def read_portal_file(path: str) -> str:
    """Read one file from the local mirror as text (syncs first if it is missing).

    Args:
        path: Portal path, e.g. ``soony/erp/stock_snapshot.csv``.

    Returns:
        The file's text (PDF, DOCX and XLSX converted), truncated if very long,
        or the local path for scans and other binary files.
    """
    root = data_root()
    target = portal._safe_target(root, path)
    if not target.exists():
        await portal.sync()
    if not target.is_file():
        return f"No such file on the portal: {path}"
    text = await asyncio.to_thread(extract_text, target)
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS] + f"\n[truncated, full file at {target}]"
    return f"# {path}\n{text}"


if __name__ == "__main__":
    server.run()
