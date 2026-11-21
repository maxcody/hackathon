import enum
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.source_file import SourceFile


class Severity(enum.StrEnum):
    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class FindingStatus(enum.StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class Finding(Base):
    """A problem or notable change found in the data (for example a short shipment).

    ``fingerprint`` identifies the same problem across runs, so re-analysing a
    changed file updates the row and keeps its status instead of duplicating it.
    """

    __tablename__ = "findings"

    id: Mapped[int] = mapped_column(primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True)
    kind: Mapped[str] = mapped_column(String(48), index=True)
    severity: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(255))
    detail: Mapped[str] = mapped_column(Text, default="")
    part: Mapped[str | None] = mapped_column(String(32), index=True, default=None)
    source_file_id: Mapped[int | None] = mapped_column(
        ForeignKey("source_files.id", ondelete="SET NULL"), default=None
    )
    status: Mapped[str] = mapped_column(
        String(16), index=True, default=FindingStatus.OPEN
    )
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    source_file: Mapped[SourceFile | None] = relationship(lazy="joined")

    @property
    def source_path(self) -> str | None:
        """Path of the file this finding came from, as evidence."""
        return self.source_file.path if self.source_file else None
