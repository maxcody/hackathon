from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.source_file import FileStatus


class SourceFileCreate(BaseModel):
    """Register a portal file by hand; the pipeline fills in the rest."""

    path: str = Field(max_length=512)
    sha256: str = Field(min_length=64, max_length=64)
    size_bytes: int = Field(ge=0)


class SourceFileUpdate(BaseModel):
    """Fields that can be changed; set ``status`` to ``pending`` to re-read a file."""

    status: FileStatus | None = None
    error: str | None = None


class SourceFileRead(BaseModel):
    """A tracked portal file."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    path: str
    sha256: str
    size_bytes: int
    parser_version: int
    status: str
    error: str | None
    processed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SourceFileDetail(SourceFileRead):
    """A tracked file plus what the model read from it."""

    extracted: dict | None
