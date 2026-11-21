"""Tests for the portal MCP server's local helpers."""

import hashlib
from pathlib import Path

from scripts.portal_mcp import extract_text, file_status


def write(root: Path, rel: str, content: bytes) -> dict:
    """Create a mirrored file and return its portal listing entry."""
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return {"path": rel, "sha256": hashlib.sha256(content).hexdigest()}


def test_file_status_finds_new_changed_and_removed(tmp_path: Path) -> None:
    same = write(tmp_path, "soony/master/sites.csv", b"a")
    changed = write(tmp_path, "soony/erp/stock.csv", b"old")
    write(tmp_path, "suppliers/SUP-1/gone.pdf", b"x")
    listing = [
        same,
        {**changed, "sha256": hashlib.sha256(b"new").hexdigest()},
        {"path": "soony/context/new.md", "sha256": "0"},
    ]
    assert file_status(listing, tmp_path) == {
        "new": ["soony/context/new.md"],
        "changed": ["soony/erp/stock.csv"],
        "removed": ["suppliers/SUP-1/gone.pdf"],
    }


def test_extract_text_reads_csv_and_flags_images(tmp_path: Path) -> None:
    csv = tmp_path / "a.csv"
    csv.write_bytes(b"id,qty\nCMP-1,5\n")
    scan = tmp_path / "scan.jpg"
    scan.write_bytes(b"\xff\xd8")
    assert extract_text(csv) == "id,qty\nCMP-1,5\n"
    assert extract_text(scan).startswith("Image (scan)")
