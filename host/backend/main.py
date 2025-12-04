import os
import asyncio
import re
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path


from .routes import router, cleanup_stale_rooms
from .spotify_cache import refresh_spotify_cache
from .spotify import get_refresh_token
from .security_cookie import _unsign, COOKIE_NAME
from .state import state

# ========================
# Paths & Constants
# ========================
BASE_DIR = os.path.dirname(__file__)
FRONTEND_DIST = os.path.join(BASE_DIR, "..", "frontend", "dist")
ERR_FILE = os.path.join(BASE_DIR, "..", "frontend", "src", "forbidden.html")
PASS_FILE = os.path.join(BASE_DIR, "..", "frontend", "src", "pass.html")
FIREBASE_BASE = "https://spotisyncrooms-default-rtdb.asia-southeast1.firebasedatabase.app"
ROOM_FILE = Path(__file__).parent.parent / "room.json"
MOBILE_FILE = os.path.join(BASE_DIR, "..", "frontend", "src", "mobile.html")

# ========================
# App Setup
# ========================
app = FastAPI(title="Spotify API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "chrome-extension://oemghnpgnacfmggkhfikaemkcpnahpba",
    ],
    allow_credentials=True, 
    allow_methods=["*"],
    allow_headers=["*"],
)


# ========================
# Frontend Routes
# ========================

app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")


@app.get("/favicon.ico")
async def favicon():
    return FileResponse(os.path.join(FRONTEND_DIST, "favicon.ico"))

# ========================
# API Routes
# ========================
app.include_router(router, prefix="/api")

# ========================
# Catch-all for non-API routes
# ========================
MOBILE_UA_REGEX = re.compile(r"iPhone|iPad|iPod|Android", re.I)

@app.get("/{full_path:path}") 
async def serve_frontend(request: Request, full_path: str):
    global state
    if(get_refresh_token()):
        state["env_valid"] = True
    else:
        state["env_valid"] = False
    token = request.cookies.get(COOKIE_NAME)
    is_valid = token and _unsign(token)
    # print(is_valid,state['env_valid'])
    # is_valid= False
    
     # Check if mobile
    user_agent = request.headers.get("user-agent", "")
    is_mobile_ua = MOBILE_UA_REGEX.search(user_agent) is not None

    # Optional: read viewport hint header from client (you could inject this with JS)
    viewport_width = request.headers.get("x-viewport-width")
    try:
        viewport_width = int(viewport_width)
    except (TypeError, ValueError):
        viewport_width = None

    # Consider mobile if UA is mobile OR viewport width is small (<= 768px)
    is_mobile = is_mobile_ua or (viewport_width is not None and viewport_width <= 768)
    

    # Root path
    if is_mobile:
        return FileResponse(MOBILE_FILE)
    if full_path == "":
        if is_valid and state['env_valid'] == True:
            return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
        else:
            return FileResponse(PASS_FILE) 
        
    if full_path == "pass.html":
        return FileResponse(PASS_FILE)

    # Any other path returns err file
    return FileResponse(ERR_FILE, status_code=403)


# ========================
# Background Tasks
# ========================
@app.on_event("startup")
async def startup_event():
    """Run all startup background tasks."""
    asyncio.create_task(refresh_spotify_cache())
    await cleanup_stale_rooms()