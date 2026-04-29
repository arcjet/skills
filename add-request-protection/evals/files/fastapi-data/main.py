from fastapi import FastAPI, Request
from pydantic import BaseModel

app = FastAPI(title="My API")


class Item(BaseModel):
    name: str
    price: float


items_db: list[Item] = [
    Item(name="Widget", price=9.99),
    Item(name="Gadget", price=19.99),
]


@app.get("/api/items")
async def list_items():
    return {"items": [item.model_dump() for item in items_db]}


@app.post("/api/items")
async def create_item(item: Item):
    items_db.append(item)
    return {"item": item.model_dump(), "total": len(items_db)}


@app.get("/health")
async def health():
    return {"status": "ok"}
