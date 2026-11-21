from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Item
from app.schemas.item import ItemCreate, ItemRead

router = APIRouter(prefix="/items", tags=["items"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("", response_model=list[ItemRead])
async def list_items(session: SessionDep):
    return (await session.scalars(select(Item))).all()


@router.post("", response_model=ItemRead, status_code=201)
async def create_item(payload: ItemCreate, session: SessionDep):
    item = Item(**payload.model_dump())
    session.add(item)
    await session.commit()
    return item
