"""Load the master data CSVs into Postgres.

The files stay the source of truth: a re-import overwrites rows with what the
latest sync downloaded, so a new portal drop is one ``POST /master/import`` away.
Files are recognised by their header columns, not their names or folders, since
the portal renames and re-dates files without notice.
"""

import csv
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.data import data_root
from app.models import BomChange, BomLine, Component, Product

COMPONENT_FIELDS = {"drawing_rev", "critical", "abc_class"}


@dataclass
class ImportSummary:
    """Row counts of one import, plus component updates that were not applied."""

    products: int = 0
    components: int = 0
    bom_lines: int = 0
    bom_changes: int = 0
    skipped_updates: list[str] = field(default_factory=list)


# Columns that identify each kind of file (a file matches if it has all of them)
SIGNATURES = {
    "products": {"product_id", "day_one_qty"},
    "components": {"component_id", "drawing_rev", "critical"},
    "bom": {"parent_id", "child_id", "qty_per", "valid_to"},
    "bom_changes": {"change_id", "parent_id", "child_id", "use_up_old_rev"},
    "component_updates": {"component_id", "field", "new"},
}
REQUIRED = ("products", "components", "bom")  # changes and updates may be absent


def _scan() -> dict[str, list[dict[str, str]]]:
    """Read every CSV under ``soony/`` and sort its rows by file kind.

    Files are read in path order, so dated names apply oldest first. CSVs that
    match no kind (purchase orders, stock, ...) are ignored.
    """
    found: dict[str, list[dict[str, str]]] = {kind: [] for kind in SIGNATURES}
    for path in sorted((data_root() / "soony").rglob("*.csv")):
        try:
            with open(path, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                columns = set(reader.fieldnames or [])
                kind = next(
                    (k for k, need in SIGNATURES.items() if need <= columns), None
                )
                if kind:
                    found[kind].extend(reader)
        except UnicodeDecodeError:
            continue  # not a UTF-8 CSV we know how to read
    return found


def _flag(value: str) -> bool:
    return value.strip().upper() == "Y"


def _int(value: str) -> int | None:
    return int(value) if value.strip() else None


def _product(r: dict[str, str]) -> Product:
    return Product(
        product_id=r["product_id"],
        name=r["name"],
        product_line=r["product_line"],
        lifecycle=r["lifecycle"],
        launch_date=date.fromisoformat(r["launch_date"]),
        weekly_plan_qty=int(r["weekly_plan_qty"]),
        day_one_qty=_int(r["day_one_qty"]),
        plants=r["plants"],
        std_cost_eur=r["std_cost_eur"],
        valid_from=date.fromisoformat(r["valid_from"]),
    )


def _component(r: dict[str, str]) -> Component:
    return Component(
        component_id=r["component_id"],
        description=r["description"],
        category=r["category"],
        uom=r["uom"],
        abc_class=r["abc_class"],
        critical=_flag(r["critical"]),
        drawing_rev=r["drawing_rev"],
    )


def _bom_line(r: dict[str, str]) -> BomLine:
    return BomLine(
        parent_id=r["parent_id"],
        child_id=r["child_id"],
        qty_per=int(r["qty_per"]),
        valid_from=date.fromisoformat(r["valid_from"]),
        valid_to=date.fromisoformat(r["valid_to"]),
    )


def _bom_change(r: dict[str, str]) -> BomChange:
    return BomChange(
        change_id=r["change_id"],
        parent_id=r["parent_id"],
        child_id=r["child_id"],
        action=r["action"],
        qty_per_old=int(r["qty_per_old"]),
        qty_per_new=int(r["qty_per_new"]),
        rev_old=r["rev_old"],
        rev_new=r["rev_new"],
        use_up_old_rev=_flag(r["use_up_old_rev"]),
        effective_from=date.fromisoformat(r["effective_from"]),
        reason=r["reason"],
    )


def _apply_updates(
    components: dict[str, Component], updates: list[dict[str, str]]
) -> list[str]:
    """Apply ``components_update_*.csv`` in file order; return the ones skipped."""
    skipped = []
    for u in updates:
        comp, name = components.get(u["component_id"]), u["field"]
        if comp is None or name not in COMPONENT_FIELDS:
            skipped.append(f"{u['component_id']}.{name}")
            continue
        setattr(comp, name, _flag(u["new"]) if name == "critical" else u["new"])
    return skipped


async def import_master(session: AsyncSession) -> ImportSummary:
    """Replace the master tables with the current CSV contents.

    Args:
        session: Active database session; committed on success.

    Returns:
        Row counts and any component updates that named an unknown field or part.

    Raises:
        FileNotFoundError: If no file for products, components or BOM is found.
    """
    rows = _scan()
    missing = [kind for kind in REQUIRED if not rows[kind]]
    if missing:
        raise FileNotFoundError(f"no CSV found for: {', '.join(missing)}")
    # A later file may restate a row; the last one wins
    products = list({p.product_id: p for p in map(_product, rows["products"])}.values())
    components = {c.component_id: c for c in map(_component, rows["components"])}
    skipped = _apply_updates(components, rows["component_updates"])
    lines = list(
        {
            (b.parent_id, b.child_id, b.valid_from): b
            for b in map(_bom_line, rows["bom"])
        }.values()
    )
    changes = list(
        {c.change_id: c for c in map(_bom_change, rows["bom_changes"])}.values()
    )

    # Children first so foreign keys hold; parents are re-created before children
    for table in (BomChange, BomLine, Component, Product):
        await session.execute(delete(table))
    session.add_all([*products, *components.values()])
    await session.flush()
    session.add_all([*lines, *changes])
    await session.commit()
    return ImportSummary(
        len(products), len(components), len(lines), len(changes), skipped
    )
