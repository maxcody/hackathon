from datetime import date
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Product(Base):
    """A finished good we sell (an edition of a game), from ``master/products.csv``."""

    __tablename__ = "products"

    product_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    product_line: Mapped[str] = mapped_column(String(64))
    lifecycle: Mapped[str] = mapped_column(String(16))
    launch_date: Mapped[date] = mapped_column(Date)
    weekly_plan_qty: Mapped[int] = mapped_column(Integer)
    day_one_qty: Mapped[int | None] = mapped_column(Integer, default=None)
    plants: Mapped[str] = mapped_column(String(64))
    std_cost_eur: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    valid_from: Mapped[date] = mapped_column(Date)
    bom: Mapped[list["BomLine"]] = relationship(
        lazy="selectin", order_by="BomLine.child_id"
    )


class Component(Base):
    """A part that goes into a product, from ``master/components.csv``.

    ``drawing_rev`` is the current revision after ``components_update_*.csv``.
    """

    __tablename__ = "components"

    component_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    description: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(64))
    uom: Mapped[str] = mapped_column(String(8))
    abc_class: Mapped[str] = mapped_column(String(1))
    critical: Mapped[bool] = mapped_column(Boolean)
    drawing_rev: Mapped[str] = mapped_column(String(8))


class BomLine(Base):
    """One part of a product's bill of materials, from ``master/bom.csv``."""

    __tablename__ = "bom_lines"
    __table_args__ = (UniqueConstraint("parent_id", "child_id", "valid_from"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    parent_id: Mapped[str] = mapped_column(
        ForeignKey("products.product_id"), index=True
    )
    child_id: Mapped[str] = mapped_column(ForeignKey("components.component_id"))
    qty_per: Mapped[int] = mapped_column(Integer)
    valid_from: Mapped[date] = mapped_column(Date)
    valid_to: Mapped[date] = mapped_column(Date)


class BomChange(Base):
    """An engineering change on a BOM line, from ``master/bom_delta_*.csv``.

    Kept as published: ``use_up_old_rev`` decides whether stock of the old
    revision may still be packed, so it is not applied silently.
    """

    __tablename__ = "bom_changes"

    change_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    parent_id: Mapped[str] = mapped_column(ForeignKey("products.product_id"))
    child_id: Mapped[str] = mapped_column(ForeignKey("components.component_id"))
    action: Mapped[str] = mapped_column(String(16))
    qty_per_old: Mapped[int] = mapped_column(Integer)
    qty_per_new: Mapped[int] = mapped_column(Integer)
    rev_old: Mapped[str] = mapped_column(String(8))
    rev_new: Mapped[str] = mapped_column(String(8))
    use_up_old_rev: Mapped[bool] = mapped_column(Boolean)
    effective_from: Mapped[date] = mapped_column(Date)
    reason: Mapped[str] = mapped_column(String(512))
