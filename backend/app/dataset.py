"""Read-only tables of the Soony data folder for the dashboard's Data tab.

Each dataset is a list of rows with fixed columns, read straight from the files
in ``DATA_DIR`` (newest version where there are several). Supplier ids get the
supplier's name appended, so the tables read without a lookup.
"""

import csv
from collections.abc import Callable
from pathlib import Path

from pydantic import BaseModel

from app.data import data_root, read_csv
from app.readiness import _qty, _tables

DOCUMENT_FOLDERS = (
    "suppliers/*/notices",
    "suppliers/*/order_confirmations",
    "suppliers/*/contracts",
    "soony/receiving",
    "soony/receiving/*",
    "soony/context",
    "soony/news",
)


class Dataset(BaseModel):
    """One table for the Data tab."""

    key: str
    title: str
    source: str
    columns: list[str]
    rows: list[dict[str, str | int | float | None]]


class DatasetInfo(BaseModel):
    """A dataset in the Data tab's list."""

    key: str
    title: str
    description: str


def _supplier_names() -> dict[str, str]:
    """Map supplier ids to names from ``suppliers/*/profile.csv``."""
    names = {}
    for profile in (data_root() / "suppliers").glob("*/profile.csv"):
        with profile.open(encoding="utf-8-sig") as f:
            row = next(csv.DictReader(f), None)
        if row:
            names[row["supplier_id"]] = row.get("name") or row["supplier_id"]
    return names


def _with_suppliers(rows: list[dict]) -> list[dict]:
    """Append the supplier name to every ``supplier_id`` value."""
    names = _supplier_names()
    for row in rows:
        sid = row.get("supplier_id")
        if sid in names:
            row["supplier_id"] = f"{sid} · {names[sid]}"
    return rows


def _csv(rel: str) -> list[dict]:
    """Read a CSV under ``soony/`` if it exists."""
    return read_csv(rel) if (data_root() / "soony" / rel).exists() else []


def _latest(pattern: str) -> Path | None:
    """Newest file under ``soony/`` matching a glob (names carry the date)."""
    files = sorted((data_root() / "soony").glob(pattern))
    return files[-1] if files else None


def _stock() -> tuple[str, list[dict]]:
    update = _latest("erp/stock_update_*.xlsx")
    if update:
        for title, rows in _tables(update).values():
            if rows and "Used today" in rows[0]:
                return f"{update.name} · {title}", [
                    {**r, "Qty": _qty(r.get("Qty"))} for r in rows if r.get("Material")
                ]
    return "erp/stock_snapshot.csv", _csv("erp/stock_snapshot.csv")


def _packed() -> tuple[str, list[dict]]:
    update = _latest("erp/stock_update_*.xlsx")
    if update:
        for title, rows in _tables(update).values():
            if rows and "Packed today" in rows[0]:
                return f"{update.name} · {title}", [
                    {**r, "Qty": _qty(r.get("Qty"))} for r in rows if r.get("Material")
                ]
    return "erp/packout_log.csv", _csv("erp/packout_log.csv")


def _shipments() -> tuple[str, list[dict]]:
    rows = sorted(_csv("erp/open_shipments.csv"), key=lambda r: r["eta"])
    return "erp/open_shipments.csv", _with_suppliers(rows)


def _purchase_orders() -> tuple[str, list[dict]]:
    # The current SAP export; the *_legacy_* file predates the 2025 interface
    # change and uses another format (semicolons, US dates)
    path = _latest("erp/purchase_orders_2*.csv")
    if not path:
        return "", []
    rows = read_csv(f"erp/{path.name}")
    rows.sort(key=lambda r: r.get("promised_date") or "", reverse=True)
    return f"erp/{path.name}", _with_suppliers(rows)


def _receipts() -> tuple[str, list[dict]]:
    rows = _csv("erp/goods_receipts.csv") + _csv("erp/goods_receipts_update.csv")
    rows.sort(key=lambda r: r["gr_date"], reverse=True)
    return "erp/goods_receipts.csv + goods_receipts_update.csv", _with_suppliers(rows)


def _parts() -> tuple[str, list[dict]]:
    uses: dict[str, list[str]] = {}
    for line in _csv("master/bom.csv"):
        uses.setdefault(line["child_id"], []).append(
            f"{line['parent_id']} ×{line['qty_per']}"
        )
    changes = {
        (u["component_id"], u["field"]): f"{u['old']} → {u['new']}"
        for path in sorted(
            (data_root() / "soony/master").glob("components_update_*.csv")
        )
        for u in read_csv(f"master/{path.name}")
    }
    rows = []
    for c in _csv("master/components.csv"):
        rev = changes.get((c["component_id"], "drawing_rev"))
        rows.append(
            {
                "component_id": c["component_id"],
                "description": c["description"],
                "critical": c["critical"],
                "drawing_rev": rev or c["drawing_rev"],
                "used_in": ", ".join(uses.get(c["component_id"], [])),
            }
        )
    return "master/components.csv + bom.csv + components_update_*.csv", rows


def _bom_changes() -> tuple[str, list[dict]]:
    path = _latest("master/bom_delta_*.csv")
    return (
        (f"master/{path.name}", read_csv(f"master/{path.name}")) if path else ("", [])
    )


def _suppliers() -> tuple[str, list[dict]]:
    rows = []
    for folder in sorted((data_root() / "suppliers").glob("*")):
        profile, parts = folder / "profile.csv", folder / "components.csv"
        if not profile.exists():
            continue
        with profile.open(encoding="utf-8-sig") as f:
            p = next(csv.DictReader(f), {})
        listed = []
        if parts.exists():
            with parts.open(encoding="utf-8-sig") as f:
                listed = [
                    f"{r['component_id']} ({float(r['share'] or 0):.0%}"
                    f"{', primary' if r.get('primary') == 'Y' else ''}, "
                    f"{r.get('lead_time_days')} d)"
                    for r in csv.DictReader(f)
                ]
        rows.append(
            {
                "supplier_id": p.get("supplier_id"),
                "name": p.get("name"),
                "country": p.get("country"),
                "language": p.get("preferred_language"),
                "status": f"{p.get('status')} / {p.get('qualification_status')}",
                "contact": f"{p.get('contact_name')} <{p.get('contact_email')}>",
                "phone": p.get("phone"),
                "parts": "; ".join(listed),
                "notes": p.get("notes"),
            }
        )
    return "suppliers/*/profile.csv + components.csv", rows


def _documents() -> tuple[str, list[dict]]:
    root = data_root()
    seen, rows = set(), []
    for pattern in DOCUMENT_FOLDERS:
        for path in sorted(root.glob(f"{pattern}/*")):
            if not path.is_file() or path in seen:
                continue
            seen.add(path)
            rel = path.relative_to(root).as_posix()
            rows.append(
                {
                    "path": rel,
                    "type": rel.split("/")[-2] if "/" in rel else "",
                    "supplier_id": (
                        rel.split("/")[1].split("_")[0]
                        if rel.startswith("suppliers/")
                        else ""
                    ),
                    "kb": round(path.stat().st_size / 1024),
                }
            )
    return (
        "suppliers/*/{notices,order_confirmations,contracts}, soony/…",
        _with_suppliers(rows),
    )


DATASETS: dict[str, tuple[str, str, Callable[[], tuple[str, list[dict]]]]] = {
    "stock": ("Stock today", "Book stock at DC-HAM after today's receipts", _stock),
    "packed": ("Packed copies", "Finished goods packed at DC-HAM", _packed),
    "shipments": (
        "Shipments",
        "Open inbound shipments with ETA and status",
        _shipments,
    ),
    "purchase_orders": (
        "Purchase orders",
        "PO lines, newest promised date first",
        _purchase_orders,
    ),
    "receipts": (
        "Goods receipts",
        "What receiving booked, with delivery note and remark",
        _receipts,
    ),
    "parts": (
        "Parts & BOM",
        "Components, where they are used, current revision",
        _parts,
    ),
    "bom_changes": (
        "BOM changes",
        "Engineering changes and whether old stock may be used",
        _bom_changes,
    ),
    "suppliers": (
        "Suppliers",
        "Contacts, language, status and the parts they deliver",
        _suppliers,
    ),
    "documents": (
        "Documents",
        "Notices, confirmations, contracts, delivery-note scans",
        _documents,
    ),
}


def catalog() -> list[DatasetInfo]:
    """The datasets the Data tab offers."""
    return [
        DatasetInfo(key=k, title=t, description=d) for k, (t, d, _) in DATASETS.items()
    ]


def load(key: str) -> Dataset:
    """Read one dataset.

    Raises:
        KeyError: If ``key`` is not a known dataset.
    """
    title, _, read = DATASETS[key]
    source, rows = read()
    columns = list(dict.fromkeys(col for row in rows for col in row))
    return Dataset(key=key, title=title, source=source, columns=columns, rows=rows)


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
