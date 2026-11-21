from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationCreate(BaseModel):
    """One happening: what differs, the ERP's and the customer side's values."""

    attr: str
    erp_val: str | None = None
    customer_val: str | None = None
    data: dict
    seen_at: datetime | None = None  # defaults to now; set it when re-detected


class NotificationRead(NotificationCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    seen_at: datetime
