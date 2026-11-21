from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationRead(BaseModel):
    """One happening: what differs, the system's and the customer side's values."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    attr: str
    erp_val: str | None
    customer_val: str | None
    data: dict
    seen_at: datetime
