from pydantic import BaseModel, ConfigDict


class SheetRowCreate(BaseModel):
    """One row of an Excel sheet, keyed by the sheet's own column labels."""

    kind: str  # editions, parts, inbound, shifts, shipments, price_list, notes
    source: str
    sheet: str
    title: str | None = None
    row_no: int
    data: dict


class SheetRowRead(SheetRowCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
