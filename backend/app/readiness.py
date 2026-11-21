"""Launch readiness: can the remaining copies be packed by Sunday 20:00?"""

from collections import defaultdict

from app.data import read_csv, read_xlsx, short_shipments, unstocked_parts

DEADLINE = "2026-11-22"  # ISO dates compare correctly as strings
TIGHT_RATIO = 0.10  # cover below 10% of need counts as at risk


def remaining_units() -> dict[str, int]:
    """Return copies still to pack per finished product, from the launch plan."""
    sheet = read_xlsx("context/launch_plan_GH6.xlsx", 1, header_row=3)
    return {r["Product"]: int(r["Still to pack"]) for r in sheet if "Product" in r}


def inbound() -> list[dict[str, str]]:
    """Return planned shipments, with quantities cut to what actually shipped."""
    shipped = short_shipments()
    rows = read_xlsx("context/launch_plan_GH6.xlsx", 3)
    for row in rows:
        if row.get("Reference") in shipped:
            row["Quantity"] = str(shipped[row["Reference"]])
            row["Comment"] = "short shipment: supplier shipped less than ordered"
    return rows


def _stock() -> dict[str, int]:
    stock: dict[str, int] = defaultdict(int)
    for row in read_csv("erp/stock_snapshot.csv"):
        stock[row["material_id"]] += int(row["quantity"])
    return stock


def parts_readiness(stock_adjustments: dict[str, int] | None = None) -> list[dict]:
    """Compare what the remaining pack-out needs with stock and inbound.

    Args:
        stock_adjustments: Corrections added to ERP stock per part (for example
            from delivery notes that disagree with goods receipts).

    Returns:
        One dict per part with need, stock, inbound by the deadline, late
        inbound, gap, cover, status and notes.
    """
    remaining = remaining_units()
    need: dict[str, int] = defaultdict(int)
    for row in read_csv("master/bom.csv"):
        if row["parent_id"] in remaining and row["valid_to"] >= DEADLINE:
            need[row["child_id"]] += remaining[row["parent_id"]] * int(row["qty_per"])
    names = {
        r["component_id"]: r["description"] for r in read_csv("master/components.csv")
    }
    stock = _stock()
    adjust = stock_adjustments or {}
    shipments = inbound()

    parts = []
    for part in sorted(set(need) - unstocked_parts()):
        rows = [r for r in shipments if r["Part"] == part]
        on_time = sum(int(r["Quantity"]) for r in rows if r["ETA"] <= DEADLINE)
        late = sum(int(r["Quantity"]) for r in rows if r["ETA"] > DEADLINE)
        have = stock[part] + adjust.get(part, 0)
        cover = have + on_time - need[part]
        parts.append(
            {
                "part": part,
                "description": names[part],
                "need": need[part],
                "stock": have,
                "inbound": on_time,
                "late_inbound": late,
                "gap": max(0, -cover),
                "cover": cover,
                "status": _status(cover, need[part]),
                "notes": [r["Comment"] for r in rows if r.get("Comment")],
            }
        )
    return parts


def _status(cover: int, need: int) -> str:
    if cover < 0:
        return "short"
    return "tight" if cover < need * TIGHT_RATIO else "ok"


def verdict(parts: list[dict]) -> str:
    """Return NO-GO if any part is short, AT RISK if any is tight, else GO."""
    statuses = {p["status"] for p in parts}
    return (
        "NO-GO" if "short" in statuses else "AT RISK" if "tight" in statuses else "GO"
    )
