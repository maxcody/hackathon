"""CRUD for the imported tables (the files themselves are loaded elsewhere)."""

from fastapi import APIRouter

from app.crud import crud_router
from app.models import BomChange, BomLine, Component, Product, SheetRow
from app.schemas.master import (
    BomChangeCreate,
    BomChangeRead,
    BomLineCreate,
    BomLineRead,
    ComponentCreate,
    ComponentRead,
    ProductCreate,
    ProductRead,
)
from app.schemas.sheet import SheetRowCreate, SheetRowRead

router = APIRouter()
for prefix, model, create, read in (
    ("/products", Product, ProductCreate, ProductRead),
    ("/components", Component, ComponentCreate, ComponentRead),
    ("/bom-lines", BomLine, BomLineCreate, BomLineRead),
    ("/bom-changes", BomChange, BomChangeCreate, BomChangeRead),
    ("/sheet-rows", SheetRow, SheetRowCreate, SheetRowRead),
):
    router.include_router(crud_router(prefix, model, create, read))
