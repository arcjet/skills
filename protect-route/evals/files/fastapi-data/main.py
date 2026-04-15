from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()

@app.get("/api/data")
async def get_data(request: Request):
    return {"items": [{"id": 1, "name": "Widget"}]}
