import secrets
import subprocess
import re
import random
import json
import signal
import sys
import os
import threading
import time
import webbrowser
import requests

PORT = 8000
ROOM_FILE = "room.json"
HOME_DIR = os.path.expanduser("~")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# store cloudflared inside ./bin/cloudflared/cloudflared.exe (avoids OneDrive folder issues)
CLOUDFLARE_PATH = os.path.join(SCRIPT_DIR, "bin", "cloudflared", "cloudflared.exe")

VENV_PATH = os.path.join(os.path.dirname(__file__), "venv")
PYTHON_PATH = os.path.join(VENV_PATH, "Scripts", "python.exe")
UVICORN_MODULE = "backend.main:app"
FIREBASE_BASE = "https://spotisyncrooms-default-rtdb.asia-southeast1.firebasedatabase.app"

KEY_FILE = os.path.join(os.path.dirname(__file__), "backend", ".host_key")
def generate_host_key():
    key = secrets.token_hex(16)  # 32 chars
    with open(KEY_FILE, "w") as f:
        f.write(key)
    return key


# Function to stream subprocess output
def stream_output(process, label):
    for line in iter(process.stdout.readline, ''):
        if line:
            print(f"[{label}] {line.strip()}")
    try:
        process.stdout.close()
    except Exception:
        pass


# ---------------- Firewall Setup ----------------
def setup_firewall():
    # 1. Port Rule
    check_port_rule = subprocess.run(
        f'netsh advfirewall firewall show rule name="FastAPI-Port-{PORT}"',
        shell=True,
        capture_output=True,
        text=True
    )
    if "No rules match" in check_port_rule.stdout:
        print(f"Adding firewall rule for port {PORT}...")
        subprocess.run([
            "netsh", "advfirewall", "firewall", "add",
            "rule", f"name=FastAPI-Port-{PORT}",
            "dir=in", "action=allow",
            "protocol=TCP", f"localport={PORT}"
        ], shell=True)
    else:
        print(f"Firewall port rule for {PORT} already exists.")

    # 2. Program Rule
    check_prog_rule = subprocess.run(
        f'netsh advfirewall firewall show rule name="FastAPI-Python" | findstr /I "{PYTHON_PATH}"',
        shell=True,
        capture_output=True,
        text=True
    )
    if check_prog_rule.returncode != 0:
        print(f"Adding firewall rule for Python executable: {PYTHON_PATH}")
        subprocess.run([
            "netsh", "advfirewall", "firewall", "add",
            "rule", "name=FastAPI-Python",
            "dir=in", "action=allow",
            f'program={PYTHON_PATH}', "enable=yes"
        ], shell=True)
    else:
        print("Firewall rule for Python executable already exists.")


# ---------------- Start Uvicorn ----------------
print("Starting FastAPI backend...")
uvicorn_process = subprocess.Popen(
    [
        PYTHON_PATH, "-m", "uvicorn", UVICORN_MODULE,
        "--port", str(PORT),
        "--host", "0.0.0.0"
    ],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True
)

lt_process = None


# ---------------- Room Helpers ----------------
def load_cached_room():
    if os.path.exists(ROOM_FILE):
        try:
            with open(ROOM_FILE, "r") as f:
                room_data = json.load(f)
                if "room_id" in room_data and "url" in room_data:
                    print(f"INFO: Loading room data from {ROOM_FILE}.")
                    return room_data
                else:
                    print(f"WARNING: {ROOM_FILE} missing 'room_id' or 'url'.")
                    return None
        except json.JSONDecodeError:
            print(f"ERROR: Could not decode JSON from {ROOM_FILE}.")
            return None
        except IOError:
            print(f"ERROR: Could not read file {ROOM_FILE}.")
            return None
    else:
        print(f"INFO: Cached room file {ROOM_FILE} not found.")
        return None


def start_cloudflare_tunnel(local_port: int, room_id: str):
    global lt_process
    cmd = [
        CLOUDFLARE_PATH, "tunnel", "--url", f"http://localhost:{local_port}", "--no-autoupdate"
    ]
    lt_process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    url = None
    for line in iter(lt_process.stdout.readline, ''):
        if line:
            print(f"[CF] {line.strip()}")
            match = re.search(r"(https://[a-zA-Z0-9-]+\.trycloudflare.com)", line)
            if match:
                url = match.group(1)
                break
        if lt_process.poll() is not None:
            break

    # ---- MINIMAL CHANGE: keep streaming the rest of cloudflared output in background ----
    # This continues printing logs after we stop reading for the initial URL match.
    threading.Thread(target=stream_output, args=(lt_process, "Cloudflared"), daemon=True).start()
    # -------------------------------------------------------------------------------

    if url:
        print(f"✅ Cloudflare tunnel ready: {url}")
        return url
    else:
        print("❌ Failed to start Cloudflare tunnel.")
        return None


def is_room_free(room_id: str):
    try:
        resp = requests.get(f"{FIREBASE_BASE}/rooms/{room_id}.json")
        return resp.json() is None
    except Exception:
        return True


def register_room_in_firebase(room_id: str, url: str):
    data = {"url": url, "timestamp": int(time.time())}
    try:
        resp = requests.put(f"{FIREBASE_BASE}/rooms/{room_id}.json", json=data)
        return resp.status_code == 200
    except Exception:
        return False


# ---------------- Tunnel Monitor / Restart ----------------
def monitor_tunnel(room_id, url, check_interval=5, max_retries=10):
    """Ping the Cloudflare URL repeatedly; restart tunnel on failure and update room.json"""
    global lt_process
    retries = 0

    while True:
        try:
            resp = requests.get(f"{url}/api/ping", timeout=10)
            if resp.status_code == 200:
                time.sleep(check_interval)
            else:
                print(f"[Tunnel] Ping returned {resp.status_code}, restarting tunnel...")
                url = restart_tunnel(room_id, url)
                retries = 0
        except requests.RequestException as e:
            print(f"[Tunnel] Ping failed ({e}), restarting tunnel...")
            url = restart_tunnel(room_id, url)
            retries += 1
            if retries >= max_retries:
                print("🚫 Max retries reached. Exiting...")
                cleanup()
                sys.exit(1)
            time.sleep(check_interval)

def restart_tunnel(room_id, old_url):
    """Kill old tunnel and start a new one, updating room.json"""
    global lt_process
    if lt_process:
        try:
            lt_process.kill()
            lt_process.wait()
        except Exception:
            pass

    # Start new tunnel
    new_url = start_cloudflare_tunnel(PORT, room_id)
    if new_url:
        print(f"[Tunnel] Tunnel restarted, new URL: {new_url}")
        # Update room.json with new URL
        try:
            register_room_in_firebase(room_id, new_url)
            with open(ROOM_FILE, "w") as f:
                json.dump({"room_id": room_id, "url": new_url}, f)
        except Exception as e:
            print(f"[Tunnel] Failed to update {ROOM_FILE}: {e}")
        return new_url
    else:
        print("[Tunnel] Failed to restart tunnel.")
        return old_url


# ---------------- Updated start_tunnel ----------------
def start_tunnel(port=PORT, max_retries=20, retry_delay=5):
    cached = load_cached_room()
    if cached:
        room_id = cached['room_id']
        try:
            fb_data = requests.get(f"{FIREBASE_BASE}/rooms/{room_id}.json").json()
        except Exception:
            fb_data = None

        if fb_data:
            try:
                resp = requests.get(f"{fb_data['url']}/api/ping", timeout=5)
                if resp.status_code == 200:
                    print(f"⚠️ Room ID {room_id} is already active, generating new ID...")
                    cached = None
                else:
                    print(f"ℹ️ Cached room inactive, overwriting URL...")
            except Exception:
                print(f"ℹ️ Cached room inactive, overwriting URL...")
        else:
            print(f"ℹ️ No Firebase entry for cached room, reusing room ID.")
    retries = 0
    while True:
        if not cached:
            room_id = str(random.randint(10000, 99999))
            if not is_room_free(room_id):
                continue

        url = start_cloudflare_tunnel(port, room_id)
        if url:
            if not register_room_in_firebase(room_id, url):
                print(f"❌ Failed to register room in Firebase, retrying...")
                cached = None
                retries += 1
                if retries >= max_retries:
                    print("🚫 Max retries reached registering room. Exiting.")
                    sys.exit(1)
                time.sleep(retry_delay)
                continue

            try:
                with open(ROOM_FILE, "w") as f:
                    json.dump({"room_id": room_id, "url": url}, f)
            except Exception as e:
                print(f"❌ Failed to write {ROOM_FILE}: {e}")

            print(f"✅ Tunnel ready, room ID = {room_id}")
            # Start monitor thread to self-heal tunnel
            threading.Thread(target=monitor_tunnel, args=(room_id, url), daemon=True).start()
            return room_id
        else:
            retries += 1
            print(f"⚠️ Tunnel failed (attempt {retries}/{max_retries}), retrying in {retry_delay}s...")
            cached = None
            if retries >= max_retries:
                print("🚫 Cloudflare tunnel could not be established after multiple attempts.")
                cleanup()
                sys.exit(1)
            time.sleep(retry_delay)



# ---------------- Cleanup ----------------
def cleanup(signal_received=None, frame=None):
    global uvicorn_process, lt_process
    print("\nShutting down processes...")

    cached = load_cached_room()
    if cached:
        room_id = cached.get("room_id")
        if room_id:
            try:
                resp = requests.delete(f"{FIREBASE_BASE}/rooms/{room_id}.json")
                if resp.status_code in (200, 204):
                    print(f"✅ Room {room_id} removed from Firebase.")
                else:
                    print(f"⚠️ Failed to remove room {room_id} from Firebase, status: {resp.status_code}")
            except Exception as e:
                print(f"❌ Error removing room {room_id} from Firebase: {e}")

    if uvicorn_process:
        try:
            uvicorn_process.kill()
            uvicorn_process.wait()
            print("Uvicorn process killed.")
        except Exception:
            pass

    if lt_process:
        try:
            lt_process.kill()
            lt_process.wait()
            print("Cloudflare tunnel process killed.")
        except Exception:
            pass

    sys.exit(0)



signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

# Make the uvicorn log thread a daemon so it won't block process exit
threading.Thread(target=stream_output, args=(uvicorn_process, "Uvicorn"), daemon=True).start()


# ---------------- Main ----------------
if __name__ == "__main__":
    setup_firewall()
    time.sleep(2)
    start_tunnel(PORT)
    os.system("cls" if os.name == "nt" else "clear")
    print("----------------------------------------------------------------------")
    print("Press Ctrl+C to stop the FastAPI backend and Cloudflare tunnel gracefully.")
    print("----------------------------------------------------------------------")

    key = generate_host_key()
    print("host key: ", key)
    webbrowser.open(f"http://localhost:8000/?key={key}")

    while True:
        time.sleep(1)
