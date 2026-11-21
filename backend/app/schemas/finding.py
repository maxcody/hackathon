from datetime import datetime

from pydantic import BaseModel, ConfigDict


class FindingRead(BaseModel):
    """A problem found in the data, with the file it came from as evidence."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    severity: str
    title: str
    detail: str
    part: str | None
    status: str
    source_path: str | None
    first_seen_at: datetime
    last_seen_at: datetime
