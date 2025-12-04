import hashlib
import os
import random
import sys
import time
import json
import base64
import urllib.parse
import requests
import httpx

from datetime import datetime
from pathlib import Path
from typing import List, Optional
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
from Crypto.Random import get_random_bytes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend

from fastapi import (
    FastAPI, Request, WebSocket, HTTPException, Query, Header, APIRouter
)
from fastapi.responses import JSONResponse, RedirectResponse

from pydantic import BaseModel
from dotenv import set_key, dotenv_values

from .spotify import get_refresh_token, get_room_id, put_refresh_token, tokens, get_headers, ms_to_min_sec, is_room_free, register_room_in_firebase, _firebase_get, _firebase_patch
from .spotify_cache import current_track_cache
from .state import state
from .security_cookie import COOKIE_MAX_AGE, _sign, _unsign, COOKIE_NAME

class User(BaseModel):
    name: str
    key: str         # single key now
    isAllowed: bool = False
    canControl: bool = False
    whitelisted: bool = False
    

class AuthRequest(BaseModel):
    client_id: str
    client_secret: str
class ScopeRequest(BaseModel):
    action: str  # "accept" or "reject"
    whitelisted: Optional[bool] = None  # ✅ add this


prev_track = None
prev_artists = None

# Flag to prevent multiple /queue calls in the last 5 seconds
next_track_called_at = None  # type: datetime | None

allow_list: List[User] = []
request_list: List[User] = []
connected_frontends: list[WebSocket] = []
kicked_users = {}
previous_disables = []

KICK_TIMEOUT = 15  # seconds

router = APIRouter()


# At the top of the file

ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env")


def get_base_url():
    """
    Returns the base URL depending on environment:
    - On Render: derive from RENDER_SERVICE_NAME
    - Locally: use localhost:8000
    """
    if os.getenv("RENDER") == "true":
        # Construct URL dynamically from service name
        service_name = os.getenv("RENDER_SERVICE_NAME", "unknown-service")
        return f"https://{service_name}.onrender.com"
    else:
        # Default for local dev
        return "http://localhost:8000"
    
SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
REDIRECT_URI = get_base_url() + "/api/callback" if get_base_url()!="http://localhost:8000" else "http://127.0.0.1:8000/api/callback" 
print(REDIRECT_URI)
SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-private"
state["env_valid"] = False
terminal_logs: list[str] = []

# Optional: limit size to avoid memory bloat
MAX_LOGS = 200
BASE_DIR = os.path.dirname(__file__)
ROOM_FILE = Path(__file__).parent.parent / "room.json"
FIREBASE_BASE = "https://spotisyncrooms-default-rtdb.asia-southeast1.firebasedatabase.app"
PASSWORD = os.getenv("APP_PASSWORD","dev")  # same as your frontend password check
callback_completed = dict()
PASS_FILE = os.path.join(BASE_DIR, "..", "frontend", "passw.html")
SALT = b"whitelist_salt_v1"  # fixed constant, do NOT regenerate between restarts
ROOM = get_room_id()
room = None
tokens["refresh_token"] = get_refresh_token()
if(get_refresh_token()):
        state["env_valid"] = True

def _derive_key() -> bytes:
    global PASSWORD
    """Derives a 32-byte AES key from the backend password."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=SALT,
        iterations=200_000,
        backend=default_backend()
    )
    return kdf.derive(PASSWORD.encode())

KEY = _derive_key()


def get_whitelist():
    """
    Retrieves the current whitelist from Firebase for the room.
    """
    global ROOM
    room_id = ROOM
    if not room_id:
        print("[whitelist] ⚠️ No valid room found")
        return {}

    whitelist_url = f"{FIREBASE_BASE}/rooms/{room_id}/whitelist.json"
    data = _firebase_get(whitelist_url)
    if not data:
        print("[whitelist] ⚠️ Whitelist empty or unavailable")
        return {}

    return data

whitelist = get_whitelist()
# === App ===
app = FastAPI()

CLIENT_ID = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
# print(CLIENT_ID, CLIENT_SECRET)

@router.post("/unlock-page")
async def unlock_page(request: Request):
    """
    Expects JSON: { "password": "..." }
    If correct, sets an HttpOnly cookie at path="/" that other endpoints (and GET /) can use.
    """
    data = await request.json()
    user_password = data.get("password")
    if not user_password:
        raise HTTPException(status_code=400, detail="Password missing.")
    if user_password != PASSWORD:
        raise HTTPException(status_code=403, detail="Incorrect password.")

    payload = f"ts={int(time.time())}"
    token = _sign(payload)

    # secure cookie only on Render / HTTPS
    secure_cookie = os.getenv("RENDER") == "true"
    response = JSONResponse({"success": True, "message": "Access granted."})
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=secure_cookie,   # secure=True on Render (HTTPS), False locally
        samesite="lax",
        path="/",               # IMPORTANT: cookie sent to "/" and "/api/*"
    )
    # Debug
    print("[unlock-page] set cookie:", COOKIE_NAME, "secure=", secure_cookie)
    return response


# -------------------------
# Check endpoint
# -------------------------
@router.get("/check-unlock")
async def check_unlock(request: Request): 
    # return {"unlocked": False}
    # Debug incoming cookies
    global ROOM
    ROOM = get_room_id()
    # print("[check-unlock] incoming cookies:", request.cookies)
    token = request.cookies.get(COOKIE_NAME)
    valid = bool(token and _unsign(token))
    # print("[check-unlock] token present:", bool(token), "valid:", valid)
    return {"unlocked": valid}


@router.post("/get-creds")
async def get_spotify_creds(request: Request):
    data = await request.json()
    if data.get("password") != PASSWORD:
        raise HTTPException(status_code=403, detail="Unauthorized")

    return {
        "client_id": os.getenv("CLIENT_ID"),
        "client_secret": os.getenv("CLIENT_SECRET")
    }


async def cleanup_stale_rooms():
    """Removes stale/unresponsive rooms from Firebase at startup."""
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{FIREBASE_BASE}/rooms.json")
            print(f"[cleanup_stale_rooms] GET rooms.json  status {resp.status_code}")

            # Parse JSON safely
            try:
                data = resp.json()
            except json.JSONDecodeError:
                print("[cleanup_stale_rooms] Failed to parse JSON, skipping cleanup.")
                return

            if not isinstance(data, dict):
                print("[cleanup_stale_rooms] No rooms to clean up (response not a dict).")
                return

            rooms = data

            for room_id, room_data in rooms.items():
                if not isinstance(room_data, dict):
                    print(f"[cleanup_stale_rooms] Skipping invalid room entry: {room_id}")
                    continue

                url = room_data.get("url")
                if not url:
                    print(f"[cleanup_stale_rooms] Skipping room {room_id} with no URL.")
                    continue
                
                if "trycloudflare" not in url:
                    print(f"Skipping Render room {room_id}")
                    continue

                try:
                    r = await client.get(f"{url}/api/ping", timeout=2.0)
                    if r.status_code != 200:
                        await client.delete(f"{FIREBASE_BASE}/rooms/{room_id}.json")
                        print(f"[cleanup_stale_rooms] Removed stale room {room_id}")
                except Exception:
                    await client.delete(f"{FIREBASE_BASE}/rooms/{room_id}.json")
                    print(f"[cleanup_stale_rooms] Removed unresponsive room {room_id}")

        except Exception as e:
            print(f"[cleanup_stale_rooms] Failed to clean up rooms: {e}")



async def get_user_status(name: str, key: str):
    user_id = f"{name}:{key}"
    
    for u in allow_list:
        if f"{u.name}:{u.key}" == user_id:
            return {"isAllowed": True, "canControl": u.canControl, "pending": False}
    
    for u in request_list:
        if f"{u.name}:{u.key}" == user_id:
            return {"isAllowed": False, "canControl": False, "pending": True}
    
    return {"isAllowed": False, "canControl": False, "pending": False}


@router.get("/ping")
async def ping():
    return {"status": "ok", "message": "I exist"}


@router.post("/join-request")
async def join_request(user: User):
    # Validate key length
    if len(user.key) != 32:
        return {"status": "invalid_key", "isAllowed": False}

    # Since duplicate requests aren’t an issue, just add to request_list
    request_list.append(user)
    print(request_list)


    # Immediately notify all connected frontends
    for ws in connected_frontends:
        await ws.send_json({
            "type": "new_request",
            "user": {"name": user.name, "key": user.key}
        })
        
        

    # Return pending to the client
    return {"status": "pending", "isAllowed": False}

@router.post("/set-scope")
async def set_scope(req: ScopeRequest, x_user_key: str = Header(...)): 
    global previous_disables
    action = req.action

    if action in ["accept", "reject"]:
        user = next((u for u in request_list if u.key == x_user_key), None)
        if not user:
            return JSONResponse({"status": "error", "message": "User not found in request list"}, status_code=404)

        if action == "accept":
            request_list.remove(user)
            user.isAllowed = True
            user.canControl = user.key not in previous_disables
            allow_list.append(user)
            
            if req.whitelisted:
                await broadcast_log(f"🟢 Auto-accepted: {user.name} ({user.key[:6]}...) ⭐")
            else:
                await broadcast_log(f"🟢 Accepted user: {user.name} ({user.key[:6]}...)")

            return {"status": "accepted", "user": {"name": user.name, "key": user.key}}
        


        elif action == "reject":
            request_list.remove(user)
            kicked_users[user.key] = time.time() + KICK_TIMEOUT

            await broadcast_log(f"🔴 Rejected user: {user.name} ({user.key[:6]}...)")
            return {"status": "rejected", "user": {"name": user.name, "key": user.key}}

    elif action in ["disable", "enable", "remove", "whitelist", "remove_whitelist"]:
        user = next((u for u in allow_list if u.key == x_user_key), None)
        if not user:
            return JSONResponse({"status": "error", "message": "User not found in allow list"}, status_code=404)

        if action in ["disable", "enable"]:
            user.canControl = (action == "enable")
            if user.canControl:
                if user.key in previous_disables:
                    previous_disables.remove(user.key)
            else:
                if user.key not in previous_disables:
                    previous_disables.append(user.key)
                    
            status = "enabled" if user.canControl else "disabled"
            await broadcast_log(f"⚙️ {status.capitalize()} control for: {user.name} ({user.key[:6]}...)")
            return {
                "status": action,
                "user": {"name": user.name, "key": user.key, "canControl": user.canControl},
            }

        elif action in ["whitelist", "remove_whitelist"]:
            # Determine if we’re adding or removing
            is_add = (action == "whitelist")
            user.whitelisted = is_add

            # Use AES-based whitelist manager
            if is_add:
                ok = add_to_whitelist(user.key, user.name)
                status = f"added {user.name} to whitelist" if ok else f"failed to add {user.name}"
            else:
                ok = remove_from_whitelist(user.key)
                status = f"removed {user.name} from whitelist" if ok else f"failed to remove {user.name}"

            # Log + respond
            await broadcast_log(f"⭐ {status} ({user.key[:6]}...)")
            return {
                "status": action,
                "user": {
                    "name": user.name,
                    "key": user.key,
                    "whitelisted": user.whitelisted,
                },
            }


        elif action == "remove":
            allow_list.remove(user)
            kicked_users[user.key] = time.time() + KICK_TIMEOUT
            await broadcast_log(f"🔴 Removed user: {user.name} ({user.key[:6]}...)")
            return {"status": "removed", "user": {"name": user.name, "key": user.key}}

    return JSONResponse({"status": "error", "message": "Invalid action"}, status_code=400)

def add_to_whitelist(user_key: str, user_name: str):
    global ROOM
    cipher = encrypt_value(user_key)
    room_id = ROOM
    
    if not room_id:
        print("[whitelist] ⚠️ No valid room found")
        return False

    whitelist_url = f"{FIREBASE_BASE}/rooms/{room_id}/whitelist.json"
    ok = _firebase_patch(whitelist_url, {cipher: user_name})
    if ok:
        print(f"[whitelist] ✅ Added {user_name}")
        return True
    print(f"[whitelist] ⚠️ Failed to add {user_name}")
    return False


def remove_from_whitelist(user_key: str):
    """
    Encrypts the given key and removes the encoded cipher from Firebase whitelist.
    """
    global ROOM
    room_id = ROOM
    if not room_id:
        print("[whitelist] ⚠️ No valid room found")
        return False

    whitelist_url = f"{FIREBASE_BASE}/rooms/{room_id}/whitelist.json"
    data = _firebase_get(whitelist_url)
    if not data:
        print("[whitelist] ⚠️ Whitelist empty or unavailable")
        return False

    encoded = encrypt_value(user_key)
    if encoded not in data:
        print("[whitelist] ⚠️ Key not found in whitelist")
        return False

    # Remove the entry
    ok = _firebase_patch(whitelist_url, {encoded: None})
    if ok:
        print(f"[whitelist] ❌ Removed {data[encoded]}")
        return True
    print("[whitelist] ⚠️ Failed to remove key")
    return False


def _derive_iv(value: str) -> bytes:
    """Derive deterministic IV from the plaintext value."""
    return hashlib.sha256(value.encode()).digest()[:16]

def encrypt_value(value: str) -> str:
    """Deterministically encrypts a string and makes it Firebase key–safe."""
    iv = _derive_iv(value)
    cipher = AES.new(KEY, AES.MODE_CBC, iv)
    ciphertext = cipher.encrypt(pad(value.encode(), AES.block_size))
    encoded = base64.b64encode(iv + ciphertext).decode()

    # Firebase-safe: replace "/" and similar chars
    safe_encoded = encoded.replace("/", "_").replace(".", "-").replace("+", "~")
    return safe_encoded



@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

        # Send current state immediately
    await ws.send_json({
        "type": "rehydrate",
        "requests": [u.model_dump() for u in request_list],
        "allowed": [u.model_dump() for u in allow_list],
        "logs": terminal_logs,
    })

    connected_frontends.append(ws)
    
    try:
        while True:
            await ws.receive_text()  # optional ping from frontend
    except Exception:
        pass
    finally:
        connected_frontends.remove(ws)

    

    

async def get_room():
    """
    Registers or reuses a room.
    - If a cached room (matching BASE_URL) exists, reuse it.
    - Otherwise, create a new one and register in Firebase.
    """
    try:
        cached = await load_cached_room()

        if cached:
            print(f"[reg_room] Using cached room: {cached['room_id']} ({cached['url']})")
            return cached

        # If no cached room found, create a new one
        print("[reg_room] No cached room found.")
        return None
        
    except Exception as e:
        print(f"🚫 Error in get_room: {e}")
        sys.exit(1)
            
async def load_cached_room():
    """
    Loads the cached room data.
    - On Render: checks Firebase for a matching BASE_URL.
    - Locally: checks Firebase first, then falls back to local ROOM_FILE.
    """
    BASE_URL = get_base_url()
    IS_RENDER = os.getenv("RENDER") == "true"

    # 🔹 1. Always try Firebase first
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{FIREBASE_BASE}/rooms.json", timeout=5.0)
            if resp.status_code == 200:
                try:
                    data = resp.json()
                    if isinstance(data, dict):
                        for room_id, room_data in data.items():
                            if not isinstance(room_data, dict):
                                continue
                            if room_data.get("url") == BASE_URL:
                                print(f"[load_cached_room] Found cached room on Firebase: {room_id}")
                                return {"room_id": room_id, "url": room_data.get("url")}
                    print("[load_cached_room] No matching room found on Firebase.")
                    return None
                except json.JSONDecodeError:
                    print("[load_cached_room] Failed to decode Firebase JSON.")
            else:
                print(f"[load_cached_room] Firebase returned {resp.status_code}")
    except Exception as e:
        print(f"[load_cached_room] Failed to fetch Firebase rooms: {e}")

    # 🔹 2. Only use ROOM_FILE locally
    if not IS_RENDER and os.path.exists(ROOM_FILE):
        try:
            with open(ROOM_FILE, "r") as f:
                room_data = json.load(f)
                if "room_id" in room_data and "url" in room_data:
                    print(f"[load_cached_room] Loaded cached room from {ROOM_FILE}")
                    return room_data
                else:
                    print(f"[load_cached_room] {ROOM_FILE} missing 'room_id' or 'url'.")
        except json.JSONDecodeError:
            print(f"[load_cached_room] Could not decode JSON from {ROOM_FILE}.")
        except IOError:
            print(f"[load_cached_room] Could not read file {ROOM_FILE}.")
    elif IS_RENDER:
        print("[load_cached_room] Skipping local ROOM_FILE check (Render environment).")
    else:
        print(f"[load_cached_room] Cached room file {ROOM_FILE} not found.")

    return None

    
    
@router.get("/progress/")
async def current_track(
    name: str = Header(..., alias="x-user-name"),
    key: str = Header(..., alias="x-user-key"),
    force: bool = Query(False)):    
    """
    Return the cached Spotify track instantly.
    Also handles user join flow:
    - If new user: add to request_list + notify host
    - If pending: return "pending"
    - If allowed: return track info with canControl
    Optional 'force' flag can bypass cache or trigger refresh.
    """
    if len(key) != 32:
        return {"status": "invalid_key", "isAllowed": False}
    
    expiry = kicked_users.get(key) 
    if expiry:
        if time.time() < expiry:
            # Still in timeout → silently reject
            return {"status": "cooldown", "isAllowed": False}
        else:
            # Timeout expired → clean up
            kicked_users.pop(key, None)


    global next_track_called_at, prev_track, prev_artists

    # 1️⃣ Check allow_list first
    user = next((u for u in allow_list if u.key == key), None)
    if user:
        # ✅ Allowed user → proceed with track logic
        data = current_track_cache.get("data" )
        
        if not data:
            return {"playing": False, "canControl": user.canControl}

        duration_sec = data.get("duration_sec", 0)
        playback_sec = data.get("playback_time", 0)
        
        if not force:
            if prev_track == data.get("track") and prev_artists == data.get("artists"):
                return {
                    "progress": data.get("progress"),
                    "canControl": user.canControl,
                    "isAllowed": True,
                }

        # 4️⃣ Otherwise return full data
        response_data = data.copy()
        response_data["canControl"] = user.canControl
        response_data["isAllowed"] = True
        return response_data
    
    # 5️⃣ Check if already pending
    user = next((u for u in request_list if u.key == key), None)
    if user:
        if is_whitelisted(user.key):
            user.isAllowed = True
            user.canControl = new_user.key not in previous_disables
            user.whitelisted = True
            allow_list.append(user)
            request_list.remove(user)
            for ws in connected_frontends:
                await ws.send_json({
                    "type": "auto_accepted",
                    "user": {"name": user.name, "key": user.key, "canControl": user.canControl}
                })
            await broadcast_log(f"🟢 Auto-accepted whitelisted user: {user.name} ({user.key[:6]}...)")
            return {"status": "accepted", "user": {"name": user.name, "key": user.key}}
        return {"status": "pending", "isAllowed": False, "canControl": user.canControl}

    # 6️⃣ New user → add to request_list
    new_user = User(name=name, key=key)
    request_list.append(new_user)
    print("New join request:", new_user)
    await broadcast_log(f"🟡 {new_user.name} requested to join ({new_user.key[:6]}...)")
    
    if is_whitelisted(new_user.key):
        new_user.isAllowed = True
        new_user.canControl = new_user.key not in previous_disables
        new_user.whitelisted = True
        allow_list.append(new_user)
        request_list.remove(new_user)
        for ws in connected_frontends:
            await ws.send_json({
                "type": "auto_accepted",
                "user": {"name": new_user.name, "key": new_user.key, "canControl": new_user.canControl}
            })

        await broadcast_log(f"🟢 Auto-accepted whitelisted user: {new_user.name} ({new_user.key[:6]}...)")
        return {"status": "accepted", "user": {"name": new_user.name, "key": new_user.key, "canControl": new_user.canControl}}

    # Notify hosts
    for ws in connected_frontends:
        await ws.send_json({
            "type": "new_request",
            "user": {"name": new_user.name, "key": new_user.key, "canControl": new_user.key not in previous_disables}
        })

    return {"status": "pending", "isAllowed": False, "canControl": False}




def is_whitelisted(user_key: str) -> bool:
    """
    Encrypts the given key and checks if the encoded cipher exists in Firebase whitelist.
    """
    global whitelist
    encoded = encrypt_value(user_key)
    return encoded in whitelist
    

@router.get("/queue/")
async def next_track():
    """Return the next track from the queue."""
    headers = get_headers()
    url = "https://api.spotify.com/v1/me/player/queue"

    async with httpx.AsyncClient() as client:
        r = await client.get(url, headers=headers)

        if r.status_code == 401 and "refresh_token" in tokens:
            access_token = refresh_access_token(tokens["refresh_token"])
            headers = {"Authorization": f"Bearer {access_token}"}
            r = await client.get(url, headers=headers)

        next_track_info = None
        if r.status_code == 200:
            queue_data = r.json().get("queue", [])
            if queue_data:
                next_item = queue_data[0]
                next_track_info = {
                    "id": next_item["id"],
                    "name": next_item["name"],
                    "artists": ", ".join([a["name"] for a in next_item["artists"]]),
                    "url": next_item["external_urls"]["spotify"],
                }

    return {"next_track": next_track_info}


@router.get("/cover/{track_id}")
async def get_cover(track_id: str):
    """Return only the album cover URL for a given track ID."""
    headers = get_headers()
    url = f"https://api.spotify.com/v1/tracks/{track_id}"

    async with httpx.AsyncClient() as client:
        r = await client.get(url, headers=headers)

        if r.status_code == 401 and "refresh_token" in tokens:
            access_token = refresh_access_token(tokens["refresh_token"])
            headers = {"Authorization": f"Bearer {access_token}"}
            r = await client.get(url, headers=headers)

        if r.status_code != 200:
            return {"cover": None}

        track_data = r.json()
        images = track_data.get("album", {}).get("images", [])
        cover_url = images[0]["url"] if images else None

        return {"cover": cover_url}


@router.post("/toggle-play-pause/")
async def toggle_play_pause(x_user_name: str = Header(...), x_user_key: str = Header(...)):
    """
    Toggle between play and pause for the current playback.
    Blocks users who are not in allow_list or don't have control access.
    """
        # 1️⃣ Validate user
    user = next((u for u in allow_list if u.key == x_user_key and u.name == x_user_name), None)
    if not user:
        print(f"[BLOCKED] Non-allowed user tried to toggle: {x_user_name}")
        return  # just block silently

    if not user.canControl:
        await broadcast_log(f"[BLOCKED] 🔴 {user.name} tried to toggle")
        print(f"[BLOCKED] User {x_user_name} is not allowed to control")
        return  # silently ignore as per your rule
    
    
    headers = get_headers()
    url_status = "https://api.spotify.com/v1/me/player"
    async with httpx.AsyncClient() as client:
        # Get current playback state
        r = await client.get(url_status, headers=headers)
        if r.status_code == 401 and "refresh_token" in tokens:
            access_token = refresh_access_token(tokens["refresh_token"])
            headers = {"Authorization": f"Bearer {access_token}"}
            r = await client.get(url_status, headers=headers)

        if r.status_code != 200:
            return {"success": False, "error": "Cannot get playback status"}

        playback = r.json()
        is_playing = playback.get("is_playing", False)

        # Toggle
        if is_playing:
            toggle_url = "https://api.spotify.com/v1/me/player/pause"
            await broadcast_log(f"⚪ {user.name} paused the playback")

        else:
            await broadcast_log(f"⚪ {user.name} resumed the playback")
            toggle_url = "https://api.spotify.com/v1/me/player/play"

        toggle_resp = await client.put(toggle_url, headers=headers)
        if toggle_resp.status_code in [204, 202]:
            return {"success": True, "playing": not is_playing}
        return {"success": False, "error": "Failed to toggle play/pause"}


@router.post("/next-track/")
async def skip_next_track(x_user_name: str = Header(...), x_user_key: str = Header(...)):
    """
    Skip to the next track in the current playback.
    Blocks users who are not in allow_list or don't have control access.
    """

    # 1️⃣ Validate user
    user = next((u for u in allow_list if u.key == x_user_key and u.name == x_user_name), None)
    if not user:
        print(f"[BLOCKED] Non-allowed user tried to skip next: {x_user_name}")
        return

    if not user.canControl:
        await broadcast_log(f"[BLOCKED] 🔴 {user.name} tried to skip the track ({user.key[:6]}...)")
        print(f"[BLOCKED] User {x_user_name} is not allowed to control (next)")
        return

    # 2️⃣ Proceed with actual Spotify request
    headers = get_headers()
    url = "https://api.spotify.com/v1/me/player/next"

    async with httpx.AsyncClient() as client:
        r = await client.post(url, headers=headers)
        if r.status_code == 401 and "refresh_token" in tokens:
            access_token = refresh_access_token(tokens["refresh_token"])
            headers = {"Authorization": f"Bearer {access_token}"}
            r = await client.post(url, headers=headers)
        print(r)
        if r.status_code in [200, 204, 202]:
            await broadcast_log(f"⚪ {user.name} skipped to the next track")
            return {"success": True}

        return {"success": False, "error": "Failed to skip track"}





@router.put("/seek-track/")
async def seek_track(
    position_ms: int = Query(..., description="Position in milliseconds to seek to"),
    x_user_name: str = Header(...),
    x_user_key: str = Header(...)
):
    """
    Seek to a specific position in the current playback.
    Blocks users who are not in allow_list or don't have control access.
    """
    # 1️⃣ Validate user
    user = next((u for u in allow_list if u.key == x_user_key and u.name == x_user_name), None)
    if not user:
        print(f"[BLOCKED] Non-allowed user tried to seek: {x_user_name}")
        return

    if not user.canControl:
        print(f"[BLOCKED] User {x_user_name} is not allowed to control (seek)")
        await broadcast_log(f"[BLOCKED] 🔴 {user.name} tried to toggle ({user.key[:6]}...)")

        return

    # 2️⃣ Proceed with Spotify seek request
    headers = get_headers()
    url = f"https://api.spotify.com/v1/me/player/seek?position_ms={position_ms}"

    async with httpx.AsyncClient() as client:
        r = await client.put(url, headers=headers)

        # Refresh token if expired
        if r.status_code == 401 and "refresh_token" in tokens:
            access_token = refresh_access_token(tokens["refresh_token"])
            headers = {"Authorization": f"Bearer {access_token}"}
            r = await client.put(url, headers=headers)

        if r.status_code in [200,204, 202]:
            await broadcast_log(f"⚪ {user.name} seeked to {ms_to_min_sec(position_ms)}s")
            return {"success": True, "position_ms": position_ms}

        return {"success": False, "error": f"Failed to seek: {r.text}"}





@router.put("/get-auth-token/")
async def get_auth_token():
    global callback_completed
    callback_completed = {"ok": False, "denied": False}
    global CLIENT_ID
    global CLIENT_SECRET
    # Pull credentials from environment
    client_id = CLIENT_ID
    client_secret = CLIENT_SECRET
    # Build auth URL (for browser redirect)
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": client_id,       # you can change this if you prefer random state
        "show_dialog": "true",
    }
    auth_url = f"{SPOTIFY_AUTH_URL}?{urllib.parse.urlencode(params)}"

    # Validate credentials with Spotify
    async with httpx.AsyncClient() as client:
        data = {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        }
        print(data)
        r = await client.post("https://accounts.spotify.com/api/token", data=data)
        if r.status_code != 200:
            return {"error": "invalid_creds"}

    return {"ok": True, "auth_url": auth_url}



@router.get("/redirect/")
async def redirect_to_spotify(client_id: str):
    auth_url = await get_auth_token()
    return RedirectResponse(auth_url["auth_url"])

@router.get("/check")
def check():
    return {"ok":True}


@router.get("/callback")
async def callback(code: str | None = Query(None), query_state: str | None = Query(None, alias="state"), error: str | None = Query(None)):
    # Save the query param under another name

    global tokens
    global callback_completed
    global state  # the global dict
    global CLIENT_SECRET
    
    if error:
        callback_completed["denied"] = True

    if (not code or not query_state) and not error:
        # print(code, query_state, error)
        # print(callback_completed)
        return callback_completed

    client_id = query_state


    client_secret = CLIENT_SECRET

    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    async with httpx.AsyncClient() as client:
        r = await client.post(SPOTIFY_TOKEN_URL, data=data, headers=headers)
        r.raise_for_status()
        token_data = r.json()

    tokens["access_token"] = token_data["access_token"]
    tokens["refresh_token"] = token_data["refresh_token"]
    retries = 0
    if not await get_room():
        while True:
                room_id = str(random.randint(10000, 99999))
                if is_room_free(room_id): 
                    if register_room_in_firebase(room_id, url=get_base_url()):
                        global ROOM
                        ROOM = room_id
                        print(f"[reg_room] Registered new room: {room_id}")
                        break
                    else:
                        retries += 1
                        if retries >= 5:
                            print("🚫 Max retries reached registering room. Exiting.")
                            sys.exit(1)
                        time.sleep(500)
                        print(f"[reg_room] Failed to register room ID {room_id}, retrying...")
                        continue
                        
                else:
                    print(f"[reg_room] Room ID {room_id} already taken, retrying...")
    put_refresh_token(tokens["refresh_token"])
    set_key(".env", "CLIENT_ID", client_id)
    set_key(".env", "CLIENT_SECRET", client_secret)
    set_key(".env", "ACCESS_TOKEN", tokens["access_token"])
    set_key(".env", "REFRESH_TOKEN", tokens["refresh_token"])

    callback_completed = {"ok": True, "rt": tokens["refresh_token"]}
    print("[CALLBACK] ENV Valid, starting to cache progress")

    # Use the global state dict now
    state["env_valid"] = True  

    return {"ok": True} 



@router.get("/room/")
async def get_room_endpoint():
    """
    Reads room.json from the parent folder and returns its contents.
    """
    
    try:
        room = await get_room()
        return {"success": True, "data": room}
    except Exception as e:
        return {"success": False, "error": str(e)}
 

@router.post("/leave")
async def leave_session(
    name: str = Header(..., alias="x-user-name"),
    key: str = Header(..., alias="x-user-key")
):
    # Try to find user in allow_list first
    user_to_remove = next((u for u in allow_list if u.name == name and u.key == key), None)
    list_source = "allow"

    # If not found, check request_list too
    if not user_to_remove:
        user_to_remove = next((u for u in request_list if u.name == name and u.key == key), None)
        list_source = "request" if user_to_remove else None

    if not user_to_remove:
        raise HTTPException(status_code=404, detail="User not found in session")

    # Remove user from the appropriate list
    if list_source == "allow":
        allow_list[:] = [u for u in allow_list if not (u.name == name and u.key == key)]
    elif list_source == "request":
        request_list[:] = [u for u in request_list if not (u.name == name and u.key == key)]
    kicked_users[key] = time.time() + 5
    # Notify connected frontends
    for ws in connected_frontends:
        try:
            await ws.send_json({
                "type": "user_left",
                "user": {"name": user_to_remove.name, "key": user_to_remove.key},
                "from": list_source  # optional, tells which list they were in
            })
        except Exception:
            pass

    await broadcast_log(f"⚫ {user_to_remove.name} left the room ({user_to_remove.key[:6]}...)")

    return {"success": True, "message": f"User {name} has left the session"}


async def broadcast_log(message: str):
    """Store and send log messages to all connected frontends."""
    terminal_logs.append(message)
    # trim if needed
    if len(terminal_logs) > MAX_LOGS:
        terminal_logs.pop(0)

    for ws in connected_frontends:
        try:
            await ws.send_json({"type": "logs", "message": message})
        except Exception:
            pass


def refresh_access_token(refresh_token: str) -> str:
    CLIENT_ID = get_creds()
    global tokens
    url = "https://accounts.spotify.com/api/token"
    # Encode client_id and client_secret as Base64
    client_creds = f"{CLIENT_ID}:{CLIENT_SECRET}"
    b64_creds = base64.b64encode(client_creds.encode()).decode()
    headers = {
        "Authorization": f"Basic {b64_creds}",
        "Content-Type": "application/x-www-form-urlencoded"
    }
    
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token
    }

    r = requests.post(url, data=data, headers=headers)
    res = r.json()

    if "access_token" not in res:
        raise Exception(f"Failed to refresh token: {res}")

    tokens["access_token"] = res["access_token"]
    set_key(".env", "ACCESS_TOKEN", tokens["access_token"])
    set_key(".env", "REFRESH_TOKEN", tokens["refresh_token"])
    return res["access_token"]

 
def get_creds():
    env = dotenv_values(ENV_PATH)
    return env.get("CLIENT_ID")