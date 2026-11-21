"""Loaders for the Soony data folder (CSV and xlsx).

The folder is confidential hackathon data and is never committed. Point
``DATA_DIR`` at the folder that contains ``soony/`` and ``suppliers/``.
"""

import csv
import html
import re
import zipfile
from pathlib import Path

from app.config import settings


def data_root() -> Path:
    """Return the configured data folder with ``~`` expanded."""
    return Path(settings.data_dir).expanduser()


def read_csv(rel: str) -> list[dict[str, str]]:
    """Read a CSV under ``soony/`` as a list of row dicts."""
    with open(data_root() / "soony" / rel, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _sheet_rows(z: zipfile.ZipFile, sheet: int) -> dict[int, dict[str, str]]:
    """Return one worksheet as ``{row number: {column letter: text}}``.

    Empty cells are omitted. Assumes the Nth sheet in the workbook is stored as
    ``sheet<N>.xml`` (true for the portal files; upgrade if one ever differs).
    """
    xml = z.read(f"xl/worksheets/sheet{sheet}.xml").decode()
    cells = re.findall(
        r'<c r="([A-Z]+)(\d+)"[^>]*>(?:<is><t[^>]*>(.*?)</t></is>|<v>(.*?)</v>)', xml
    )
    rows: dict[int, dict[str, str]] = {}
    for col, row, text, number in cells:
        rows.setdefault(int(row), {})[col] = html.unescape(text or number)
    return rows


def read_workbook(path: Path) -> dict[str, dict[int, dict[str, str]]]:
    """Read every sheet of an xlsx as ``{sheet name: {row: {column: text}}}``."""
    with zipfile.ZipFile(path) as z:
        names = re.findall(
            r'<sheet [^>]*name="([^"]*)"', z.read("xl/workbook.xml").decode()
        )
        return {html.unescape(n): _sheet_rows(z, i) for i, n in enumerate(names, 1)}
