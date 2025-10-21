# 🎶 **Syncify — Your friends, your music, in sync.**

> Made for fun ❤️ · Not affiliated with Spotify

Hey there!

**Syncify** is a small side project I built for me and a friend — we just wanted an easy way to listen to the same Spotify music together, in real time.  

Well, if you have Premium, Spotify already gives you the *Jam* feature — but what if one or more of your friends don’t? Yet you still want to listen together somehow?  
That’s exactly why this was made — my friend didn’t have a premium subscription, so I built Syncify as a simple workaround to make shared listening possible.  

Later I thought, *why not share it*, in case someone else finds it fun or useful too.  

So here it is. 💚  


---

##  What It Does
<p align="center">
<b>WATCH</b>
</p>
<p align="center">
  <a href="https://youtu.be/Z6HunrFj6-w">
    <img src="https://img.youtube.com/vi/Z6HunrFj6-w/0.jpg" width="300" alt="Quick look">
  </a>
</p>


Syncify keeps everyone’s Spotify playback perfectly in sync — one person hosts, friends join in, and everyone hears the same thing at the same time.  
- Anyone in the session can control playback by default.  
- The host can turn off control for specific users if needed.  
- Simple, fun, and great for group listening or chill sessions. 🎧  
- No premium needed for listeners, except the host.

---


## Where to Start

### 👉 If you want to *host*:
Go to the [`host`](host/) folder for setup instructions.  
You’ll need a **Spotify Premium** account (since Spotify only allows playback control via Premium) and **Windows** as your OS.  

### 🎧 If you just want to *join*:
Head to the [`extension`](extension/) folder.  
Once you’ve installed it, you can join any session shared by a host.  

---
## 📁 Project Structure

```
.
├── extension/                          → Browser extension for listeners
├── host/                               → Frontend + backend for hosting sessions
│   ├── backend/                        → FastAPI backend — session & API logic
│   ├── frontend/                       → React dashboard UI
│   ├── requirements.txt                → Python dependencies
│   ├── setup.bat                       → Quick start setup for hosts
│   └── setup_helper_do_not_run_manually.py → Helper script for setup automation
├── .gitignore
└── readme.md
```


## ⚠️ Disclaimer

> **Please read this carefully.**

Syncify, the extension, uses browser-based interactions and may **involve DOM manipulation** on the Spotify Web Player.  
Because of that, **this project, specifically for the extension users, might violate Spotify’s Terms of Service**.  

This was made purely for personal learning and fun — **not** for distribution, resale, or to interfere with Spotify’s platform.  
If you decide to try it, please do so responsibly and **at your own risk**.  

I’m sharing this just as a hobby project — I can’t take responsibility for any account issues or policy actions that might result from using it.  

---

##  Final Thoughts

Syncify isn’t a product or startup — just a little experiment that turned out cooler than expected.  
If you like it, tweak it, fork it, or use it with friends — but remember the above disclaimer and respect Spotify’s terms.  

Thanks for checking it out, and happy syncing!
