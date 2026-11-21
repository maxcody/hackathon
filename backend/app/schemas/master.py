from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class _Orm(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ComponentRead(_Orm):
    """A part, with its current drawing revision."""

    component_id: str
    description: str
    category: str
    uom: str
    abc_class: str
    critical: bool
    drawing_rev: str


class BomLineRead(_Orm):
    """One part of a product's bill of materials."""

    child_id: str
    qty_per: int
    valid_from: date
    valid_to: date


class ProductRead(_Orm):
    """A finished good without its BOM."""

    product_id: str
    name: str
    product_line: str
    lifecycle: str
    launch_date: date
    weekly_plan_qty: int
    day_one_qty: int | None
    plants: str
    std_cost_eur: Decimal


class ProductDetail(ProductRead):
    """A finished good with its bill of materials."""

    bom: list[BomLineRead]


class BomChangeRead(_Orm):
    """An engineering change on a BOM line."""

    change_id: str
    parent_id: str
    child_id: str
    action: str
    qty_per_old: int
    qty_per_new: int
    rev_old: str
    rev_new: str
    use_up_old_rev: bool
    effective_from: date
    reason: str
