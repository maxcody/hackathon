from pydantic import BaseModel, ConfigDict


class SheetRowRead(BaseModel):
    """One Excel row, keyed by the sheet's own column labels."""

    model_config = ConfigDict(from_attributes=True)

    kind: str
    source: str
    sheet: str
    title: str | None
    row_no: int
    data: dict
