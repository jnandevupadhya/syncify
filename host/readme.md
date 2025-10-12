# 🎧 Syncify Host — Create & Manage Listening Sessions

> **Note: To host a room, you’ll need a Spotify Premium account, since Spotify requires it for playback control. If you’re on a free account, don’t worry — you can still join a friend’s room and enjoy the session together! Head to [`extension`](../extension/) in that case :)**


This is the **host app** that powers Syncify sessions.  
You’ll use this to get your room ID and let others listen along in perfect sync.  

---

## 🚀 How to Set Up

1. [Download the host package](https://github.com/jnandevupadhya/syncify/releases/latest/download/host.rar)  
2. Extract the zip anywhere, by clicking on `extract to host\` (for example, your Desktop).  

3. Double-click `setup.bat` — it will automatically install everything and start the server.  

4. Once it’s ready, the host page will open automatically in your browser (usually at `http://localhost:8000/`), showing your **host dashboard**.  

5. Once it opens, you’ll need to complete a one-time setup of your developer credentials. The complete guide will be displayed on the screen.
---

## Features
Once you reach the **Syncify Control Panel** page, you can:

- 🎵 **Control Playback** — Play, pause, skip, or go back — everyone in the room stays in perfect sync.  
- 🎨 **Change Backgrounds** — Click on <img src="https://i.ibb.co/YBQHtvBW/image.png" width="30" alt="bg changer"> at the top left of the page to personalize your dashboard with different backgrounds for a cozy or vibrant look.  
- 🏷️ **Customizable Room Info** — You can rename your room anytime and even edit the text shown next to the room ID for a personal touch.
  
- ✅ **Accept or Reject Requests** — When someone tries to join your room, approve or deny them right from the dashboard.  
- 🤝 **Whitelist Listeners** — Instantly approve trusted friends so they can join without waiting for manual approval next time.  
- 🚫 **Kick Users** — Remove any listener from the session instantly if needed.  
- ⚙️ **Toggle User Controls** - Allow or disable any user's control over your playback.
- 🧾 **View Logs** — See recent join attempts, playback events, and more — all neatly displayed for transparency.  
- 🔄 Persistent Session — Refreshing the page won’t end your session; it only stops when you close setup.bat.

> 💡 If you close the window or restart your PC, just double-click `setup.bat` again to start hosting.

---

## ⚙️ For Devs / Nerds

- The setup script takes care of everything automatically — installing dependencies, creating a local server, and loading the dashboard. 
   
- Each room ID is associated with a unique tunnel URL stored in Firebase, which the frontend and extension use to locate and connect to the correct host session, enabling room-based functionality.
- Your session data is stored locally in `room.json`, so if something looks off, you can simply restart `setup.bat`.  
- The app uses simple API calls to keep all listeners in sync, even on slow or unstable connections — each user’s progress is slightly adjusted based on their **ping** for smoother playback.  
- The backend caches playback progress to avoid making direct API calls to Spotify's endpoints, which could otherwise result in rate limits.  
- Every API call is validated: the backend checks the provided **session key** and **username** to ensure the user is allowed to interact.  
- Requests without valid keys, or attempts to control playback when a listener’s controls are disabled, are automatically rejected.  
- The system logs join/leave events, playback actions, and rejected attempts, providing a transparent history for debugging or monitoring sessions.  
- On refreshing, the backend sends a "rehydrate" event to the frontend to restore the session in progress, including pending requests, accepted users, and logs.

---

## 🧩 Folder Structure (after running it at least once)

```
├── backend/                 → FastAPI backend — handles sessions & playback sync  
├── frontend/                → Dashboard interface for hosting  
├── bin/                     → Couldflared binary to create a tunnel
├── venv/                    → Virtual environment (auto-created)  
├── .env                     → Valid spotify keys are stored after the second step  
├── requirements.txt         → Python dependencies  
├── room.json                → Active / previous room info  
├── setup.bat                → One-click setup and launch  
└── setup_helper_do_not_run_manually.py → Internal helper (don’t touch)  
```

---

## ❤️ Credits

Built just for fun — not affiliated with Spotify.  
Made with ❤️ by **dev**.
