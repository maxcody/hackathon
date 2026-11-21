from sqlalchemy import Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SheetRow(Base):
    """One data row of an Excel sheet, stored under the sheet's header labels.

    ``kind`` (editions, parts, inbound, ...) is found from the header labels, not
    from file or sheet names. ``data`` keeps the labels as written, so a new
    column shows up without a migration.
    """

    __tablename__ = "sheet_rows"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    source: Mapped[str] = mapped_column(String(512))  # file path under the data folder
    sheet: Mapped[str] = mapped_column(String(64))
    title: Mapped[str | None] = mapped_column(
        String(255), default=None
    )  # e.g. "status 2026-11-20 18:00"
    row_no: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSONB)
