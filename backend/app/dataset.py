"""Read-only, linked tables of the Soony data folder for the dashboard's Data tab.

Each dataset has a fixed column spec: a label, a ``kind`` that tells the
dashboard how to format the value (date, quantity, money, status, ...) and, for
ids, which dataset it links to (part, supplier, PO, shipment). Rows keep the raw
ids so links can filter the target table; ``Lookups`` give the names to show
next to them and the documents (scans, order confirmations) behind them.
"""

import csv
import re
from collections.abc import Callable
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from app.data import data_root, read_csv
from app.readiness import _qty, compute

OPEN_PO = {"open", "awaiting_approval"}  # PO lines still to be delivered
RECENT_DAYS = 21  # receipts shown: the last three weeks before launch
DOCUMENT_FOLDERS = (
    "suppliers/*/notices",
    "suppliers/*/order_confirmations",
    "suppliers/*/contracts",
    "soony/receiving",
    "soony/receiving/*",
    "soony/context",
    "soony/news",
)

Kind = Literal[
    "text",
    "qty",
    "money",
    "date",
    "status",
    "flag",
    "balance",
    "part",
    "supplier",
    "po",
    "shipment",
    "delivery_note",
    "file",
]
# Which dataset (and column) a linkable kind opens, filtered to the clicked id
LINKS: dict[str, tuple[str, str]] = {
    "part": ("parts", "component_id"),
    "supplier": ("suppliers", "supplier_id"),
    "po": ("purchase_orders", "po_number"),
    "shipment": ("shipments", "shipment_id"),
}


class Column(BaseModel):
    """How the dashboard shows one column."""

    key: str
    label: str
    kind: Kind = "text"
    multi: bool = False  # several ids separated by "|"


class Related(BaseModel):
    """A link from each row to rows of another dataset with the same id."""

    label: str
    dataset: str
    column: str  # filter column in the target dataset
    value_from: str  # column of this row that holds the id


class Dataset(BaseModel):
    """One table for the Data tab."""

    key: str
    title: str
    source: str
    columns: list[Column]
    related: list[Related] = []
    rows: list[dict[str, str | int | float | None]]


class DatasetInfo(BaseModel):
    """A dataset in the Data tab's list."""

    key: str
    title: str
    description: str


class Lookups(BaseModel):
    """Names and documents behind the ids in the tables."""

    parts: dict[str, str]  # component or product id -> description
    suppliers: dict[str, str]  # supplier id -> name
    documents: dict[str, list[str]]  # delivery note or PO number -> file paths
    open_orders: list[str]  # PO numbers listed under "Open orders"


def _csv(rel: str) -> list[dict]:
    """Read a CSV under ``soony/`` if it exists."""
    return read_csv(rel) if (data_root() / "soony" / rel).exists() else []


def _latest(pattern: str) -> Path | None:
    """Newest file under ``soony/`` matching a glob (names carry the date)."""
    files = sorted((data_root() / "soony").glob(pattern))
    return files[-1] if files else None


def _profiles() -> list[dict[str, str]]:
    """Every supplier profile row."""
    rows = []
    for path in sorted((data_root() / "suppliers").glob("*/profile.csv")):
        with path.open(encoding="utf-8-sig") as f:
            row = next(csv.DictReader(f), None)
        if row:
            rows.append(row)
    return rows


def _launch_date() -> str:
    """The launch date of the products with a day-one quantity."""
    dates = [p["launch_date"] for p in _csv("master/products.csv") if p["day_one_qty"]]
    return min(dates) if dates else "9999-12-31"


def _shipments() -> tuple[str, list[dict]]:
    launch = _launch_date()
    rows = [
        {**r, "before_launch": "Y" if r["eta"][:10] <= launch else "N"}
        for r in _csv("erp/open_shipments.csv")
        if r.get("status") != "delivered"
    ]
    return "erp/open_shipments.csv (not yet delivered)", sorted(
        rows, key=lambda r: r["eta"]
    )


def _money(row: dict) -> str:
    """Unit price with its currency, e.g. ``2.10 EUR``."""
    price, currency = row.get("unit_price"), row.get("currency")
    return f"{price} {currency}".strip() if price else ""


def _purchase_orders() -> tuple[str, list[dict]]:
    # The current SAP export; the *_legacy_* file predates the 2025 interface
    # change and uses another format (semicolons, US dates)
    path = _latest("erp/purchase_orders_2*.csv")
    if not path:
        return "", []
    launch_parts = {p.component_id for p in compute().parts}
    rows = [
        {**r, "quantity": _qty(r["quantity"]), "unit_price": _money(r)}
        for r in read_csv(f"erp/{path.name}")
        if r["status"] in OPEN_PO and r["material_id"] in launch_parts
    ]
    rows.sort(key=lambda r: r.get("promised_date") or "")
    return f"erp/{path.name} (open lines for launch parts)", rows


def _receipts() -> tuple[str, list[dict]]:
    rows = [
        {
            **r,
            "qty_ordered": _qty(r["qty_ordered"]),
            "qty_received": _qty(r["qty_received"]),
        }
        for r in _csv("erp/goods_receipts.csv") + _csv("erp/goods_receipts_update.csv")
    ]
    since = (
        date.fromisoformat(_launch_date()) - timedelta(days=RECENT_DAYS)
    ).isoformat()
    rows = [r for r in rows if r["gr_date"] >= since]
    rows.sort(key=lambda r: r["gr_date"], reverse=True)
    return f"erp/goods_receipts*.csv (since {since})", rows


def _parts() -> tuple[str, list[dict]]:
    """Launch parts: what is still needed against today's stock (see readiness)."""
    rules = {
        r["child_id"]: f"rev {r['rev_old']} → {r['rev_new']}"
        + ("" if r["use_up_old_rev"] == "Y" else ", old stock not allowed")
        for path in sorted((data_root() / "soony/master").glob("bom_delta_*.csv"))
        for r in read_csv(f"master/{path.name}")
    }
    critical = {c["component_id"]: c["critical"] for c in _csv("master/components.csv")}
    for path in sorted((data_root() / "soony/master").glob("components_update_*.csv")):
        for u in read_csv(f"master/{path.name}"):
            if u["field"] == "critical":  # today's master data changes win
                critical[u["component_id"]] = u["new"]
    ready = compute()
    supplier_ids = _part_suppliers()
    rows = [
        {
            "component_id": p.component_id,
            "used_in": "|".join(p.used_in),
            "critical": critical.get(p.component_id, ""),
            "need": None if p.fitted_into else p.need,
            "stock": None if p.fitted_into else p.stock,
            "balance": None if p.fitted_into else p.balance,
            "revision": rules.get(p.component_id, ""),
            "note": (
                f"fitted into {p.fitted_into} by the supplier" if p.fitted_into else ""
            ),
            "suppliers": "|".join(supplier_ids.get(p.component_id, [])),
        }
        for p in ready.parts
    ]
    return f"master + stock as of {ready.snapshot_date} (ERP book figures)", rows


def _part_suppliers() -> dict[str, list[str]]:
    """Supplier ids per component from ``suppliers/*/components.csv``."""
    found: dict[str, list[str]] = {}
    for profile in _profiles():
        for folder in (data_root() / "suppliers").glob(f"{profile['supplier_id']}_*"):
            if (folder / "components.csv").exists():
                with (folder / "components.csv").open(encoding="utf-8-sig") as f:
                    for r in csv.DictReader(f):
                        found.setdefault(r["component_id"], []).append(
                            profile["supplier_id"]
                        )
    return found


def _suppliers() -> tuple[str, list[dict]]:
    rows = []
    for p in _profiles():
        folder = next((data_root() / "suppliers").glob(f"{p['supplier_id']}_*"))
        parts = []
        if (folder / "components.csv").exists():
            with (folder / "components.csv").open(encoding="utf-8-sig") as f:
                parts = [r["component_id"] for r in csv.DictReader(f)]
        rows.append(
            {
                "supplier_id": p["supplier_id"],
                "country": p.get("country"),
                "language": p.get("preferred_language"),
                "status": p.get("status"),
                "qualification": p.get("qualification_status"),
                "contact": p.get("contact_name"),
                "email": p.get("contact_email"),
                "phone": p.get("phone"),
                "parts": "|".join(parts),
                "notes": p.get("notes"),
            }
        )
    return "suppliers/*/profile.csv + components.csv", rows


def _notices() -> tuple[str, list[dict]]:
    """Supplier notices and market news: early warnings."""
    root = data_root()
    paths = sorted(root.glob("suppliers/*/notices/*")) + sorted(
        root.glob("soony/news/*")
    )
    rows = []
    for path in paths:
        rel = path.relative_to(root).as_posix()
        stamp = re.search(r"(\d{4})-?(\d{2})-?(\d{2})", path.name)
        rows.append(
            {
                "path": rel,
                "dated": "-".join(stamp.groups()) if stamp else "",
                "supplier_id": (
                    rel.split("/")[1].split("_")[0]
                    if rel.startswith("suppliers/")
                    else ""
                ),
                "type": (
                    "price list"
                    if "price" in path.name.lower()
                    else "news" if rel.startswith("soony/news") else "notice"
                ),
            }
        )
    rows.sort(key=lambda r: r["dated"], reverse=True)
    return "suppliers/*/notices, soony/news", rows


def _document_paths() -> list[Path]:
    """Every document file, each once."""
    root, seen = data_root(), []
    for pattern in DOCUMENT_FOLDERS:
        for path in sorted(root.glob(f"{pattern}/*")):
            if path.is_file() and path not in seen:
                seen.append(path)
    return seen


Reader = Callable[[], tuple[str, list[dict]]]
C = Column
DATASETS: dict[str, tuple[str, str, Reader, list[Column], list[Related]]] = {
    "parts": (
        "Parts & stock",
        "Launch parts: still needed, stock today, balance, suppliers",
        _parts,
        [
            C(key="component_id", label="Part", kind="part"),
            C(key="used_in", label="Used in", kind="part", multi=True),
            C(key="critical", label="Critical", kind="flag"),
            C(key="need", label="Still needed", kind="qty"),
            C(key="stock", label="Book stock", kind="qty"),
            C(key="balance", label="Balance", kind="balance"),
            C(key="revision", label="Revision rule"),
            C(key="note", label="Note"),
            C(key="suppliers", label="Suppliers", kind="supplier", multi=True),
        ],
        [
            Related(
                label="Orders",
                dataset="purchase_orders",
                column="material_id",
                value_from="component_id",
            ),
            Related(
                label="Receipts",
                dataset="receipts",
                column="material_id",
                value_from="component_id",
            ),
            Related(
                label="Shipments",
                dataset="shipments",
                column="material_ids",
                value_from="component_id",
            ),
        ],
    ),
    "shipments": (
        "Inbound shipments",
        "Not yet delivered, by arrival; before or after launch",
        _shipments,
        [
            C(key="shipment_id", label="Shipment", kind="shipment"),
            C(key="supplier_id", label="Supplier", kind="supplier"),
            C(key="material_ids", label="Parts", kind="part", multi=True),
            C(key="po_numbers", label="Orders", kind="po", multi=True),
            C(key="mode", label="Mode", kind="status"),
            C(key="origin", label="From"),
            C(key="eta", label="Arrives", kind="date"),
            C(key="before_launch", label="Before launch", kind="flag"),
            C(key="status", label="Status", kind="status"),
            C(key="note", label="Note"),
        ],
        [],
    ),
    "purchase_orders": (
        "Open orders",
        "PO lines for launch parts still to be delivered",
        _purchase_orders,
        [
            C(key="po_number", label="Order", kind="po"),
            C(key="po_line", label="Line"),
            C(key="supplier_id", label="Supplier", kind="supplier"),
            C(key="material_id", label="Part", kind="part"),
            C(key="quantity", label="Qty", kind="qty"),
            C(key="unit_price", label="Unit price", kind="money"),
            C(key="requested_date", label="Requested", kind="date"),
            C(key="promised_date", label="Promised", kind="date"),
            C(key="status", label="Status", kind="status"),
            C(key="buyer", label="Buyer"),
            C(key="note", label="Note"),
        ],
        [
            Related(
                label="Receipts",
                dataset="receipts",
                column="po_number",
                value_from="po_number",
            )
        ],
    ),
    "receipts": (
        "Recent receipts",
        "What receiving booked in the last three weeks, with the delivery note",
        _receipts,
        [
            C(key="gr_date", label="Received", kind="date"),
            C(key="delivery_note", label="Delivery note", kind="delivery_note"),
            C(key="po_number", label="Order", kind="po"),
            C(key="supplier_id", label="Supplier", kind="supplier"),
            C(key="material_id", label="Part", kind="part"),
            C(key="qty_ordered", label="Ordered", kind="qty"),
            C(key="qty_received", label="Booked", kind="qty"),
            C(key="remark", label="Remark"),
        ],
        [],
    ),
    "suppliers": (
        "Suppliers",
        "Who to call: contact, language, status, parts",
        _suppliers,
        [
            C(key="supplier_id", label="Supplier", kind="supplier"),
            C(key="country", label="Country"),
            C(key="language", label="Language"),
            C(key="qualification", label="Qualification", kind="status"),
            C(key="contact", label="Contact"),
            C(key="email", label="Email"),
            C(key="phone", label="Phone"),
            C(key="parts", label="Parts", kind="part", multi=True),
            C(key="notes", label="Notes"),
        ],
        [
            Related(
                label="Orders",
                dataset="purchase_orders",
                column="supplier_id",
                value_from="supplier_id",
            ),
            Related(
                label="Shipments",
                dataset="shipments",
                column="supplier_id",
                value_from="supplier_id",
            ),
            Related(
                label="Notices",
                dataset="notices",
                column="supplier_id",
                value_from="supplier_id",
            ),
        ],
    ),
    "notices": (
        "Supplier notices",
        "Shutdowns, offers, licences, price lists and market news",
        _notices,
        [
            C(key="dated", label="Dated", kind="date"),
            C(key="path", label="Document", kind="file"),
            C(key="type", label="Type", kind="status"),
            C(key="supplier_id", label="Supplier", kind="supplier"),
        ],
        [],
    ),
}


def catalog() -> list[DatasetInfo]:
    """The datasets the Data tab offers."""
    return [
        DatasetInfo(key=k, title=spec[0], description=spec[1])
        for k, spec in DATASETS.items()
    ]


def load(key: str) -> Dataset:
    """Read one dataset; columns the data does not have are left out.

    Raises:
        KeyError: If ``key`` is not a known dataset.
    """
    title, _, read, columns, related = DATASETS[key]
    source, rows = read()
    present = {col for row in rows for col in row}
    return Dataset(
        key=key,
        title=title,
        source=source,
        columns=[c for c in columns if c.key in present],
        related=related,
        rows=rows,
    )


def lookups() -> Lookups:
    """Part and supplier names, and the documents behind delivery notes and POs."""
    parts = {c["component_id"]: c["description"] for c in _csv("master/components.csv")}
    parts |= {p["product_id"]: p["name"] for p in _csv("master/products.csv")}
    suppliers = {
        p["supplier_id"]: p.get("name") or p["supplier_id"] for p in _profiles()
    }
    documents: dict[str, list[str]] = {}
    root = data_root()
    for path in _document_paths():
        rel = path.relative_to(root).as_posix()
        # delivery notes (WZ-/DN-/SN-...) and PO numbers (45...) in file names
        for token in re.findall(r"[A-Z]{2}-\d{6}-\d{3}|45\d{8}", path.name):
            documents.setdefault(token, []).append(rel)
    open_orders = sorted({r["po_number"] for r in _purchase_orders()[1]})
    return Lookups(
        parts=parts, suppliers=suppliers, documents=documents, open_orders=open_orders
    )


def resolve(rel: str) -> Path:
    """Return a file inside the data folder, refusing anything outside it.

    Raises:
        FileNotFoundError: If the path leaves the data folder or does not exist.
    """
    root = data_root().resolve()
    path = (root / rel).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise FileNotFoundError(rel)
    return path
