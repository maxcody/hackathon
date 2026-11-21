"""Load the Excel files (launch plan and status, shipment tracker, price lists).

Each sheet is recognised by its header labels, not by file name, sheet name or
header row, because the portal renames files and the sheets carry title rows.
Rows that lack their key columns (footnotes, stray lines) are skipped and
reported, never guessed at.
"""

import re
from dataclasses import dataclass, field
from zipfile import BadZipFile

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.data import data_root, read_workbook
from app.models import SheetRow

# Header labels that identify a kind of sheet; the first kind that fits wins
SIGNATURES = {
    "editions": {"Product", "Day-one demand", "Packed", "Still to pack"},
    "parts": {"Part", "Per Standard", "ERP stock", "Due before launch"},
    "inbound": {"Supplier", "Part", "Quantity", "Reference", "ETA"},
    "shifts": {"Day", "Shift", "Hours", "Lines"},
    "shipments": {"Shipment", "Container/AWB", "Supplier", "POs", "ETD", "ETA"},
    "price_list": {"Material", "Current price", "New price", "Valid from"},
    "notes": {"Note"},
}
# A data row must have these, or it is a footnote or stray line
REQUIRED = {
    "editions": {"Product"},
    "parts": {"Part"},
    "inbound": {"Part", "Quantity"},
    "shifts": {"Day", "Hours"},
    "shipments": {"Shipment"},
    "price_list": {"Material", "Current price"},
    "notes": {"Note"},
}
# Counts may be written German-style ("640.000" is 640,000); other numbers are plain
COUNTS = {
    "Day-one demand",
    "of which pre-orders",
    "Packed",
    "Still to pack",
    "Rate per hour",
}
NUMBERS = COUNTS | {
    "Hours needed", "Hours available", "Per Standard", "Per Collector's",
    "Needed for the remaining pack-out", "ERP stock", "Due before launch", "Cover",
    "Quantity", "Hours", "Current price", "New price",
}  # fmt: skip
THOUSANDS = re.compile(r"\d{1,3}(\.\d{3})+")
HEADER_SEARCH_ROWS = 8


@dataclass
class SheetImportSummary:
    """Rows stored per kind, plus what was left out and why."""

    rows: dict[str, int] = field(default_factory=dict)
    skipped_rows: list[str] = field(default_factory=list)
    ignored_sheets: list[str] = field(default_factory=list)


def _value(label: str, text: str) -> str | int | float:
    """Parse a cell: counts and numeric columns become numbers, the rest stay text."""
    text = text.strip()
    if label in COUNTS and THOUSANDS.fullmatch(text):
        return int(text.replace(".", ""))
    if label in NUMBERS:
        try:
            number = float(text)
        except ValueError:
            return text
        return int(number) if number.is_integer() and "." not in text else number
    return text


def _find_header(
    rows: dict[int, dict[str, str]],
) -> tuple[int, str, dict[str, str]] | None:
    """Return (row number, kind, {column letter: label}) of the sheet's header."""
    for number in sorted(rows)[:HEADER_SEARCH_ROWS]:
        labels = {col: text.strip() for col, text in rows[number].items()}
        for kind, needed in SIGNATURES.items():
            if needed <= set(labels.values()):
                return number, kind, labels
    return None


def _sheet_rows(
    source: str,
    sheet: str,
    rows: dict[int, dict[str, str]],
    summary: SheetImportSummary,
):
    """Yield a ``SheetRow`` per data row of one sheet, or note why it is ignored."""
    found = _find_header(rows)
    if found is None:
        summary.ignored_sheets.append(f"{source}:{sheet}")
        return
    header_row, kind, labels = found
    first = min(rows)
    only = rows[first]
    title = next(iter(only.values())) if first < header_row and len(only) == 1 else None
    for number in sorted(n for n in rows if n > header_row):
        data = {
            labels[col]: _value(labels[col], text)
            for col, text in rows[number].items()
            if col in labels and text.strip()
        }
        if not REQUIRED[kind] <= data.keys():
            summary.skipped_rows.append(f"{source}:{sheet}:{number}")
            continue
        summary.rows[kind] = summary.rows.get(kind, 0) + 1
        yield SheetRow(
            kind=kind, source=source, sheet=sheet, title=title, row_no=number, data=data
        )


async def import_sheets(session: AsyncSession) -> SheetImportSummary:
    """Replace ``sheet_rows`` with the contents of every xlsx in the data folder.

    Args:
        session: Active database session; committed on success.

    Returns:
        Row counts per kind, rows skipped for missing key columns, and sheets
        whose header matched no known kind.
    """
    root = data_root()
    summary = SheetImportSummary()
    rows: list[SheetRow] = []
    for path in sorted(root.rglob("*.xlsx")):
        try:
            sheets = read_workbook(path)
        except (BadZipFile, KeyError):
            summary.ignored_sheets.append(
                path.relative_to(root).as_posix()
            )  # not a readable workbook
            continue
        for sheet, cells in sheets.items():
            rows.extend(
                _sheet_rows(path.relative_to(root).as_posix(), sheet, cells, summary)
            )
    await session.execute(delete(SheetRow))
    session.add_all(rows)
    await session.commit()
    return summary
