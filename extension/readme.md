# 🔌 Syncify Extension — Join Listening Sessions

This is the browser extension that lets you join your friends’ Syncify sessions and stay in perfect sync.  

Even if you don’t have a premium Spotify account, you can listen along with the host and the group.  

---


<p align="center">New here? This short video shows what Syncify’s all about 🎶</p>
<p align="center">
  <a href="https://youtu.be/Z6HunrFj6-w">
    <img src="https://img.youtube.com/vi/Z6HunrFj6-w/0.jpg" width="200" alt="Quick look">
  </a>
</p>

---

## Quick guide

*(In case you’re new to installing extensions — this gif will help!)*  
<p align="center">
<img src="https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3p2OTcwOGVqYmIzajBhbGV2b2xkZThid2lzenJrMGpxanp6YWJyOSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/JN8WoykixDKUtYIsi1/giphy.gif" width="500" alt="Untitled-Project" border="0">
</p>

---

## 🚀 How to Install

1. [Download the extension](https://github.com/jnandevupadhya/test/releases/latest/download/extension.rar), right click on it and click on `extract to extension\`
2. Open your browser (Brave-browser is highly recommended). 
3. Type `chrome://extensions` in the search bar (or equivalent).  
4. Enable **Developer mode**.  
5. Click **Load unpacked** and select the extracted folder, or simply drag and drop the folder to the extension  page.  
6. You should see the Syncify extension appear — click it, enter your nickname, room ID, and enjoy!  

> **Note:** If you see a "Room doesn't exist" message, it could mean:  
> - You entered the wrong room ID (ask the host for the correct one), or  
> - Your internet connection is slow / temporarily disconnected.  
> Try again, and it should work!


---

##  Usage

Once you’ve joined a session, here’s what each button does:

- **Start / Stop sync** – Unless you click, it will not start / stop syncing, so don't forget to click start sync once you join a room. You can use this to stop syncing when you want to pause the song locally without leaving the room.
- **Play / Pause** – Toggles playback for everyone in the session.  
- **Next / Previous** – Skips or goes back to tracks for all listeners.   


- **Progress bar** - The green progress bar can be used to adjust playback progress.
- **Exit** – Exit the session safely.  
- 
  <img src="https://i.ibb.co/YTPnTNj0/square-top-down-svgrepo-com-1.png" width="30" alt="Square Top Down Icon"> can be used to toggle sidepanel, in case it's blocking your screen, you can click this button, which is visible at the bottom right of the extension's UI

> Tip: All listeners can control playback by default, but the host can disable control for specific users if needed.

---

## ⚙️ For Devs / Nerds

Here’s how the extension works under the hood:

- `background.js` handles the main logic for connecting to the host server and keeping playback in sync.  
  As soon as you enter the room ID in the popup, it fetches the API URL for that room from Firebase and uses it to sync with that specific session.  

- `Syncify.js` (the popup script) sends your **nickname** and **room ID** to `background.js`. The background script then:  
  1. Checks if the room exists.  
  2. Requests permission from the host to join.  
  3. Stores a temporary key in browser storage to prevent simple DoS-like attacks (note: not fully secure).  

- The extension listens for your playback state in the browser and updates the local session accordingly to stay in sync with the host and other listeners.


- The extension polls the host’s API for the current playback progress and updates the local session accordingly, keeping everyone synced.  

- Handles slow or unstable internet gracefully: playback stays smooth without constantly jumping back.  

- Uses a small **ping-based offset** when updating playback progress to compensate for internet latency, keeping listeners closely synced with the host even on slower connections.



> ⚠️ Reminder: the extension manipulates the Spotify Web Player DOM, which may violate Spotify’s Terms of Service. Use responsibly and at your own risk.


---

Made for fun ❤️ — just a personal side project, not affiliated with Spotify.
