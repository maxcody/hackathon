"""Stock Truth: compare what delivery notes say with what the ERP booked."""

from collections import defaultdict
from dataclasses import dataclass
from pathlib import PurePosixPath

from app.data import read_csv


@dataclass
class Mismatch:
    """A goods receipt whose booked quantity differs from the delivery note."""

    delivery_note: str
    gr_number: str
    po_number: str
    supplier_id: str
    part: str
    booked: int
    actual: int
    correction: int | None  # handwritten correction on the scan, if any
    in_stock: bool  # the booked batch is still in the ERP stock snapshot
    path: str

    @property
    def delta(self) -> int:
        """Actual minus booked quantity (negative when the ERP is overstated)."""
        return self.actual - self.booked


def delivery_note_from_path(path: str) -> str:
    """Return the delivery-note number from a name like 20261118_WZ-261116-473.jpg."""
    return PurePosixPath(path).stem.split("_", 1)[-1]


def _sum_lines(data: dict) -> tuple[dict[str, int], dict[str, int]]:
    """Total the delivery-note rows per part, and keep any handwritten correction."""
    totals: dict[str, int] = defaultdict(int)
    corrections: dict[str, int] = {}
    for line in data.get("lines", []):
        part, qty = line.get("part"), line.get("final_qty")
        if part and qty is not None:
            totals[part] += qty
            if line.get("handwritten_correction"):
                corrections[part] = line["handwritten_correction"]
    return totals, corrections


def find_mismatches(extractions: dict[str, dict]) -> list[Mismatch]:
    """Compare model-read scans with goods receipts, per delivery note and part.

    One note can cover several receipts (or rows) of the same part, so both sides
    are totalled before comparing.

    Args:
        extractions: Scan path mapped to what was read from it (``lines`` with
            ``part`` and ``final_qty``).

    Returns:
        One Mismatch per note and part whose real total differs from the booked
        one. Scans without a matching goods receipt are skipped.
    """
    receipts: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in read_csv("erp/goods_receipts.csv"):
        receipts[(r["delivery_note"], r["material_id"])].append(r)
    batches = {r["batch"] for r in read_csv("erp/stock_snapshot.csv")}
    found = []
    for path, data in extractions.items():
        note = delivery_note_from_path(path)
        totals, corrections = _sum_lines(data)
        for part, actual in totals.items():
            rows = receipts.get((note, part))
            if not rows:
                continue
            booked = sum(int(r["qty_received"]) for r in rows)
            if actual != booked:
                found.append(
                    Mismatch(
                        delivery_note=note,
                        gr_number=", ".join(r["gr_number"] for r in rows),
                        po_number=rows[0]["po_number"],
                        supplier_id=rows[0]["supplier_id"],
                        part=part,
                        booked=booked,
                        actual=actual,
                        correction=corrections.get(part),
                        in_stock=any(r["gr_number"] in batches for r in rows),
                        path=path,
                    )
                )
    return found


def stock_adjustments(mismatches: list[Mismatch]) -> dict[str, int]:
    """Return the stock correction per part, for batches still in stock."""
    adjustments: dict[str, int] = defaultdict(int)
    for m in mismatches:
        if m.in_stock:
            adjustments[m.part] += m.delta
    return dict(adjustments)
