"""Loaders for the Soony data folder (CSV, xlsx and supplier PDFs).

The folder is confidential hackathon data and is never committed. Point
``DATA_DIR`` at the folder that contains ``soony/`` and ``suppliers/``.
"""

import csv
import html
import re
import zipfile
from pathlib import Path

from pypdf import PdfReader

from app.config import settings


def data_root() -> Path:
    """Return the configured data folder with ``~`` expanded."""
    return Path(settings.data_dir).expanduser()


def read_csv(rel: str) -> list[dict[str, str]]:
    """Read a CSV under ``soony/`` as a list of row dicts."""
    with open(data_root() / "soony" / rel, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def read_xlsx(rel: str, sheet: int, header_row: int = 1) -> list[dict[str, str]]:
    """Read one sheet of an inline-string xlsx under ``soony/`` (stdlib only).

    Args:
        rel: Path relative to ``soony/``.
        sheet: 1-based sheet number.
        header_row: Row that holds the column names; rows below are data.

    Returns:
        One dict per data row, keyed by the header text. Empty cells are omitted.
    """
    with zipfile.ZipFile(data_root() / "soony" / rel) as z:
        xml = z.read(f"xl/worksheets/sheet{sheet}.xml").decode()
    cells = re.findall(
        r'<c r="([A-Z]+)(\d+)"[^>]*>(?:<is><t[^>]*>(.*?)</t></is>|<v>(.*?)</v>)', xml
    )
    rows: dict[int, dict[str, str]] = {}
    for col, row, text, number in cells:
        rows.setdefault(int(row), {})[col] = html.unescape(text or number)
    names = rows.get(header_row, {})
    return [
        {names[c]: v for c, v in cols.items() if c in names}
        for r, cols in sorted(rows.items())
        if r > header_row
    ]


def unstocked_parts() -> set[str]:
    """Return parts a supplier fits into another part, so stock 0 is expected.

    Example: lid magnets are fitted into the Collector's Box by PackRight.
    """
    parts: set[str] = set()
    for path in (data_root() / "suppliers").glob("*/components.csv"):
        with open(path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if "not ordered, received or stocked separately" in row["note"]:
                    parts.add(row["component_id"])
    return parts


def short_shipments() -> dict[str, int]:
    """Read supplier short-shipment advices and return shipped qty by AWB.

    Returns:
        Mapping of air waybill number to the quantity that actually shipped.
    """
    shipped: dict[str, int] = {}
    pattern = r"CMP-[A-Z]+-\d+\n.*?\n([\d,]+)\n([\d,]+)\n([\d,]+)"
    for path in (data_root() / "suppliers").glob(
        "*/order_confirmations/Shipping_advice_*.pdf"
    ):
        awb = path.name.split("_")[2]
        text = "\n".join(p.extract_text() or "" for p in PdfReader(path).pages)
        match = re.search(pattern, text, re.S)
        if match:
            shipped[awb] = int(match.group(2).replace(",", ""))
    return shipped
