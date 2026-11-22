from datetime import UTC, datetime

from sqlalchemy import DateTime, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Notification(Base):
    """One happening where the system and the customer side disagree.

    ``attr`` is what differs (for example ``quantity``), ``erp_val`` is the
    ERP's value and ``customer_val`` the customer side's, both as text so any
    attribute fits. ``data`` holds the rest so each check can add what it needs
    (for example ``kind``, ``status``, ``title``, ``subject``, ``refs``).
    ``seen_at`` is when the problem was last detected; it defaults to creation.
    """

    __tablename__ = "notifications"
    # At most one row per problem key (agents upsert by data.key)
    __table_args__ = (
        Index("uq_notifications_key", text("(data->>'key')"), unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    attr: Mapped[str] = mapped_column(String(64))
    erp_val: Mapped[str | None] = mapped_column(Text, default=None)
    customer_val: Mapped[str | None] = mapped_column(Text, default=None)
    data: Mapped[dict] = mapped_column(JSONB)
    seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
