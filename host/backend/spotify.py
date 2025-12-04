import os
import time
import requests
import base64
from dotenv import load_dotenv
from .state import state

load_dotenv()
missing_items = []

tokens = {
    "access_token": os.getenv("ACCESS_TOKEN", "").strip(),
    "refresh_token": os.getenv("REFRESH_TOKEN", "").strip()
}

CLIENT_ID = os.getenv("CLIENT_ID", "").strip()
CLIENT_SECRET = os.getenv("CLIENT_SECRET", "").strip()
FIREBASE_BASE = "https://spotisyncrooms-default-rtdb.asia-southeast1.firebasedatabase.app"


# --- Validation flags ---
has_tokens = bool(tokens["access_token"] and tokens["refresh_token"])
has_creds = bool(CLIENT_ID and CLIENT_SECRET)
creds_valid_length = (len(CLIENT_ID) == 32 if CLIENT_ID else False) and \
                     (len(CLIENT_SECRET) == 32 if CLIENT_SECRET else False)

# --- Helper function to check everything at once ---
def is_env_valid():
    return has_tokens and has_creds and creds_valid_length

# Optional: expose missing items for debugging


if not tokens["access_token"]:
    missing_items.append("ACCESS_TOKEN")
if not tokens["refresh_token"]:
    missing_items.append("REFRESH_TOKEN")
if not CLIENT_ID:
    missing_items.append("CLIENT_ID")
if not CLIENT_SECRET:
    missing_items.append("CLIENT_SECRET")

def refresh_access_token(refresh_token: str) -> str:
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
    return res["access_token"]


def ms_to_min_sec(ms: int) -> str:
    total_seconds = ms // 1000
    minutes = total_seconds // 60
    seconds = total_seconds % 60
    return f"{minutes}:{seconds:02}"


def get_headers():
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def register_room_in_firebase(room_id: str, url: str):
    data = {"url": url, "timestamp": int(time.time())}
    try:
        resp = requests.put(f"{FIREBASE_BASE}/rooms/{room_id}.json", json=data)
        return resp.status_code == 200
    except Exception:
        return False
    
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

def put_refresh_token(new_refresh_token: str):
    try:
        # 1️⃣ Get all rooms
        resp = requests.get(f"{FIREBASE_BASE}/rooms.json")
        if resp.status_code != 200:
            print(f"[firebase] Failed to fetch rooms: {resp.status_code}")
            return False
        
        rooms = resp.json() or {}
        if not isinstance(rooms, dict):
            print("[firebase] Invalid response format")
            return False
        
        # 2️⃣ Detect current app URL
        render_app_name = get_base_url()
        possible_urls = [
            render_app_name,
            "http://localhost:8000",
            "http://127.0.0.1:8000",
        ]

        target_room_id = None
        for room_id, info in rooms.items():
            room_url = info.get("url", "")
            if any(room_url.startswith(u) for u in possible_urls):
                target_room_id = room_id
                break

        if not target_room_id:
            print("[firebase] No matching room found for current app URL")
            return False
        
        # 3️⃣ Update only refresh_token (safe)
        patch_data = {"refresh_token": new_refresh_token}
        patch_resp = requests.patch(f"{FIREBASE_BASE}/rooms/{target_room_id}.json", json=patch_data)
        if patch_resp.status_code == 200:
            print(f"[firebase] Updated refresh_token for room {target_room_id}")
            return True
        else:
            print(f"[firebase] Failed to update room {target_room_id}: {patch_resp.status_code}")
            return False

    except Exception as e:
        print("[firebase] Exception:", e)
        return False


def get_refresh_token():
    """
    Reverse-fetch the room matching this app's base URL and return
    (room_id, refresh_token) if found, otherwise None.

    Usage:
        result = get_refresh_token()
        if result:
            room_id, rt = result
    """
    print("[firebase] Attempting to get refresh_token for current app URL...")
    try:
        base_url = get_base_url().rstrip("/").lower()

        resp = requests.get(f"{FIREBASE_BASE}/rooms.json", timeout=10)
        if resp.status_code != 200:
            print(f"[firebase] Failed to fetch rooms: status {resp.status_code}")
            return None

        rooms = resp.json() or {}
        if not isinstance(rooms, dict):
            print("[firebase] Invalid rooms payload")
            return None

        for room_id, info in rooms.items():
            if not isinstance(info, dict):
                continue
            room_url = str(info.get("url", "")).rstrip("/").lower()
            # match exact base_url or startswith (if your stored url may include paths)
            if room_url == base_url or room_url.startswith(base_url + "/"):
                refresh_token = info.get("refresh_token")
                return (room_id, refresh_token) if refresh_token else None

        # no matching room found
        print(f"[firebase] No room found matching base URL {base_url}")
        return None

    except Exception as e:
        print(f"[firebase] Exception in get_refresh_token: {e}")
        return None

def is_room_free(room_id: str):
    try:
        resp = requests.get(f"{FIREBASE_BASE}/rooms/{room_id}.json")
        return resp.json() is None
    except Exception:
        return True
    
    
def get_room_id():
    """
    Reverse-fetch the room matching this app's base URL and return:
        (room_id, room_info)
    if found, otherwise None.

    Usage:
        result = get_room_id()
        if result:
            room_id, info = result
    """
    print("[firebase] Attempting to get room ID for current app URL...")

    try:
        base_url = get_base_url().rstrip("/").lower()

        resp = requests.get(f"{FIREBASE_BASE}/rooms.json", timeout=10)
        if resp.status_code != 200:
            print(f"[firebase] Failed to fetch rooms: status {resp.status_code}")
            return None

        rooms = resp.json() or {}
        if not isinstance(rooms, dict):
            print("[firebase] Invalid rooms payload")
            return None

        for room_id, info in rooms.items():
            if not isinstance(info, dict):
                continue

            room_url = str(info.get("url", "")).rstrip("/").lower()

            # Match exact base URL or startswith if stored url has path
            if room_url == base_url or room_url.startswith(base_url + "/"):
                print(f"[firebase] Matched room: {room_id}")
                return room_id

        print(f"[firebase] No room found matching base URL {base_url}")
        return None

    except requests.exceptions.RequestException as e:
        print(f"[firebase] Request error: {e}")
        return None

    except Exception as e:
        print(f"[firebase] Unexpected error: {e}")
        return None
    
    
def _firebase_patch(path: str, data: dict):
    try:
        resp = requests.patch(path, json=data, timeout=10)
        return resp.status_code in (200, 204)
    except Exception as e:
        print(f"[firebase] patch error: {e}")
        return False


def _firebase_get(path: str):
    try:
        resp = requests.get(path, timeout=10)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"[firebase] get error: {e}")
    return None


