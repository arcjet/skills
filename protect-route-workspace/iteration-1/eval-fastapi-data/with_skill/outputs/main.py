from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from arcjet import Mode, detect_bot, sliding_window
from lib.arcjet import aj

app = FastAPI()

# Route-specific rules for the public API endpoint:
# - detect_bot: block automated clients, allow search engines
# - sliding_window: rate limit to prevent abuse
aj_data = (
    aj.with_rule(
        detect_bot(
            mode=Mode.LIVE,
            allow=["CATEGORY:SEARCH_ENGINE"],
        ),
    ).with_rule(
        sliding_window(
            mode=Mode.LIVE,
            interval=60,
            max=100,
        ),
    )
)


@app.get("/api/data")
async def get_data(request: Request):
    decision = await aj_data.protect(request)

    if decision.is_denied():
        if decision.reason_v2.type == "RATE_LIMIT":
            return JSONResponse(
                {"error": "Too many requests"},
                status_code=429,
            )
        if decision.reason_v2.type in ("BOT", "SHIELD", "FILTER"):
            return JSONResponse(
                {"error": "Forbidden"},
                status_code=403,
            )

    # Arcjet fails open — log errors but allow the request
    if decision.is_error():
        print(f"Arcjet error: {decision.reason_v2}")

    return {"items": [{"id": 1, "name": "Widget"}]}
