from pydantic import BaseModel, ConfigDict


class ItemCreate(BaseModel):
    name: str


class ItemRead(ItemCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
