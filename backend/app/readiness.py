"""Launch readiness from the ERP files: packed per edition and part coverage.

Everything is computed from the files in ``DATA_DIR`` as the ERP states them.
The ERP can be wrong (that is what the risk check finds), so the dashboard
shows these figures next to the open notifications for the same parts.
"""

import csv
import re
from collections import defaultdict
from pathlib import Path

from pydantic import BaseModel

from app.data import data_root, read_csv, read_workbook

SITE = "DC-HAM"
SOURCES = [
    "soony/master/products.csv",
    "soony/master/bom.csv",
    "soony/master/components.csv",
    "soony/erp/packout_log.csv",
    "soony/erp/stock_snapshot.csv",
    "soony/erp/goods_receipts.csv",
    "soony/erp/goods_receipts_update.csv",
    "soony/erp/open_shipments.csv",
]


class Edition(BaseModel):
    """Day-one progress of one launch product."""

    product_id: str
    name: str
    day_one: int
    packed: int
    remaining: int
    last_packed: str | None
    rate_per_hour: int | None = None  # current pack-out rate (launch status)
    hours_left: float | None = None  # remaining / rate


class Inbound(BaseModel):
    """A shipment to the site that is due before launch (quantity not in ERP)."""

    shipment_id: str
    mode: str
    eta: str
    status: str
    supplier_id: str


class PartCoverage(BaseModel):
    """Whether the stock of one part covers what is still to pack."""

    component_id: str
    description: str
    critical: bool
    used_in: list[str]
    need: int
    stock: int
    received_since: int
    available: int
    balance: int
    inbound: list[Inbound]
    suppliers: list[str]
    fitted_into: str | None = None  # supplied inside another part, not stocked


class Readiness(BaseModel):
    """Launch readiness as the ERP files state it."""

    launch_date: str
    snapshot_date: str | None
    editions: list[Edition]
    parts: list[PartCoverage]
    sources: list[str]


def _int(value: str | None) -> int:
    """Parse an ERP quantity, treating blanks as zero."""
    try:
        return int(float(value or 0))
    except ValueError:
        return 0


def _suppliers() -> tuple[dict[str, list[str]], dict[str, str]]:
    """Map components to supplier names, and to the part they are fitted into.

    A supplier note like "fitted by supplier into CMP-GAM-007" means the part
    arrives inside another one and is never stocked on its own.
    """
    found: dict[str, list[str]] = defaultdict(list)
    fitted: dict[str, str] = {}
    for folder in sorted((data_root() / "suppliers").glob("*")):
        components, profile = folder / "components.csv", folder / "profile.csv"
        if not (components.exists() and profile.exists()):
            continue
        with profile.open(encoding="utf-8-sig") as f:
            name = next(csv.DictReader(f), {}).get("name") or folder.name
        with components.open(encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                found[row["component_id"]].append(name)
                into = re.search(r"fitted [^;]*?into ([\w-]+)", row.get("note", ""))
                if into:
                    fitted[row["component_id"]] = into.group(1)
    return found, fitted


def _qty(text: str | None) -> int:
    """Parse a sheet quantity; German thousands like ``42.900`` mean 42,900."""
    text = (text or "").strip()
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", text):
        return int(text.replace(".", ""))
    return _int(text)


def _tables(path: Path) -> dict[str, tuple[str, list[dict[str, str]]]]:
    """Read each sheet as (title line, rows keyed by the header labels).

    The header is the first row that has both ``Material``/``Product`` and a
    quantity column; the title is the sheet's first row (e.g. "... 20:50").
    """
    tables = {}
    for sheet, rows in read_workbook(path).items():
        numbers = sorted(rows)
        title = " ".join(rows[numbers[0]].values()) if numbers else ""
        header = next(
            (
                n
                for n in numbers
                if {"Qty", "Packed"} & set(rows[n].values())
                and {"Material", "Product"} & set(rows[n].values())
            ),
            None,
        )
        if header is None:
            continue
        labels = rows[header]
        tables[sheet] = (
            title,
            [
                {labels[col]: value for col, value in rows[n].items() if col in labels}
                for n in numbers
                if n > header
            ],
        )
    return tables


def _latest_update() -> tuple[str, str, dict[str, int], dict[str, int]] | None:
    """Newest ``erp/stock_update_<date>.xlsx``: date, packed-at note, stock, packed.

    Stock is book stock after the day's receipts; packed is total copies packed.
    """
    files = sorted((data_root() / "soony" / "erp").glob("stock_update_*.xlsx"))
    if not files:
        return None
    date = files[-1].stem.rsplit("_", 1)[-1]
    stock: dict[str, int] = defaultdict(int)
    packed: dict[str, int] = {}
    as_of = date
    for title, rows in _tables(files[-1]).values():
        for row in rows:
            if row.get("Site") != SITE or not row.get("Material"):
                continue
            if "Packed today" in row:  # the finished-goods table
                packed[row["Material"]] = _qty(row.get("Qty"))
                stamp = re.search(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", title)
                as_of = stamp.group(0) if stamp else as_of
            else:
                stock[row["Material"]] += _qty(row.get("Qty"))
    return date, as_of, stock, packed


def _rates() -> dict[str, int]:
    """Pack-out rate per hour by product from ``context/launch_status.xlsx``."""
    path = data_root() / "soony" / "context" / "launch_status.xlsx"
    if not path.exists():
        return {}
    return {
        row["Product"]: _qty(row.get("Rate per hour"))
        for _, rows in _tables(path).values()
        for row in rows
        if row.get("Product") and row.get("Rate per hour")
    }


def _rows(rel: str) -> list[dict[str, str]]:
    """Read a CSV under ``soony/``; an optional file that is missing is empty."""
    path: Path = data_root() / "soony" / rel
    return read_csv(rel) if path.exists() else []


def compute() -> Readiness:
    """Compute editions and part coverage from the ERP and master files.

    Raises:
        FileNotFoundError: If a required file (products, BOM, stock) is missing.
    """
    products = [p for p in read_csv("master/products.csv") if _int(p["day_one_qty"])]
    launch = min(p["launch_date"] for p in products) if products else ""
    packed: dict[str, int] = defaultdict(int)
    last: dict[str, str] = {}
    for row in _rows("erp/packout_log.csv"):
        if row["site"] == SITE:
            packed[row["product_id"]] += _int(row["units_packed"])
            last[row["product_id"]] = max(last.get(row["product_id"], ""), row["date"])

    stock_rows = [r for r in read_csv("erp/stock_snapshot.csv") if r["site"] == SITE]
    snapshot = max((r["snapshot_date"] for r in stock_rows), default=None)
    stock: dict[str, int] = defaultdict(int)
    for row in stock_rows:
        if row["snapshot_date"] == snapshot:
            stock[row["material_id"]] += _int(row["quantity"])
    update = _latest_update()
    if update and (snapshot is None or update[0] >= snapshot):
        # The day's stock update is newer: its book stock and packed counts win
        snapshot, as_of, stock, packed_now = update
        stock = defaultdict(int, stock)
        for product, qty in packed_now.items():
            packed[product] = qty
            last[product] = as_of

    rates = _rates()
    editions = []
    for p in products:
        pid, day_one = p["product_id"], _int(p["day_one_qty"])
        left = max(0, day_one - packed[pid])
        rate = rates.get(pid) or None
        editions.append(
            Edition(
                product_id=pid,
                name=p["name"],
                day_one=day_one,
                packed=packed[pid],
                remaining=left,
                last_packed=last.get(pid),
                rate_per_hour=rate,
                hours_left=round(left / rate, 1) if rate else None,
            )
        )
    remaining = {e.product_id: e.remaining for e in editions}

    need: dict[str, int] = defaultdict(int)
    used_in: dict[str, list[str]] = defaultdict(list)
    for line in read_csv("master/bom.csv"):
        parent = line["parent_id"]
        valid = line["valid_from"] <= launch <= (line["valid_to"] or "9999-12-31")
        if parent in remaining and valid:
            need[line["child_id"]] += remaining[parent] * _int(line["qty_per"])
            used_in[line["child_id"]].append(parent)

    received: dict[str, int] = defaultdict(int)
    for rel in ("erp/goods_receipts.csv", "erp/goods_receipts_update.csv"):
        for row in _rows(rel):
            if row["plant"] == SITE and snapshot and row["gr_date"] > snapshot:
                received[row["material_id"]] += _int(row["qty_received"])

    inbound: dict[str, list[Inbound]] = defaultdict(list)
    for row in _rows("erp/open_shipments.csv"):
        if row["dest_site"] != SITE or not row["eta"] or row["eta"][:10] > launch:
            continue
        shipment = Inbound(
            shipment_id=row["shipment_id"],
            mode=row["mode"],
            eta=row["eta"],
            status=row["status"],
            supplier_id=row["supplier_id"],
        )
        for material in filter(None, row["material_ids"].split("|")):
            inbound[material].append(shipment)

    components = {c["component_id"]: c for c in read_csv("master/components.csv")}
    suppliers, fitted = _suppliers()
    parts = []
    for part_id in sorted(need):
        part = components.get(part_id, {})
        available = stock[part_id] + received[part_id]
        parts.append(
            PartCoverage(
                component_id=part_id,
                description=part.get("description", part_id),
                critical=part.get("critical") == "Y",
                used_in=used_in[part_id],
                need=need[part_id],
                stock=stock[part_id],
                received_since=received[part_id],
                available=available,
                balance=available - need[part_id],
                inbound=inbound[part_id],
                suppliers=suppliers.get(part_id, []),
                fitted_into=fitted.get(part_id),
            )
        )
    parts.sort(key=lambda p: (p.fitted_into is not None, p.balance))
    return Readiness(
        launch_date=launch,
        snapshot_date=snapshot,
        editions=editions,
        parts=parts,
        sources=SOURCES,
    )
