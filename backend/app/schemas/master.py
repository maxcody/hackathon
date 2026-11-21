from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class _Read(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ProductCreate(BaseModel):
    """A finished good we sell."""

    product_id: str
    name: str
    product_line: str
    lifecycle: str
    launch_date: date
    weekly_plan_qty: int
    day_one_qty: int | None = None
    plants: str
    std_cost_eur: Decimal
    valid_from: date


class ComponentCreate(BaseModel):
    """A part that goes into a product."""

    component_id: str
    description: str
    category: str
    uom: str
    abc_class: str
    critical: bool
    drawing_rev: str


class BomLineCreate(BaseModel):
    """One part of a product's bill of materials."""

    parent_id: str
    child_id: str
    qty_per: int
    valid_from: date
    valid_to: date


class BomChangeCreate(BaseModel):
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


class ComponentRead(ComponentCreate, _Read):
    pass


class BomLineRead(BomLineCreate, _Read):
    id: int


class BomChangeRead(BomChangeCreate, _Read):
    pass


class ProductRead(ProductCreate, _Read):
    """A product with its bill of materials (read-only here; edit via /bom-lines)."""

    bom: list[BomLineRead]
