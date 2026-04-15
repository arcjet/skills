import os
import time
import hashlib
from collections import defaultdict
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse

app = FastAPI()

# --- Simple rate limiting ---
# Tracks requests per IP: { ip: [(timestamp, ...)] }
_rate_limit_store: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT_MAX = 60  # max requests per window
RATE_LIMIT_WINDOW = 60  # window in seconds


def _is_rate_limited(ip: str) -> bool:
    """Return True if the IP has exceeded the rate limit."""
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW
    # Prune old entries
    _rate_limit_store[ip] = [
        t for t in _rate_limit_store[ip] if t > window_start
    ]
    if len(_rate_limit_store[ip]) >= RATE_LIMIT_MAX:
        return True
    _rate_limit_store[ip].append(now)
    return False


# --- Suspicious request detection (basic shield) ---
_SUSPICIOUS_PATTERNS = [
    "<script",
    "javascript:",
    "onerror=",
    "onload=",
    "SELECT ",
    "UNION ",
    "DROP ",
    "INSERT ",
    "DELETE ",
    "--",
    "../",
    "..\\",
    "%00",
    "\x00",
]


def _looks_suspicious(request: Request) -> bool:
    """Basic check for common injection / traversal patterns in the URL and query string."""
    url = str(request.url).lower()
    for pattern in _SUSPICIOUS_PATTERNS:
        if pattern.lower() in url:
            return True
    return False


@app.get("/api/data")
async def get_data(request: Request):
    client_ip = request.client.host if request.client else "unknown"

    # Rate limiting
    if _is_rate_limited(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests")

    # Basic suspicious-request shield
    if _looks_suspicious(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    return {"items": [{"id": 1, "name": "Widget"}]}
