from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import SessionDep
from app.models import SourceFile
from app.schemas.source_file import (
    SourceFileCreate,
    SourceFileDetail,
    SourceFileRead,
    SourceFileUpdate,
)

router = APIRouter(prefix="/files", tags=["files"])


async def _get_or_404(session: SessionDep, file_id: int) -> SourceFile:
    """Fetch a tracked file or raise 404."""
    row = await session.get(SourceFile, file_id)
    if row is None:
        raise HTTPException(status_code=404, detail="file not found")
    return row


@router.get("", response_model=list[SourceFileRead])
async def list_files(session: SessionDep, status: str | None = None):
    """Return tracked portal files, optionally filtered by status."""
    query = select(SourceFile).order_by(SourceFile.path)
    if status:
        query = query.where(SourceFile.status == status)
    return (await session.scalars(query)).all()


@router.get("/{file_id}", response_model=SourceFileDetail)
async def get_file(session: SessionDep, file_id: int):
    """Return one tracked file with its extracted data."""
    return await _get_or_404(session, file_id)


@router.post("", response_model=SourceFileRead, status_code=201)
async def create_file(session: SessionDep, body: SourceFileCreate):
    """Track a file by hand; 409 if the path is already tracked."""
    row = SourceFile(**body.model_dump())
    session.add(row)
    try:
        await session.commit()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="path already tracked") from exc
    return row


@router.patch("/{file_id}", response_model=SourceFileRead)
async def update_file(session: SessionDep, file_id: int, body: SourceFileUpdate):
    """Change a file's status or error."""
    row = await _get_or_404(session, file_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    await session.commit()
    await session.refresh(row)  # picks up the DB-set updated_at
    return row


@router.delete("/{file_id}", status_code=204)
async def delete_file(session: SessionDep, file_id: int):
    """Stop tracking a file (the next pipeline run re-adds it if still listed)."""
    row = await _get_or_404(session, file_id)
    await session.delete(row)
    await session.commit()
