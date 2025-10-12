import os
import time
import json
import base64
import asyncio
import urllib.parse
import requests
import httpx

from datetime import datetime, timedelta
from pathlib import Path
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import (
    FastAPI, Request, WebSocket, HTTPException, Query, Header, APIRouter
)
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, HTMLResponse

from pydantic import BaseModel
from dotenv import set_key, dotenv_values

from .spotify import tokens, get_headers, ms_to_min_sec
from .spotify_cache import current_track_cache
from .state import state

router = APIRouter()


ROOM_FILE = Path(__file__).parent.parent / "room.json"
FIREBASE_BASE = "https://spotisyncrooms-default-rtdb.asia-southeast1.firebasedatabase.app"


# === App ===
app = FastAPI()


async def keep_tunnel_alive():
    """Continuously pings the saved room URL to prevent the tunnel from closing."""
    print("[keep_tunnel_alive] Background task started")

    if not ROOM_FILE.exists():
        print("[keep_tunnel_alive] ROOM_FILE not found. Skipping tunnel keep-alive.")
        return

    try:
        with open(ROOM_FILE, "r") as f:
            data = json.load(f)
            url = data.get("url")
    except Exception as e:
        print(f"[keep_tunnel_alive] Failed to load ROOM_FILE: {e}")
        return

    if not url:
        print("[keep_tunnel_alive] No URL found in ROOM_FILE.")
        return
    async with httpx.AsyncClient() as client:
        while True:
            try:
                with open(ROOM_FILE, "r") as f:
                    data = json.load(f)
                    url = data.get("url")
                if not url:
                    print("[keep_tunnel_alive] No URL in room.json")
                else:
                    r = await client.get(f"{url}/api/ping", timeout=2.0)
                    if not r.status_code == 200:
                        print(f"[keep_tunnel_alive] Ping failed ({r.status_code})  {url}")
            except Exception as e:
                print(f"[keep_tunnel_alive] Ping error: {e}")
            await asyncio.sleep(5)

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



class User(BaseModel):
    name: str
    key: str         # single key now
    isAllowed: bool = False
    canControl: bool = False
    whitelisted: bool = False

allow_list: List[User] = []
request_list: List[User] = []
connected_frontends: list[WebSocket] = []
kicked_users = {}
KICK_TIMEOUT = 15  # seconds





async def get_user_status(name: str, key: str):
    user_id = f"{name}:{key}"
    
    for u in allow_list:
        if f"{u.name}:{u.key}" == user_id:
            return {"isAllowed": True, "canControl": u.canControl, "pending": False}
    
    for u in request_list:
        if f"{u.name}:{u.key}" == user_id:
            return {"isAllowed": False, "canControl": False, "pending": True}
    
    return {"isAllowed": False, "canControl": False, "pending": False}




# At the top of the file
CLIENT_ID: str | None = None
CLIENT_SECRET: str | None = None
ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env")

SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
REDIRECT_URI = "http://127.0.0.1:8000/api/callback"
SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-private"
pending_auth: dict[str, dict[str, str]] = {}
state["env_valid"] = False
terminal_logs: list[str] = []

# Optional: limit size to avoid memory bloat
MAX_LOGS = 200



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
    action = req.action

    if action in ["accept", "reject"]:
        user = next((u for u in request_list if u.key == x_user_key), None)
        if not user:
            return JSONResponse({"status": "error", "message": "User not found in request list"}, status_code=404)

        if action == "accept":
            request_list.remove(user)
            user.isAllowed = True
            user.canControl = True
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
            status = "enabled" if user.canControl else "disabled"
            await broadcast_log(f"⚙️ {status.capitalize()} control for: {user.name} ({user.key[:6]}...)")
            return {
                "status": action,
                "user": {"name": user.name, "key": user.key, "canControl": user.canControl},
            }

        elif action in ["whitelist", "remove_whitelist"]:
            user.whitelisted = (action == "whitelist")
            status = f"added {user.name} to whitelist" if user.whitelisted else f"removed {user.name} from whitelist"
            await broadcast_log(f"⭐ {status} ({user.key[:6]}...)")
            return {
                "status": action,
                "user": {"name": user.name, "key": user.key, "whitelisted": user.whitelisted},
            }

        elif action == "remove":
            allow_list.remove(user)
            kicked_users[user.key] = time.time() + KICK_TIMEOUT
            await broadcast_log(f"🔴 Removed user: {user.name} ({user.key[:6]}...)")
            return {"status": "removed", "user": {"name": user.name, "key": user.key}}

    return JSONResponse({"status": "error", "message": "Invalid action"}, status_code=400)



@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    
        # Send current state immediately
    await ws.send_json({
        "type": "rehydrate",
        "requests": [u.model_dump() for u in request_list],
        "allowed": [u.model_dump() for u in allow_list],
        "logs": terminal_logs
    })
    
    connected_frontends.append(ws)
    try:
        while True:
            await ws.receive_text()  # optional ping from frontend
    except Exception:
        pass
    finally:
        connected_frontends.remove(ws)




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
        remaining_sec = duration_sec - playback_sec
        now = datetime.utcnow()

        # 2️⃣ Near end of track → fetch next
        # if remaining_sec <= 5:
        #     if not next_track_called_at or (now - next_track_called_at) > timedelta(seconds=5):
        #         next_track_called_at = now

        #         next_track_response = await next_track()
        #         next_item = next_track_response.get("next_track")

        #         if next_item:
        #             current_track_cache["data"] = {
        #                 "id": next_item["id"],
        #                 "track": next_item["name"],
        #                 "artists": next_item["artists"],
        #                 "url": next_item["url"],
        #                 "playing": True,
        #                 "percent_played": 0,
        #                 "duration": next_item.get("duration", 0),
        #                 "next_track": None,
        #                 "playback_time": 0,
        #                 "canControl": user.canControl,
        #             }
        #             return current_track_cache["data"]

        # 3️⃣ Same track → return progress only
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
        return {"status": "pending", "isAllowed": False, "canControl": False}

    # 6️⃣ New user → add to request_list
    new_user = User(name=name, key=key)
    request_list.append(new_user)
    print("New join request:", new_user)
    await broadcast_log(f"🟡 {new_user.name} requested to join ({new_user.key[:6]}...)")

    # Notify hosts
    for ws in connected_frontends:
        await ws.send_json({
            "type": "new_request",
            "user": {"name": new_user.name, "key": new_user.key}
        })

    return {"status": "pending", "isAllowed": False, "canControl": False}




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
async def get_auth_token(auth: AuthRequest):
    global callback_completed
    callback_completed = {"ok": False, "denied":False}
    
    
    client_id = auth.client_id
    client_secret = auth.client_secret

    # Build auth URL
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": client_id,
        "show_dialog": "true",
    }
    auth_url = f"{SPOTIFY_AUTH_URL}?{urllib.parse.urlencode(params)}"

    # Validate client_id/secret
    async with httpx.AsyncClient() as client:
        data = {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        }
        r = await client.post("https://accounts.spotify.com/api/token", data=data)
        if r.status_code != 200:
            return {"error": "invalid_creds"}

    # Save creds in memory keyed by client_id
    pending_auth[client_id] = {
        "client_secret": client_secret,
        "auth_url": auth_url,
        }

    return {"ok": True}



@router.get("/redirect/")
async def redirect_to_spotify(client_id: str):
    if client_id not in pending_auth:
        raise HTTPException(status_code=400, detail="unknown_client")
    return RedirectResponse(pending_auth[client_id]["auth_url"])

@router.get("/check/")
def check():
    return {"ok":True}


@router.get("/callback")
async def callback(code: str | None = Query(None), state: str | None = Query(None), error: str | None = Query(None)):
    client_id = state
    """
    Spotify redirects here with ?code=...
    We'll look up the stored client_secret from pending_auth.
    """
    global tokens
    global callback_completed
    if error: # if user manually clicks 
        callback_completed["denied"] = True
    
    
    if (not code or not state) and not error:
        return callback_completed

    if client_id not in pending_auth:
        return {"error": "no_pending_auth"}

    client_secret = pending_auth[client_id]["client_secret"]

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

    set_key(".env", "CLIENT_ID", client_id)
    set_key(".env", "CLIENT_SECRET", client_secret)
    set_key(".env", "ACCESS_TOKEN", tokens["access_token"])
    set_key(".env", "REFRESH_TOKEN", tokens["refresh_token"])

    # Cleanup
    pending_auth.pop(client_id, None)
    callback_completed = {"ok": True}

    return {"ok": True}




@router.get("/token-check/")
async def token_check():
    """
    Checks if required Spotify tokens exist in .env and verifies if the user is premium.
    Returns True if tokens exist and user is premium, False otherwise.
    """
    required_keys = ["CLIENT_ID", "CLIENT_SECRET", "ACCESS_TOKEN", "REFRESH_TOKEN"]
    global state
    global tokens

    if not os.path.exists(".env"):
        return {"valid": False, "premium": False,"nopath":1}

    with open(".env", "r") as f:
        env_content = f.read()


    # Check that all required keys are present in .env
    valid = all(key + "=" in env_content for key in required_keys)
    if not valid:
        return {"valid": False, "premium": False,"invalidkeys":1}

    # Read access & refresh tokens from .env
    access_token = None
    refresh_token = None
    for line in env_content.splitlines():
        if line.startswith("ACCESS_TOKEN="):
            access_token = line.split("=", 1)[1].strip()
        elif line.startswith("REFRESH_TOKEN="):
            refresh_token = line.split("=", 1)[1].strip()
    access_token = line.split("=", 1)[1].strip().strip('"').strip("'")
    refresh_token = line.split("=", 1)[1].strip().strip('"').strip("'")


    if not access_token:
        return {"valid": False, "premium": False,"noaccesstoken":1}

    # Make a call to Spotify API to verify user status
    try:
        headers = {"Authorization": f"Bearer {access_token}"}
        async with httpx.AsyncClient() as client:
            r = await client.get("https://api.spotify.com/v1/me", headers=headers)            
            #refresh access token if invalid
            if r.status_code == 401 and refresh_token:
                try:
                    
                    access_token = refresh_access_token(refresh_token)
                    print("refreshing access tokens")
                    set_key(".env", "ACCESS_TOKEN", access_token)
                    tokens["access_token"] = access_token
                    tokens["refresh_token"] = refresh_token
                    headers["Authorization"] = f"Bearer {access_token}"
                    r = await client.get("https://api.spotify.com/v1/me", headers=headers)
                except Exception:
                    return {"valid": False, "premium": False,"refreshfail":1}
                
                
            tokens["access_token"] = access_token
            tokens["refresh_token"] = refresh_token
            set_key(".env", "ACCESS_TOKEN", tokens["access_token"])
            set_key(".env", "REFRESH_TOKEN", tokens["refresh_token"])
            
            if r.status_code != 200:
                print(r)
                return {"valid": False, "premium": False,"!200":1}
            try:
                data = r.json()
            except Exception: 
                
                return {"valid": False, "premium": False,"innertry":1}
            is_premium = data.get("product") == "premium"
            
    except Exception as e:
        print("Error validating token:", e)
        return {"valid": False, "premium": False, "outertry":1}

    print("ENV Valid, starting to cache progress")
    state["env_valid"] = True  # if everything is valid


    return {"valid": True, "premium": is_premium}


@router.get("/room/")
async def get_room():
    """
    Reads room.json from the parent folder and returns its contents.
    """
    try:
        room_file = Path(__file__).parent.parent / "room.json"
        with open(room_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {"success": True, "data": data}
    except FileNotFoundError:
        return {"success": False, "error": "room.json not found"}
    except json.JSONDecodeError:
        return {"success": False, "error": "Failed to parse room.json"}




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
    CLIENT_ID,CLIENT_SECRET = get_creds()
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
    return env.get("CLIENT_ID"), env.get("CLIENT_SECRET")



















# async def refresh_access_token(refresh_token: str) -> str:
#     url = "https://accounts.spotify.com/api/token"
    
#     # Encode client_id and client_secret as Base64
#     client_creds = f"{CLIENT_ID}:{CLIENT_SECRET}"
#     b64_creds = base64.b64encode(client_creds.encode()).decode()
#     headers = {
#         "Authorization": f"Basic {b64_creds}",
#         "Content-Type": "application/x-www-form-urlencoded"
#     }
    
#     data = {
#         "grant_type": "refresh_token",
#         "refresh_token": refresh_token
#     }

#     async with httpx.AsyncClient() as client:
#         r = await client.post(url, data=data, headers=headers)
#         res = r.json()

#     if "access_token" not in res:
#         raise Exception(f"Failed to refresh token: {res}")

#     tokens["access_token"] = res["access_token"]
#     return res["access_token"]
