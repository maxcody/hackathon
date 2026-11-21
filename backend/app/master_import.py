"""Load the master data CSVs into Postgres.

The files stay the source of truth: a re-import overwrites rows with what the
latest sync downloaded, so a new portal drop is one ``POST /master/import`` away.
"""

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.data import read_csv
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
        FileNotFoundError: If the data folder has not been synced yet.
    """
    products = [_product(r) for r in read_csv("master/products.csv")]
    components = {
        c.component_id: c for c in map(_component, read_csv("master/components.csv"))
    }
    skipped = _apply_updates(
        components, read_csv("master/components_update_2026-11-21.csv")
    )
    lines = [_bom_line(r) for r in read_csv("master/bom.csv")]
    changes = [_bom_change(r) for r in read_csv("master/bom_delta_2026-11-21.csv")]

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
