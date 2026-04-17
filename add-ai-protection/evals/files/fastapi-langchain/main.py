from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

app = FastAPI(title="AI Chat API")

llm = ChatOpenAI(model="gpt-4o", streaming=True)


class ChatRequest(BaseModel):
    message: str
    user_id: str | None = None


@app.post("/api/chat")
async def chat(request: Request, body: ChatRequest):
    async def generate():
        async for chunk in llm.astream(body.message):
            yield chunk.content

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/health")
async def health():
    return {"status": "ok"}
