from pydantic import BaseModel, ConfigDict


class SheetRowCreate(BaseModel):
    """One row of an Excel sheet, keyed by the sheet's own column labels."""

    # editions, parts, inbound, shifts, shipments, price_list, stock, packed, notes
    kind: str
    source: str
    sheet: str
    title: str | None = None
    row_no: int
    data: dict


class SheetRowRead(SheetRowCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
