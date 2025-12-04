import asyncio
import httpx
from .spotify import tokens, refresh_access_token, ms_to_min_sec
import os
from dotenv import load_dotenv
from .state import state
tokens_loaded = False
import time



current_track_cache = {"data": None, "last_fetched": 0}
FETCH_INTERVAL = 1  # seconds

async def refresh_spotify_cache():
    global current_track_cache
    global tokens_loaded
    global state
    async with httpx.AsyncClient() as client:
        ping = 0
        while True:
            if state.get("env_valid") and not tokens_loaded:
                load_tokens_from_env()
                tokens_loaded = True  # only load once
            if not tokens_loaded:
                # print("Tokens not found")
                await asyncio.sleep(0.8)
                continue
            
            try:
                access_token = tokens["access_token"]
                headers = {"Authorization": f"Bearer {access_token}"}
                url = "https://api.spotify.com/v1/me/player/currently-playing"

                start = time.perf_counter()
                r = await client.get(url, headers=headers)
                end = time.perf_counter()
                ping = (end - start)*1000
                

                if r.status_code == 401 and "refresh_token" in tokens:
                    access_token = refresh_access_token(tokens["refresh_token"])
                    headers = {"Authorization": f"Bearer {access_token}"}
                    
                    start = time.perf_counter()
                    r = await client.get(url, headers=headers)
                    end = time.perf_counter()
                    ping = (end - start)*1000
                    
                    


                if r.status_code == 204:
                    current_track_cache["data"] = {"playing": False}
                elif r.status_code == 200:
                    data = r.json()
                    track = data["item"]
                    progress_ms = data["progress_ms"]
                    duration_ms = track["duration_ms"]
                    percent_played = (progress_ms / duration_ms) * 100

                    current_track_cache["data"] = {
                        "playing": data["is_playing"],
                        "track": track["name"],
                        "artists": ", ".join([a["name"] for a in track["artists"]]),
                        "id": track["id"],
                        "url": track["external_urls"]["spotify"],
                        "progress": ms_to_min_sec(progress_ms),
                        "duration": ms_to_min_sec(duration_ms),
                        "percent_played": round(percent_played, 2),
                        "playback_time": progress_ms // 1000,  # <-- add this
                        "duration_sec": duration_ms // 1000,   # optional, for convenience
                        "ping": ping
                    }

                
                current_track_cache["last_fetched"] = asyncio.get_event_loop().time()
            except Exception as e:
                print("Error fetching Spotify track:", e)

            await asyncio.sleep(0.8)


def load_tokens_from_env():
    load_dotenv()  # reload in case .env changed
    tokens["access_token"] = os.getenv("ACCESS_TOKEN", "").strip()
    tokens["refresh_token"] = os.getenv("REFRESH_TOKEN", "").strip()
    global CLIENT_ID, CLIENT_SECRET
    CLIENT_ID = os.getenv("CLIENT_ID", "").strip()
    CLIENT_SECRET = os.getenv("CLIENT_SECRET", "").strip()