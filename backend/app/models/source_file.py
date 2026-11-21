import enum
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class FileStatus(enum.StrEnum):
    """Processing state of a portal file."""

    PENDING = "pending"  # new or replaced, not parsed yet
    PROCESSED = "processed"
    FAILED = "failed"
    REMOVED = "removed"  # no longer listed by the portal


class SourceFile(Base):
    """A portal file we track, so unchanged files are skipped on the next run.

    A file is re-parsed when its SHA-256 changes or when ``parser_version`` is
    lower than the current parser version.
    """

    __tablename__ = "source_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    path: Mapped[str] = mapped_column(String(512), unique=True)
    sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    parser_version: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default=FileStatus.PENDING)
    error: Mapped[str | None] = mapped_column(Text, default=None)
    # What the model read from the file (cached, so each file version is read once)
    extracted: Mapped[dict | None] = mapped_column(JSONB, default=None)
    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
