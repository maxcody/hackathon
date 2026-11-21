from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.db import SessionDep
from app.master_import import ImportSummary, import_master
from app.models import BomChange, Component, Product
from app.schemas.master import (
    BomChangeRead,
    ComponentRead,
    ProductDetail,
    ProductRead,
)

router = APIRouter(tags=["master"])


@router.post("/master/import")
async def run_import(session: SessionDep) -> ImportSummary:
    """Reload products, components, BOM and engineering changes from the CSVs."""
    try:
        return await import_master(session)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=409, detail="run /sync first") from exc


@router.get("/products", response_model=list[ProductRead])
async def list_products(session: SessionDep):
    """Return all products."""
    return (await session.scalars(select(Product).order_by(Product.product_id))).all()


@router.get("/products/{product_id}", response_model=ProductDetail)
async def get_product(session: SessionDep, product_id: str):
    """Return one product with its bill of materials."""
    product = await session.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="product not found")
    return product


@router.get("/components", response_model=list[ComponentRead])
async def list_components(session: SessionDep, category: str | None = None):
    """Return all components, optionally for one category."""
    query = select(Component).order_by(Component.component_id)
    if category:
        query = query.where(Component.category == category)
    return (await session.scalars(query)).all()


@router.get("/components/{component_id}", response_model=ComponentRead)
async def get_component(session: SessionDep, component_id: str):
    """Return one component."""
    component = await session.get(Component, component_id)
    if component is None:
        raise HTTPException(status_code=404, detail="component not found")
    return component


@router.get("/bom-changes", response_model=list[BomChangeRead])
async def list_bom_changes(session: SessionDep):
    """Return engineering changes to the BOM, including the use-up-old-revision flag."""
    return (
        await session.scalars(select(BomChange).order_by(BomChange.change_id))
    ).all()
