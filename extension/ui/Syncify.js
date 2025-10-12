// Grab elements
const nowPlayingDiv = document.querySelector(".spotify-now-playing");
const coverImg = nowPlayingDiv.querySelector(".cover");
const titleDiv = nowPlayingDiv.querySelector(".title");
const artistsDiv = nowPlayingDiv.querySelector(".artists");
const progress = nowPlayingDiv.querySelector(".progress-bar .progress");
const thumb = nowPlayingDiv.querySelector(".progress-bar .thumb");
const progressTime = nowPlayingDiv.querySelector(".progress-time");
const progressDuration = nowPlayingDiv.querySelector(".progress-duration");
const playBtn = document.querySelector(".play-btn");
const pauseBtn = document.querySelector(".pause-btn");
const nextBtn = document.querySelector(".next-btn");
const trackInfoDiv = document.getElementById("track-info");
const progressBar = document.querySelector(".progress-bar");
const loaderOverlay = document.getElementById("loader-overlay");
const startSyncBtn = document.getElementById("start-sync");
const overlay = document.getElementById("stopped-sync-overlay");
const slowConnOverlay = document.getElementById("slow-conn");
const slowConnText = document.getElementById("slow-conn-overlay-text");
const syncOverlayText = document.querySelector(
  "#stopped-sync-overlay .overlay-text"
);

let enableSyncPointer = null;
let userHeaders;
let url;

let currentTrackUrl = null;
let lastTrackData = null;
let nextTrack = null;
let isPlaying = false;
let timeCheck = null;
let prevPercent = 0;
let prevProgress = 0;
let fetchData;
let controlsDisabled = false; // global flag for all listeners
let sidePanelOpen;
let logging = true;

const joinBtn = document.getElementById("join-btn");
const nameInput = document.getElementById("name");
const roomInput = document.getElementById("room-id");
const nameLabel = document.querySelector('label[for="name"]');
const roomLabel = document.querySelector('label[for="room-id"]');
nameInput.addEventListener("input", updateJoinButton);
roomInput.addEventListener("input", updateJoinButton);
const inpOverlay = document.getElementById("input-overlay");
const generalOverlay = document.getElementById("general-overlay");
const generalText = document.getElementById("general-text");
const exitBtn = document.getElementById("exit");
const exitDiv = document.getElementById("exit-div");
const panelBtn = document.getElementById("panel-btn");
const svg1 = document.getElementById("panel-svg1");
const svg2 = document.getElementById("panel-svg2");
let roomValid = false;

async function init() {
  // Hide start button initially
  startSyncBtn.style.display = "none";
  exitDiv.style.display = "none";
  svg1.style.display = "flex";
  svg2.style.display = "none";
  panelBtn.title =
    "Disable side-panel (Will change on re-opening the extension)";

  // Wrap sendMessage in a Promise
  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "checkUser" }, (res) => resolve(res));
  });

  if (!inpOverlay) return;
  generalOverlay.style.display = "none";
  generalOverlay.style.fontFamily = "";

  if (logging) console.log(response);
  sidePanelOpen = response?.sidePanelOpen;
  if (!sidePanelOpen) {
    svg1.style.display = "none";
    svg2.style.display = "flex";
    panelBtn.title =
      "Enable side-panel (Will change on re-opening the extension)";
  }

  if (response.exists) {
    // If user exists, hide input overlay
    inpOverlay.style.display = "none";
    fetchData = setInterval(fetchTrackDataFromBackground, 1000);

    // Await both storage gets cleanly
    const { API } = await chrome.storage.local.get("API");
    url = API;
    if (logging) console.log("API URL:", url);

    const { headers } = await chrome.storage.local.get("headers");
    userHeaders = headers;

    if (response.lastTrackData.isAllowed) startSyncBtn.style.display = "flex";
    exitDiv.style.display = "flex";
  } else {
    const savedName = localStorage.getItem("userName");
    const savedRoom = localStorage.getItem("roomID");
    if (logging) console.log(savedName, savedRoom);
    if (savedName) nameInput.value = savedName;
    if (savedRoom) roomInput.value = savedRoom;
    updateJoinButton();

    // Show the input overlay
    inpOverlay.style.display = "flex";
  }
}

init();

function updateJoinButton() {
  const nameValid = nameInput.value.length > 1;
  roomValid = roomInput.value.length === 5;

  roomLabel.style.color = "";

  if (nameValid && roomValid) {
    joinBtn.style.display = "inline-block";
  } else {
    joinBtn.style.display = "none";
  }

  // Optional: update labels with validation messages
  nameLabel.textContent = nameValid
    ? "Nick"
    : "Nick must be at least 2 characters";
  roomLabel.textContent = roomValid
    ? "Room ID"
    : "Room ID must be 5 characters";
}

// Call on input for both fields

// Run once initially to set the correct state
// updateJoinButton();
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault(); // prevent accidental form submission
    roomInput.focus();
  }
});

roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && roomValid) {
    e.preventDefault();
    joinBtn.click();
  }
});

joinBtn.addEventListener("click", () => {
  localStorage.setItem("userName", nameInput.value);

  loaderOverlay.style.display = "flex";
  chrome.runtime.sendMessage({
    action: "verifyRoom",
    name: nameInput.value,
    roomID: roomInput.value,
  });
});

function retryVerification() {
  loaderOverlay.style.display = "flex";
  chrome.runtime.sendMessage({
    action: "verifyRoom",
    name: nameInput.value,
    roomID: roomInput.value,
  });
}

function displayTrack(data, nextTrack) {
  // Case 1: no new data (paused or API returned null)
  if (!data) {
    if (!isPlaying) {
      //if(logging) console.log("No track data, showing placeholder");
      // Placeholder lastTrackData
      lastTrackData = {
        track: "Whoop, the host disconnected :[", // default title
        artists: "", // default artist
        cover: "sadge.gif", // default cover image
        progress: "0:00", // start progress
        duration: "0:00", // default duration
        playing: false, // mark as paused
      };
    }
    if (lastTrackData) {
      isPlaying = false; // show the paused track but mark it paused
      updateUI(lastTrackData, isPlaying);
    } else {
      nowPlayingDiv.style.display = "flex";
      currentTrackUrl = null;
    }
  } else {
    //if(logging) console.log("Received track data:", data);
    // Case 2: valid track data
    currentTrackUrl = data.url;
    lastTrackData = data; // remember the latest playing track
    isPlaying = data.playing ?? false; // in case playing is null (e.g. host closed Spotify), treat as paused
    timeCheck = data.progress;

    updateUI(data, isPlaying);
  }
}

function updateUI(data, isPlaying) {
  // Show widget

  if (!lastTrackData.canControl && nextBtn.style.cursor != "not-allowed")
    toggleControls(true);
  else if (lastTrackData.canControl && nextBtn.style.cursor == "not-allowed")
    toggleControls(false);

  if (data?.status == "pending") {
    generalText.textContent = "Waiting for host";
    generalOverlay.style.display = "flex";
    generalText.style.color = "";
    startSyncBtn.style.display = "none";
    exitDiv.style.display = "flex";
  }

  nowPlayingDiv.style.display = "flex";
  if (data.isAllowed && generalOverlay.style.display != "none") {
    generalText.textContent = "YAY, JOINING :)";
    generalText.style.color = "rgb(0, 255, 55)";
    setTimeout(() => {
      if (data.isAllowed) {
        if (logging) console.log("flexing btns");
        startSyncBtn.style.display = "flex";
        exitDiv.style.display = "flex";
        generalOverlay.style.display = "none";
      }
    }, 3000);
  }

  if (data.playing && data.slowConn && loaderOverlay.style.display != "flex") {
    if (slowConnOverlay) slowConnOverlay.style.display = "flex";
    return;
  } else {
    if (slowConnOverlay) slowConnOverlay.style.display = "none";
  }

  // Update info
  coverImg.src = data?.cover || "1wp.jpg";
  titleDiv.textContent = data.track || "Whoops, the host is afk!";
  artistsDiv.textContent = data.artists || "Unknown Artist";

  //set body background if exists
  if (coverImg && coverImg.src.startsWith("https://i.scdn.co/image")) {
    document.body.style.backgroundImage = `url(${coverImg.src})`;
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
    document.body.style.backgroundRepeat = "no-repeat";
  } else {
    document.body.style.backgroundImage = ""; // removes any previous background
  }

  // Progress
  const progressSec =
    data.progress != null ? timeStrToSec(data.progress) : prevProgress;
  //prevProgress = Math.max(progressSec, prevProgress); // ensure progress never goes backwards

  const percent =
    data.duration != null && progressSec != 0
      ? (progressSec / timeStrToSec(data.duration)) * 100
      : prevPercent; // prevPercent can be a variable tracking last percentage
  //prevPercent = Math.max(percent, prevPercent); // update prevPercent for next time

  progress.style.width = percent + "%";
  thumb.style.left = percent + "%";

  // Timers
  progressTime.textContent = secToTimeStr(progressSec);
  progressDuration.textContent = data.duration;

  // Show/hide play & pause buttons
  if (isPlaying) {
    playBtn.style.display = "none";
    pauseBtn.style.display = "inline-block";
  } else {
    playBtn.style.display = "inline-block";
    pauseBtn.style.display = "none";
  }
}

// ----------------- Get last track & next track from background -----------------
function fetchTrackDataFromBackground() {
  chrome.runtime.sendMessage({ action: "getLastTrack" }, (data) => {
    chrome.runtime.sendMessage({ action: "getNextTrack" }, (next) => {
      nextTrack = next || null;
      displayTrack(data, nextTrack);
    });
  });
}

// Show last track immediately
fetchTrackDataFromBackground();

// Update popup every second

function timeStrToSec(str) {
  const [min, sec] = str.split(":").map(Number);
  return min * 60 + sec;
}

function secToTimeStr(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}
function getSyncState() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "getSyncState" }, (res) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(res); // whole response comes back
    });
  });
}

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg.name === "verifyResponse") {
    loaderOverlay.style.display = "none";
    if (logging) console.log("inside verify");
    if (msg.success) {
      fetchData = setInterval(fetchTrackDataFromBackground, 1000);
      if (logging) console.log("response received:", msg);
      if (logging) console.log("✅ Room verified:", msg.data);
      localStorage.setItem("roomID", roomInput.value);
      // startSyncBtn.style.display = "flex";
      inpOverlay.style.display = "none";
      generalOverlay.style.backgroundColor = "";
      generalOverlay.style.display = "flex";
      generalText.style.color = "";
      generalText.textContent = "Waiting for host";

      const data = await chrome.storage.local.get("API");
      url = data.API;
      if (logging) console.log("API URL:", url);
      const res = await chrome.storage.local.get("headers");

      userHeaders = res.headers;
      if (logging) console.log(userHeaders);

      chrome.runtime.sendMessage({
        //start background sync
        type: "init",
      });
    } else {
      if (msg.reason === "timeout") {
        startSyncBtn.style.display = "none";
        roomLabel.textContent = "Verification timed out, retrying...";
        roomLabel.style.color = "red";
        console.warn("❌ Room verification failed:", msg.reason);
        retryVerification();
        return;
      }
      localStorage.removeItem("roomID");
      startSyncBtn.style.display = "none";

      roomLabel.textContent = "Room doesn't exist";
      roomLabel.style.color = "red";
      console.warn("❌ Room verification failed:", msg.reason);
      // show error message
    }
  }

  if (msg.action === "kicked" || msg.action === "rejected") {
    //Move the "kicked from room overlay to here to avoid abuse + fix immediate sending or new request after getting kicked"
    clearInterval(fetchData);
    generalOverlay.style.display = "flex";
    generalText.style.color = "rgba(255, 105, 105, 0.8)";
    generalOverlay.style.backgroundColor = "rgba(53, 22, 22, 0.8)";
    generalOverlay.style.fontFamily = '"VT323", monospace';
    inpOverlay.style.display = "none";

    startSyncBtn.style.display = "none";

    let secondsLeft = msg.timeLeft;
    if (msg.action === "kicked")
      generalText.textContent = `Kicked from the room :( Restarting in ${secondsLeft}s`;
    else
      generalText.textContent = `Rejected by host :( Restarting in ${secondsLeft}s`;

    const timer = setInterval(() => {
      secondsLeft--;
      if (msg.action === "kicked")
        generalText.textContent = `Kicked from the room :( Restarting in ${secondsLeft}s`;
      else
        generalText.textContent = `Rejected by host :( Restarting in ${secondsLeft}s`;

      if (secondsLeft <= 0) {
        exitRoom();
        clearInterval(timer);
        init(); // call init after 30 seconds
      }
    }, 1000);
  }

  if (msg.action === "tabClosed") {
    (async () => {
      try {
        const res = await getSyncState();
        innerEnableSync = res.enableSync;
        enableSyncPointer = innerEnableSync;
        firstTimePopup = res.firstTimePopup;

        if (innerEnableSync && firstTimePopup) {
          startSyncBtn.textContent = "Start Sync";
          if (overlay) overlay.style.display = "none";
        } else if (innerEnableSync) {
          startSyncBtn.textContent = "Stop Sync";
          if (overlay) overlay.style.display = "none";
        } else {
          startSyncBtn.textContent = "Start Sync";
          if (overlay) overlay.style.display = "flex";
        }

        if (logging) console.log("innerEnableSync =", innerEnableSync);
      } catch (err) {
        console.error("getSyncState failed:", err);
      }
    })();
  }
});

(async () => {
  try {
    const res = await getSyncState();
    innerEnableSync = res.enableSync;
    enableSyncPointer = innerEnableSync;

    firstTimePopup = res.firstTimePopup;

    if (innerEnableSync && firstTimePopup) {
      startSyncBtn.textContent = "Start Sync";
      if (overlay) overlay.style.display = "none";
    } else if (innerEnableSync) {
      startSyncBtn.textContent = "Stop Sync";
      if (overlay) overlay.style.display = "none";
    } else {
      startSyncBtn.textContent = "Start Sync";
      if (overlay) overlay.style.display = "flex";
    }

    if (logging) console.log("innerEnableSync =", innerEnableSync);
  } catch (err) {
    console.error("getSyncState failed:", err);
  }
})();

/*async function updateSyncUI() {
  const overlay = document.getElementById("stopped-sync-overlay");
  const startSyncBtn = document.getElementById("start-sync");

  try {
    const res = await getSyncState();
    innerEnableSync = res.enableSync;
    firstTimePopup = res.firstTimePopup;

    if (innerEnableSync && firstTimePopup) {
      startSyncBtn.textContent = "Start Sync";
      if (overlay) overlay.style.display = "none";
    } else if (innerEnableSync) {
      startSyncBtn.textContent = "Stop Sync";
      if (overlay) overlay.style.display = "none";
    } else {
      startSyncBtn.textContent = "Start Sync";
      if (overlay) overlay.style.display = "flex";
    }

    if(logging) console.log("innerEnableSync =", innerEnableSync);
  } catch (err) {
    console.error("getSyncState failed:", err);
  }
}

updateSyncUI();
*/

// Start sync button

startSyncBtn.addEventListener("click", async () => {
  try {
    const res = await getSyncState();
    enableSyncPointer = innerEnableSync;

    innerEnableSync = res.enableSync;
    firstTimePopup = res.firstTimePopup;
    if (logging) console.log("firstTimePopup =", firstTimePopup);
    if (logging) console.log("innerEnableSync =", innerEnableSync);
  } catch (err) {
    console.error("getSyncState failed:", err);
  }

  if (!currentTrackUrl) {
    alert("No track currently playing.");
    return;
  }
  const overlay = document.getElementById("stopped-sync-overlay");
  if (firstTimePopup) {
    if (logging) console.log("First time popup - starting sync");
    startSyncBtn.textContent = "Stop Sync";
    if (overlay) overlay.style.display = "none";
    chrome.runtime.sendMessage({
      action: "startSync",
      trackUrl: currentTrackUrl,
      manuallyStopped: false,
    });
  } else if (!innerEnableSync) {
    // Start sync
    startSyncBtn.textContent = "Stop Sync";

    chrome.runtime.sendMessage({
      action: "toggleSync",
      trackUrl: currentTrackUrl,
    });

    if (overlay) overlay.style.display = "none";
  } else {
    // Stop sync
    innerEnableSync = false;
    startSyncBtn.textContent = "Start Sync";

    chrome.runtime.sendMessage({
      action: "toggleSync",
      manuallyStopped: true,
    });

    // Show the overlay from HTML
    if (overlay) overlay.style.display = "flex";
  }
});

playBtn.addEventListener("click", async () => {
  if (controlsDisabled) return; // skip if disabled

  try {
    loaderOverlay.style.display = "flex";
    const res = await fetch(`${url}/api/toggle-play-pause/`, {
      method: "POST",
      headers: userHeaders,
      body: null, // explicitly no body
    });

    const data = await res.json();
    if (data.success) {
      playBtn.style.display = "none";
      pauseBtn.style.display = "inline-block";
    }
    await waitUntil(() => isPlaying === true);

    loaderOverlay.style.display = "none";
  } catch (err) {
    console.error("Failed to play:", err);
  }
});

// Pause button listener
pauseBtn.addEventListener("click", async () => {
  if (controlsDisabled) return; // skip if disabled

  try {
    loaderOverlay.style.display = "flex";
    const res = await fetch(`${url}/api/toggle-play-pause/`, {
      method: "POST",
      headers: userHeaders,
      body: null, // explicitly no body
    });

    const data = await res.json();
    if (data.success) {
      pauseBtn.style.display = "none";
      playBtn.style.display = "inline-block";
    }

    await waitUntil(() => isPlaying === false);

    loaderOverlay.style.display = "none";
  } catch (err) {
    loaderOverlay.style.display = "none";
    console.error("Failed to pause:", err);
  }
});

//---------------- Control buttons -----------------
//---------------- Control buttons -----------------
//---------------- Control buttons -----------------
//---------------- Control buttons -----------------

if (nextBtn) {
  nextBtn.addEventListener("click", async () => {
    if (controlsDisabled) return; // skip if disabled
    try {
      loaderOverlay.style.display = "flex";

      // // Find any open Spotify tab
      // const tabs = await chrome.tabs.query({
      //   url: "*://open.spotify.com/*",
      // }); // no Spotify tab open

      // const tab = tabs.length ? tabs[0] : null; // take the first matching tab

      // if (tab && nextTrack && nextTrack.url) {
      //   await chrome.scripting.executeScript({
      //     target: { tabId: tab.id },
      //     func: (url) => {
      //       window.location.href = url;
      //     },
      //     args: [nextTrack.url],
      //   });
      // }
      chrome.runtime.sendMessage({
        action: "trackSkip",
        trackId: nextTrack ? nextTrack.id : null,
      });
      //convert this into a sendmsg type..

      // Call backend to advance playback
      const res = await fetch(`${url}/api/next-track/`, {
        method: "POST",
        headers: userHeaders,
      });
      const data = await res.json();

      if (!data.success) {
        console.error("Next track failed:", data.error);
      }
      const start = Date.now();
      timeCheck = timeStrToSec(lastTrackData.progress);

      // Wait until progress updates (indicating the new track has started) then remove the loader
      while (timeCheck !== 1) {
        timeCheck = timeStrToSec(lastTrackData.progress);
        if (logging) console.log(timeCheck);
        if (Date.now() - start > 15000) {
          // 5s timeout
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      loaderOverlay.style.display = "none";
    } catch (err) {
      console.error("Failed to skip track:", err);
    }
  });
}

progressBar.addEventListener("click", async (e) => {
  if (controlsDisabled) return; // skip if disabled

  if (logging) console.log("Progress bar clicked");
  if (!lastTrackData || !lastTrackData.duration) return;

  loaderOverlay.style.display = "flex";

  const rect = progressBar.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickPercent = clickX / rect.width;

  // Duration in seconds
  const trackDurationSec = timeStrToSec(lastTrackData.duration);

  // Calculate clicked time in ms
  const clickedTimeMs = Math.floor(clickPercent * trackDurationSec * 1000);

  if (logging)
    console.log(`Clicked at ${clickPercent * 100}% → ${clickedTimeMs} ms`);

  // Call backend route to seek
  try {
    const res = await fetch(
      `${url}/api/seek-track/?position_ms=${clickedTimeMs}`,
      { method: "PUT", headers: userHeaders }
    );
    if (logging) console.log(userHeaders);
    const data = await res.json();
    if (!data.success) console.error("Seek failed:", data.error);

    await new Promise((resolve) => setTimeout(resolve, 2000));
    loaderOverlay.style.display = "none";
  } catch (err) {
    console.error("Failed to seek:", err);
  }
});

exitBtn.addEventListener("click", () => {
  exitRoom();
});

function exitRoom() {
  chrome.runtime.sendMessage({ action: "exitRoom" }, (response) => {
    clearInterval(fetchData);
    if (chrome.runtime.lastError) {
      console.error("Message failed:", chrome.runtime.lastError);
      return;
    }
    if (logging) console.log("Got response from background:", response);

    // ✅ Do more stuff after background confirms
    if (response) {
      setTimeout(() => {
        init();
      }, 100);
    }
  });
}

panelBtn.addEventListener("click", () => {
  if (svg1.style.display == "flex") {
    svg1.style.display = "none";
    svg2.style.display = "flex";
    panelBtn.title =
      "Enable side-panel (Will change on re-opening the extension)";
  } else {
    svg1.style.display = "flex";
    svg2.style.display = "none";
    panelBtn.title =
      "Disable side-panel (Will change on re-opening the extension)";
  }
  chrome.runtime.sendMessage({ action: "togglePanel" });
});

function waitUntil(conditionFn, intervalMs = 500, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      try {
        if (conditionFn()) return resolve();
        if (Date.now() - start > timeoutMs) resolve(); // timeout reached, resolve anyway
        setTimeout(check, intervalMs);
      } catch (err) {
        reject(err);
      }
    };

    check();
  });
}

function toggleControls(disabled) {
  controlsDisabled = disabled; // listeners will check this

  const elements = [playBtn, pauseBtn, nextBtn, progressBar, progress, thumb];

  elements.forEach((el) => {
    if (!el) return;

    if (disabled) {
      document.querySelector(".spotify-now-playing")?.classList.add("disabled");
      el.style.cursor = "not-allowed"; // shows not-allowed cursor
      el.style.opacity = "0.5"; // dimmed appearance
    } else {
      document
        .querySelector(".spotify-now-playing")
        ?.classList.remove("disabled");
      el.style.cursor = "";
      el.style.opacity = "";
    }
  });
}
