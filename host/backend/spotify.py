import os
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
