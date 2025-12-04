# 🎧 Syncify Host — Create & Manage Listening Sessions

> **Note: To host a room, you’ll need a Spotify Premium account, since Spotify requires it for playback control. If you’re on a free account, don’t worry — you can still join a friend’s room and enjoy the session together! Head to [`extension`](../extension/) in that case :)**


This is the **host app** that powers Syncify sessions.  
You’ll use this to get your room ID and let others listen along in perfect sync.  

---

## 🚀 How to Set Up (Render Deployment)

1. [Fork this repository](https://github.com/jnandevupadhya/syncify/fork)
2. [Open Render Web Service setup](https://dashboard.render.com/web/new)
3. Login or Register your account, connect it to GitHub and select **Syncify** under **Git Provider**.
4. In Render’s setup screen, configure the service:

   - **Runtime Environment:** Python 3  
   - **Branch:** `main` (default)  
   - **Region:** (Any)
   - **Root Directory:** `host`  
   - **Build Command:** ```pip install -r requirements.txt```
   - **Start Command:** `uvicorn backend.main:app --host 0.0.0.0 --port 8000`
   - **Instance Type:** Free  

   - **Spotify Developer Setup (Required):**  
     a. Go to: https://developer.spotify.com/dashboard/create  
     b. Click **Create App**  
        - App name: anything  
        - Description: anything

     c. Add Redirect URI:  
        ```
        https://<YOUR_SERVICE_NAME>.onrender.com/api/callback
        ```  
        Example: If your service name is "test syncify"
        ```
        https://test-syncify.onrender.com/api/callback
        ```
     d. Under **API Access**, enable:  
        - Web API  
        - Web Playback SDK
 
     e. After creating the app, copy:  
        - **Client ID**  
        - **Client Secret**  

     f. Add these in Render → Environment Variables:  
        - `CLIENT_ID` = your client id  
        - `CLIENT_SECRET` = your secret  
        - `APP_PASSWORD` = any password only you know (used to unlock the host page)

5. Click on `Deploy Web Service`
   

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
- 🔄 Persistent Whitelist — You do not need your pc anymore, render will allow whitelisted users automatically, even if your service goes to sleep.


---

## ⚙️ For Devs / Nerds

- Each room ID is associated with a unique tunnel URL stored in Firebase, which the frontend and extension use to locate and connect to the correct host session, enabling room-based functionality.
- Your session data and whitelisted-users list are stored in a public `Firebase` instance, in order to avoid data-loss in case of a free Render instance.
- The app uses simple API calls to keep all listeners in sync, even on slow or unstable connections — each user’s progress is slightly adjusted based on their **ping** for smoother playback.  
- The backend caches playback progress to avoid making direct API calls to Spotify's endpoints, which could otherwise result in rate-limits.  
- Every API call is validated: the backend checks the provided **session key** and **username** to ensure the user is allowed to interact.  
- Requests without valid keys, or attempts to control playback when a listener’s controls are disabled, are automatically rejected.  
- The system logs join/leave events, playback actions, and rejected attempts, providing a transparent history for debugging or monitoring sessions.  
- On refreshing, the backend sends a "rehydrate" event to the frontend to restore the session in progress, including pending requests, accepted users, and logs.

---

## 🧩 Folder Structure

```
├── backend/                 → FastAPI backend — handles sessions & playback sync  
├── frontend/                → Dashboard interface for hosting  
└── requirements.txt         → Python dependencies
```

---

## ❤️ Credits

Built just for fun — not affiliated with Spotify.  
Made with ❤️ by **dev**.
