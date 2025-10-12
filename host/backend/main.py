import os
import asyncio
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .routes import router, keep_tunnel_alive, cleanup_stale_rooms
from .spotify_cache import refresh_spotify_cache

# ========================
# Paths & Constants
# ========================
BASE_DIR = os.path.dirname(__file__)
FRONTEND_DIST = os.path.join(BASE_DIR, "..", "frontend", "dist")
ERR_FILE = os.path.join(BASE_DIR, "..", "frontend", "forbidden.html")
KEY_FILE = os.path.join(BASE_DIR, ".host_key")

# ========================
# App Setup
# ========================
app = FastAPI(title="Spotify API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static assets (e.g., /assets/*.js, /assets/*.css)
# Mount /assets
app.mount(
    "/assets",
    StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")),
    name="assets"
)

# Mount root for files like favicon.ico, robots.txt, etc.

# ========================
# Helpers
# ========================
def get_host_key():
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "r") as f:
            return f.read().strip()
    return None

# ========================
# Frontend Route (Host Only)
# ========================
@app.get("/")
async def serve_frontend(request: Request):
    key = request.query_params.get("key")
    if not key or key != get_host_key():
        return FileResponse(ERR_FILE, status_code=403)
    return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))



@app.get("/favicon.ico")
async def favicon():
    return FileResponse(os.path.join(FRONTEND_DIST, "favicon.ico"))



# ========================
# API Router
# ========================
app.include_router(router, prefix="/api")

# ========================
# Background Tasks
# ========================
@app.on_event("startup")
async def startup_event():
    """Run all startup background tasks."""
    # Start Spotify cache refresher in the background
    asyncio.create_task(refresh_spotify_cache())

    # Start tunnel keep-alive loop in the background
    asyncio.create_task(keep_tunnel_alive())

    # Clean up stale rooms once at startup
    await cleanup_stale_rooms()
