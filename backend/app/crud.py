"""One generic CRUD router, so each table gets the same five endpoints."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, create_model
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import SessionDep
from app.models.base import Base


def optional(schema: type[BaseModel]) -> type[BaseModel]:
    """Return a copy of ``schema`` where every field may be left out (for PATCH)."""
    fields = {
        name: (f.annotation | None, None) for name, f in schema.model_fields.items()
    }
    return create_model(f"{schema.__name__}Update", **fields)


def crud_router(
    prefix: str,
    model: type[Base],
    create: type[BaseModel],
    read: type[BaseModel],
) -> APIRouter:
    """Build list, get, create, update (PATCH) and delete endpoints for ``model``.

    Args:
        prefix: URL prefix, for example ``/products``.
        model: SQLAlchemy model with a single primary key.
        create: Schema of the fields a client may send.
        read: Schema of what is returned (``from_attributes`` enabled).

    Returns:
        A router. Unknown ids give 404; a duplicate key, a missing reference or
        deleting a row that is still referenced gives 409.
    """
    update = optional(create)
    key = model.__mapper__.primary_key[0]
    key_type = Annotated[key.type.python_type, Path()]
    router = APIRouter(prefix=prefix, tags=[prefix.strip("/")])

    async def get_or_404(session: SessionDep, item_id):
        row = await session.get(model, item_id)
        if row is None:
            raise HTTPException(status_code=404, detail="not found")
        return row

    async def save(session: SessionDep, row):
        try:
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            msg = "duplicate key, missing reference or still referenced"
            raise HTTPException(status_code=409, detail=msg) from exc
        await session.refresh(row)  # picks up database-set values
        return row

    @router.get("", response_model=list[read])
    async def list_rows(session: SessionDep):
        return (await session.scalars(select(model).order_by(key))).all()

    @router.get("/{item_id}", response_model=read)
    async def get_row(session: SessionDep, item_id: key_type):
        return await get_or_404(session, item_id)

    @router.post("", response_model=read, status_code=201)
    async def create_row(session: SessionDep, body: create):
        row = model(**body.model_dump(exclude_unset=True))
        session.add(row)
        return await save(session, row)

    @router.patch("/{item_id}", response_model=read)
    async def update_row(session: SessionDep, item_id: key_type, body: update):
        row = await get_or_404(session, item_id)
        for name, value in body.model_dump(exclude_unset=True).items():
            setattr(row, name, value)
        return await save(session, row)

    @router.delete("/{item_id}", status_code=204)
    async def delete_row(session: SessionDep, item_id: key_type):
        row = await get_or_404(session, item_id)
        await session.delete(row)
        try:
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(status_code=409, detail="still referenced") from exc

    return router
