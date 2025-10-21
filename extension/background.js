// 🌍 Global variables — set once after user joins
let logging = true;
let username = null;
let roomID = null;
let userKey = null;
let roomInitialized = false; // 🚫 Block until true
let url = "";
// url = `http://127.0.0.1:8000`; //uncomment when you want to test it locally
const extensionPath = "ui/Syncify.html"; // change this if you change the name of the files.

let lastTrackId = null;
let openedTrack = false;
let spotifyTabClosed = false;
let spotifyTabId = null;
let clientProgress = 0;
let lastTrackData = null;
let firstSeek = true;
let nextTrackData = null;
let enableSync = true;
let data = null;
let firstTimePopup = true;
let manuallyStopped = false;
let tab = null;
durationCheckTimeout = 0;
hasRefreshed = false;
let currentTrackUrl = null; // globally
const SPOTIFY_ORIGIN = "https://open.spotify.com";
let coverData = null;
let lastFetchedTrackId = null;
let sought = false; // flag to indicate if a seek operation just occurred
let skipped = false; // flag to indicate if a skip operation just occurred
let serverTrackId = null; // global
let globalAudioPlayingTabId = null; // global
let startTime = 0; // global
let stopTime = 0; // global
let ping = 0; // global
let songMismatch = 0; // global
let slowConn = false;
let prevProgress = 0;
let updateInterval;
let checkInterval;
let kickedTimeout = 0;
let tabToClose = null;
let isChangingTracks = false;
let refreshing = false;
let sidePanelOpen = true;
let doNotSeekSlowPing = false;
let slowConnTimer = null;
let slowConnActive = false;
let prevProgressSec = null;
let refreshTimeout = null;
let noNextTrack = false;

chrome.storage.local.get("sidePanelOpen", (result) => {
  // result is an object like { sidePanelOpen: value }
  console.log(result.sidePanelOpen);
  if (result.sidePanelOpen == null) {
    sidePanelOpen = true;
    chrome.storage.local.set({ sidePanelOpen: true });
  } else sidePanelOpen = result.sidePanelOpen;
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: sidePanelOpen })
    .catch((error) => console.error(error));
});
if (logging) console.log("sidePanelOpen =", sidePanelOpen);

function togglePanelBehavior() {
  chrome.storage.local.set({ sidePanelOpen: !sidePanelOpen });

  sidePanelOpen = !sidePanelOpen;

  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: sidePanelOpen })
    .then(() => {
      if (logging) console.log("Side panel behavior updated:", sidePanelOpen);
    })
    .catch((err) => console.error(err));
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.url) return;

  await chrome.sidePanel.setOptions({
    tabId,
    path: extensionPath,
    enabled: true,
  });
});

function getAuthHeaders() {
  chrome.storage.local.set({
    headers: {
      "x-user-name": username,
      "x-user-key": userKey,
      "bypass-tunnel-reminder": "true",
    },
  });

  return {
    "x-user-name": username,
    "x-user-key": userKey,
    "bypass-tunnel-reminder": "true",
  };
}

function handleKicked(rejected = false) {
  clearInterval(updateInterval);
  clearInterval(checkInterval);
  roomInitialized = false;
  username = null;
  userKey = null;
  roomID = null;
  if (!rejected) {
    kickedTimeout = 30;
    chrome.runtime.sendMessage({ action: "kicked", timeLeft: kickedTimeout });
  } else {
    kickedTimeout = 15;
    if (logging) console.log("rejected by host");
    chrome.runtime.sendMessage({ action: "rejected", timeLeft: kickedTimeout });
  }

  const timer = setInterval(() => {
    kickedTimeout--;

    if (kickedTimeout <= 0) {
      kickedTimeout = 0;
      clearInterval(timer);
    }
  }, 1000);

  lastTrackData = null;
  return;
}

function generateKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get("userKey", (result) => {
      if (result.userKey) {
        if (logging) console.log("Stored key:", result.userKey);
        resolve(result.userKey);
      } else {
        // Generate new 32-char key
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        const newKey = Array.from(array, (b) =>
          b.toString(16).padStart(2, "0")
        ).join("");

        chrome.storage.local.set({ userKey: newKey }, () => {
          if (logging) console.log("Generated and stored new key:", newKey);
          resolve(newKey);
        });
      }
    });
  });
}

// ----------------- Initialize last track once -----------------
async function initLastTrackData() {
  try {
    if (logging) console.log("inside init block", getAuthHeaders());

    const res = await fetch(`${url}/api/progress/?force=true`, {
      headers: getAuthHeaders(),
    });

    data = await res.json();
    if (logging) console.log(data);

    lastTrackData = data;
    updateLastTrackCover();
    lastTrackData.cover = coverData?.cover || lastTrackData.cover || "1wp.jpg";
  } catch (err) {
    console.error("Failed to initialize last track:", err);
    lastTrackData = null;
  }
}

// ----------------- Continuous background fetch -----------------
async function updateLastTrackData() {
  startTime = Date.now(); // or Date.now() for ms timestamp
  if (!enableSync || kickedTimeout != 0 || username == null || userKey == null)
    return;
  try {
    const res = await fetch(`${url}/api/progress/`, {
      headers: getAuthHeaders(),
    });
    data = await res.json();
    if (lastTrackData?.isAllowed ?? false) roomInitialized = true;

    if (data?.progress <= lastTrackData?.progress) {
      data.progress = secToTimeStr(timeStrToSec(data.progress) + 1);
      if (logging) console.log("slow fetch");
    }
    // if(logging) console.log(data);
    stopTime = Date.now();
    ping = stopTime - startTime + lastTrackData?.ping;
    // if(logging) console.log(ping);
    // if(logging) console.log("Spotify ping:", lastTrackData?.ping?? null);

    //Since server only sends progress updates frequently, we need to merge them into lastTrackData
    if (Object.keys(data).length === 1 && "progress" in data) {
      // only update the progress field in lastTrackData
      //When host closes spotify, backend returns {"progress": null}
      if (lastTrackData) {
        lastTrackData.progress = data.progress;

        lastTrackData.cover =
          coverData?.cover || lastTrackData.cover || "1wp.jpg";
        if (data.progress == null) lastTrackData = null; // if server sends {"progress": null}, treat as no track, so that the placeholder shows
      }
    } else {
      // replace the whole object
      lastTrackData = data;
      lastTrackData.cover =
        coverData?.cover || lastTrackData?.cover || "1wp.jpg"; // preserve cover if already fetched
    }
    if (lastTrackData?.cover == "1wp.jpg") updateLastTrackCover();

    //handle kicked
    if (
      !lastTrackData?.isAllowed &&
      lastTrackData.status == "cooldown" &&
      roomInitialized
    ) {
      setTimeout(() => {
        if (logging)
          console.log(
            "kicked: ",
            lastTrackData?.isAllowed,
            lastTrackData?.status,
            roomInitialized
          );
        handleKicked();
        return;
      }, 3000);
    } else if (lastTrackData?.status === "cooldown") {
      // do something
      if (logging) console.log("rejected by host");
      handleKicked(true);
    }

    checkSlowConnection(lastTrackData);

    if (lastTrackData && lastTrackData.url) {
      currentTrackUrl = lastTrackData.url;
    }

    if (
      lastTrackData &&
      lastTrackData.id &&
      lastTrackData.id !== lastFetchedTrackId
    ) {
      lastFetchedTrackId = lastTrackData.id;
      updateLastTrackCover();
      lastTrackData.cover =
        coverData?.cover || lastTrackData?.cover || "1wp.jpg"; // preserve cover if already fetched
    }
  } catch (err) {
    doNotSeekSlowPing = true;
    console.error("Tunnel error, stopped seeking: ", err);
  }
}

function checkSlowConnection(data) {
  if (!data || data.progress == null || !data?.playing || refreshing) {
    clearTimeout(slowConnTimer);
    slowConnActive = false;
    prevProgressSec = null;
    doNotSeekSlowPing = false;
    return;
  }

  const currentProgressSec = timeStrToSec(data.progress);

  // First time initialization
  if (prevProgressSec === null) {
    prevProgressSec = currentProgressSec;
    return;
  }

  // If progress hasn't advanced, start or maintain slow connection timer
  if (currentProgressSec <= prevProgressSec) {
    if (!slowConnActive) {
      slowConnActive = true;
      slowConnTimer = setTimeout(() => {
        console.warn("[SlowConn] Progress has not advanced for too long.");
        doNotSeekSlowPing = true; // or any custom flag you use to freeze seeking
        lastTrackData.slowConn = true;
      }, 2000); // adjustable lag tolerance window
    }
  } else {
    // Progress advanced again → clear any "slow" state
    clearTimeout(slowConnTimer);
    slowConnActive = false;
    doNotSeekSlowPing = false;
    lastTrackData.slowConn = false;
  }

  prevProgressSec = currentProgressSec;
}

// run every 5 seconds

// ---------------------- Update last track cover ----------------------
// ---------------------- Update last track cover ----------------------
// ---------------------- Update last track cover ----------------------

async function updateLastTrackCover() {
  try {
    const res = await fetch(`${url}/api/cover/${lastTrackData.id}`, {
      headers: {
        "bypass-tunnel-reminder": "true",
      },
    });

    coverData = await res?.json();

    if (coverData?.cover) {
      // attach cover to lastTrackData so progress updates don’t wipe it
      lastTrackData.cover = coverData?.cover || "1wp.jpg";
    }
  } catch (err) {
    lastTrackData.cover = coverData?.cover || "1wp.jpg";

    console.error("Failed to update last track cover:", err);
  }
}

//---------------- Check for duration mismatch and reload -----------------
//---------------- Check for duration mismatch and reload -----------------
//---------------- Check for duration mismatch and reload -----------------

function getFirstTwoWords(str) {
  if (!str) return "";
  const words = str.trim().split(/\s+/);
  const first = words[0] || "";
  const second = words[1] || "";
  return second ? `${first} ${second}` : first;
}

async function checkAndUpdateTrack() {
  if (!enableSync || isChangingTracks || !lastTrackData?.playing || refreshing)
    return;

  // 1️⃣ Find currently playing Spotify tab
  const tabs = await chrome.tabs.query({
    url: "*://open.spotify.com/*",
    audible: true,
  });

  if (tabs.length > 0) {
    globalAudioPlayingTabId = tabs[0].id;
  } else if (!globalAudioPlayingTabId) {
    return; // No audible tab and no saved tab
  }

  const tab = tabs[0] || { id: globalAudioPlayingTabId };
  if (!tab || !tab.id) {
    console.warn("No valid tab to run script on");
    return;
  }

  if (logging) console.log("inside check and update");
  // 2️⃣ Extract track name from <a data-testid="context-item-link">
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const el = document.querySelector('a[data-testid="context-item-link"]');
      return el ? el.textContent.trim() : null;
    },
  });

  const actualTrackName = results[0]?.result || "";
  const expectedTrackName = lastTrackData.track?.trim() || "";

  if (logging)
    console.log(
      `Track name check for tab ${tab.id}:`,
      `"${actualTrackName}"`,
      "Expected:",
      `"${expectedTrackName}"`
    );

  // 3️⃣ If track name mismatch → reload tab to correct track URL
  if (
    expectedTrackName &&
    actualTrackName &&
    actualTrackName.toLowerCase() !== expectedTrackName.toLowerCase()
  ) {
    console.warn(
      `Track mismatch detected: "${actualTrackName}" ≠ "${expectedTrackName}"`
    );
    const trackUrl = `https://open.spotify.com/track/${lastTrackData.id}`;
    chrome.tabs.update(tab.id, { url: trackUrl }, () => {
      if (logging) console.log("Tab updated to correct track due to mismatch.");
      firstSeek = true; //If there's a mismatch, wait for 3 seconds before seeking. Immediate seek will cause it to go back to prev track.
      refreshing = true;
      // fetchNextTrackOnce().catch((err) => console.error(err));

      startSyncLoop();
    });
  }
}

// ---------------------- Sync function ----------------------
async function syncTrack(clientProgressPercent = 0) {
  if (spotifyTabClosed || !enableSync || isChangingTracks) return;

  if (doNotSeekSlowPing) return;

  try {
    let tab;
    if (spotifyTabId) {
      const tabs = await chrome.tabs.query({ url: "*://open.spotify.com/*" });
      if (tabs.length > 0)
        tab = tabs.find((t) => t.id === spotifyTabId) || tabs[0];
      globalAudioPlayingTabId = tab.id;
    }

    // If the tab was skipped, don’t overwrite serverTrackId in order to let the next if block run and open the new track
    serverTrackId = skipped ? serverTrackId : lastTrackData?.id ?? null; // fallback to null if lastTrackData is missing

    // if(logging) console.log("inside sync block");
    // Mirror play/pause
    if (tab) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (shouldPlay) => {
          const btn = document.querySelector(
            '[data-testid="control-button-playpause"]'
          );
          if (!btn) return;
          const isPaused = btn.getAttribute("aria-label") === "Play";
          if (shouldPlay && isPaused) btn.click();
          if (!shouldPlay && !isPaused) btn.click();
        },
        args: [data.playing],
      });
    }

    if (!data.playing) return;

    let serverProgressSec = timeStrToSec(data.progress); // progress in seconds
    let clientProgressSec = await getClientPlaybackProgress(
      globalAudioPlayingTabId || tab.id
    );
    // if(logging) console.log(
    //   "duration: ",
    //   data.duration_sec,
    //   " svProg: ",
    //   serverProgressSec,
    //   " cliProg: ",
    //   clientProgressSec
    // );
    if (isChangingTracks) return;
    if (data.duration_sec - serverProgressSec <= 7) {
      if (logging)
        console.log(
          "changing track to: ",
          nextTrackData.name,
          nextTrackData?.url
        );
      isChangingTracks = true;
      firstSeek = true;

      tabToClose = await openSpotifyWithFallback(nextTrackData?.url);
      if (logging)
        console.log(
          "Initial SpotifyTab:",
          spotifyTabId,
          "TabToClose (new tab):",
          tabToClose
        );
      lastTrackId = nextTrackData.id;

      setTimeout(() => {
        chrome.tabs.query({}, (tabs) => {
          // Filter all tabs that have "open.spotify.com" in the URL
          const spotifyTabs = tabs.filter(
            (t) => t.url && t.url.includes("open.spotify.com")
          );

          // Check if any Spotify tab is playing audio
          const anyAudible = spotifyTabs.some((t) => t.audible);
          if (logging) console.log("Tab info: ", spotifyTabs);

          if (!anyAudible) {
            if (logging) console.log("No tabs playing audio");
            // No tabs are playing — close all except spotifyTabId
            spotifyTabs.forEach((t) => {
              if (t.id !== spotifyTabId) {
                if (logging)
                  console.log(
                    "[TabManager] Closing inactive Spotify tab:",
                    t.id
                  );
                chrome.tabs.remove(t.id);
              }
            });

            if (logging)
              console.log(
                "[TabManager] No audible tabs — kept spotifyTabId:",
                spotifyTabId
              );
          } else {
            // At least one tab is playing — do your normal logic
            const activeSpotifyTab = spotifyTabs.find((t) => t.audible);
            if (activeSpotifyTab) {
              spotifyTabId = activeSpotifyTab.id; // 🎯 Set to the currently playing tab
              if (logging)
                console.log(
                  "[TabManager] Updated spotifyTabId to active audible tab:",
                  spotifyTabId
                );
            }

            const inactiveSpotifyTabs = spotifyTabs.filter((t) => !t.audible);
            console.log("Inactive tabs: ", inactiveSpotifyTabs);

            if (inactiveSpotifyTabs.length > 0) {
              inactiveSpotifyTabs.forEach((t) => {
                if (logging)
                  console.log(
                    "[TabManager] Closing inactive Spotify tab:",
                    t.id
                  );
                chrome.tabs.remove(t.id);
              });
            } else if (logging) {
              console.log("[TabManager] No inactive Spotify tabs to close.");
            }
          }

          // Always ensure spotifyTabId becomes active if it exists
          if (spotifyTabId) {
            chrome.tabs.update(spotifyTabId, { active: true });
          }

          tabToClose = null;
          isChangingTracks = false;
        });
      }, 14000);

      return;
    }

    // chrome.scripting.executeScript({
    //   target: { tabId: spotifyTabId },
    //   world: "MAIN", // ✅ Important for interacting with Spotify's DOM
    //   func: () => {
    //     const btn = document.querySelector(
    //       '[data-testid="control-button-playpause"]'
    //     );
    //     if (!btn) {
    //       console.warn("Play/pause button not found");
    //       return;
    //     }

    //     if (btn.getAttribute("aria-label") === "Play") {
    //       if(logging) console.log("🎵 Clicking PLAY button...");
    //       setTimeout(() => {
    //         if (btn.getAttribute("aria-label") === "Play") {
    //           btn.click();
    //         }
    //       }, 300);
    //     }
    //   },
    // });

    // Open track once per song
    if (serverTrackId !== lastTrackId || !openedTrack) {
      if (logging) console.log(serverTrackId, lastTrackId, openedTrack);
      if (tab && !tab.url.includes(`/track/${serverTrackId}`)) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (url) => {
            window.location.href = url;
          },
          args: [data.url],
        });
      }
      manuallyStopped = false; // reset manual stop flag

      lastTrackId = serverTrackId;
      openedTrack = true;
      manuallyStopped = false; // reset manual stop flag

      // Reset firstSeek for this new song
      firstSeek = true;

      // Fetch next track asynchronously once
      fetchNextTrackOnce().catch((err) => console.error(err));
    }
    if (lastTrackData?.id == nextTrackData?.id)
      fetchNextTrackOnce().catch((err) => console.error(err));
    // ---- WAIT FOR PLAYBACK TO REACH 3 SECONDS ----
    if (!manuallyStopped && firstSeek) {
      await ensurePlaybackAtThreeSeconds(tab.id);
      if (logging)
        console.log(`Track ${data.track} reached 3 seconds, starting sync.`);
      startProgressSync(300); // start periodic progress sync every 300ms
      firstSeek = false;
    }

    //---------------- Only seek if difference >3% -----------------
    //---------------- Only seek if difference >3% -----------------
    //---------------- Only seek if difference >3% -----------------

    serverProgressSec = timeStrToSec(data.progress); // progress in seconds
    clientProgressSec = await getClientPlaybackProgress(
      globalAudioPlayingTabId || tab.id
    );

    const songDurationSec = timeStrToSec(data.duration); // duration in seconds

    // if(logging) console.log(
    //   `Server progress: ${serverProgressSec}s, Client progress: ${clientProgressSec}s`
    // );

    ping = firstSeek ? ping + 1500 : ping + 300; // add extra buffer for first seek
    if (
      tab &&
      Math.abs(serverProgressSec - clientProgressSec) > 3 &&
      !firstSeek //only seek if it's not the firstseek.. Firstseek is set true even when it's refreshing.
    ) {
      seekToSeconds(tab.id, serverProgressSec, songDurationSec, ping);
    }
  } catch (err) {
    console.error(err);
  }
}

// ---------------- Fetch next track once -----------------
async function fetchNextTrackOnce() {
  try {
    const queueRes = await fetch(`${url}/api/queue/`, {
      method: "GET",
      headers: getAuthHeaders(),
    });
    const queueData = await queueRes.json();
    if (queueData?.next_track) {
      nextTrackData = queueData.next_track;
      if (lastTrackData.id == nextTrackData.id) {
        if (logging)
          console.log(
            "last id: ",
            lastTrackData.id,
            " new track: ",
            nextTrackData.id
          );
        return;
      }
      if (logging)
        console.log(
          `[${new Date().toLocaleTimeString()}] Next song in queue:`,
          nextTrackData.name,
          nextTrackData.url
        );
    }
  } catch (err) {
    if (logging)
      console.log(
        `[${new Date().toLocaleTimeString()}] Failed to fetch next track:`,
        err
      );
    return;
  }
}

// ---------------- Tab close handling -----------------
chrome.tabs.onRemoved.addListener((closedTabId) => {
  if (closedTabId === spotifyTabId) {
    if (logging) console.log("Spotify tab closed. Stopping sync.");
    spotifyTabClosed = true;
    lastTrackId = null;
    openedTrack = false;
    spotifyTabId = null;
    clientProgress = 0;
    firstSeek = true;
    enableSync = false;
    firstTimePopup = true;
    manuallyStopped = false;
    globalAudioPlayingTabId = null;

    chrome.runtime.sendMessage({
      action: "tabClosed",
    });
  }
});

// ---------------- Message listener -----------------
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg.type === "checkUser") {
    //If user tries to reopen extension to skip Kicked timeout, send kicked again
    if (kickedTimeout != 0)
      chrome.runtime.sendMessage({ action: "kicked", timeLeft: kickedTimeout });
    // Check if both username and roomID exist

    const exists = username !== null && roomID !== null;
    if (!exists && updateInterval) clearInterval(updateInterval);
    if (!exists && checkInterval) clearInterval(checkInterval);
    sendResponse({ exists, username, roomID, sidePanelOpen, lastTrackData });
  }

  if (msg.action === "togglePanel") {
    togglePanelBehavior();
  }

  if (msg.action === "exitRoom") {
    if (logging) console.log("Exiting room...");
    clearInterval(updateInterval);
    clearInterval(checkInterval);
    leftRoom = true;
    roomInitialized = false;
    const leavingUser = username;
    const leavingKey = userKey;
    const leavingRoom = roomID;
    username = null;
    userKey = null;
    roomID = null;
    lastTrackData = null;
    data = null;

    // Send leave request to backend
    if (logging) console.log(url);
    if (leavingUser && leavingKey) {
      fetch(`${url}/api/leave`, {
        method: "POST",
        headers: {
          "x-user-name": leavingUser,
          "x-user-key": leavingKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ room_id: leavingRoom }),
      })
        .then((res) => res.json())
        .then((data) => (logging ? console.log("Leave response:", data) : null))
        .catch((err) =>
          console.error("Failed to notify backend on exit:", err)
        );
    }

    sendResponse({ success: true });
    return true; // keeps the message channel open for async response if needed
  }

  if (msg.action === "verifyRoom") {
    const { roomID: room, name } = msg;
    username = name;

    if (logging) console.log("Verifying room:", room, "for user:", name);

    (async () => {
      let responded = false;
      const controller = new AbortController();

      // Timeout
      const timeoutId = setTimeout(() => {
        if (!responded) {
          responded = true;
          controller.abort();
          console.warn("Room verification timed out");
          chrome.runtime.sendMessage({
            name: "verifyResponse",
            success: false,
            reason: "timeout",
          });
        }
      }, 5000);

      try {
        // Step 1: fetch room data from Firebase
        const fbResp = await fetch(
          `https://spotisyncrooms-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/${room}.json`
        );
        const fbData = await fbResp.json();

        if (logging) console.log(fbData);
        if (!fbData || !fbData.url) {
          clearTimeout(timeoutId);
          responded = true;
          chrome.runtime.sendMessage({
            name: "verifyResponse",
            success: false,
            reason: "room_not_found",
          });
          return;
        }

        url = fbData.url;
        chrome.storage.local.set({ API: url });

        // Step 2: ping the room URL
        const res = await fetch(`${url}/api/ping`, {
          method: "GET",
          signal: controller.signal,
        });

        if (responded) return;
        responded = true;
        clearTimeout(timeoutId);

        const raw = await res.text();

        if (logging) console.log(res);
        if (!res.ok) {
          chrome.runtime.sendMessage({
            name: "verifyResponse",
            success: false,
            reason: "bad_response",
            raw,
          });
          return;
        }

        let response;
        try {
          response = JSON.parse(raw);
        } catch (err) {
          console.error("Failed to parse JSON:", err, raw);
          chrome.runtime.sendMessage({
            name: "verifyResponse",
            success: false,
            reason: "invalid_json",
          });
          return;
        }

        // Success — generate userKey
        userKey = await generateKey();
        roomID = room;
        chrome.storage.local.set({ userKey: userKey });

        if (logging) console.log("key:", userKey);
        chrome.runtime.sendMessage({
          name: "verifyResponse",
          success: true,
          response,
        });
      } catch (err) {
        if (responded) return;
        responded = true;
        clearTimeout(timeoutId);

        if (err.name === "AbortError") {
          chrome.runtime.sendMessage({
            name: "verifyResponse",
            success: false,
            reason: "timeout",
          });
          return;
        }

        console.error("Error verifying room:", err);
        chrome.runtime.sendMessage({
          name: "verifyResponse",
          success: false,
          reason: "fetch_error",
        });
      }
    })();

    return true;
  }

  if (msg.type === "init") {
    console.log("Initializing background script...");
    // Update every second independently for popup
    initLastTrackData();
    updateLastTrackData();
    // Start intervals
    updateInterval = setInterval(updateLastTrackData, 1000);

    if (logging) console.log("[BG] Saved user info:", { username, roomID });
    sendResponse({ success: true });
  }

  if (msg.action === "getSyncState") {
    sendResponse({ enableSync, firstTimePopup });
    return true;
  }

  if (msg.action === "getLastTrack") {
    sendResponse(lastTrackData);
    return true;
  }

  if (msg.action === "getNextTrack") {
    sendResponse(nextTrackData); // return the next track cached in bg.js
    return true;
  }
  if (msg.action === "trackSkip") {
    console.log("Skipping: ", nextTrackData);
    serverTrackId = nextTrackData.id;
    lastTrackData.id = nextTrackData.id;
    refreshing = true;
    // openedTrack = false;
    // clientProgress = 0;
    // spotifyTabClosed = false;
    firstSeek = true;
    // enableSync = true;
    // firstTimePopup = false;
    // skipped = true;
    // skipPending = true;
    if (spotifyTabId && nextTrackData && nextTrackData.url) {
      await chrome.scripting.executeScript({
        target: { tabId: spotifyTabId },
        func: (url) => {
          window.location.href = url;
        },
        args: [nextTrackData.url],
      });
    }
  }

  if (msg.action === "startSync") {
    lastTrackId = null;
    openedTrack = false;
    spotifyTabId = null;
    clientProgress = 0;
    spotifyTabClosed = false;
    firstSeek = true;
    enableSync = true;
    firstTimePopup = false;
    manuallyStopped = false;
    checkInterval = setInterval(checkAndUpdateTrack, 5000);

    const trackUrl = msg.trackUrl || "https://open.spotify.com";

    // Open/focus Spotify tab immediately
    const tabs = await chrome.tabs.query({ url: "*://open.spotify.com/*" });
    let tab;
    if (tabs.length > 0) {
      tab = tabs[0];
      spotifyTabId = tab.id;
      chrome.tabs.update(tab.id, { active: true });

      if (!tab.url.includes(trackUrl.split("/track/")[1])) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (url) => {
            window.location.href = url;
          },
          args: [trackUrl],
        });
      }
    } else {
      tab = await chrome.tabs.create({ url: trackUrl });
      spotifyTabId = tab.id;
    }

    openedTrack = true;

    // Start async sync loop
    roomInitialized = true;
    startSyncLoop();

    if (logging) console.log("Main Sync started.");
  }

  if (msg.action === "toggleSync") {
    manuallyStopped = true;
    enableSync = !enableSync; // toggle the sync loop

    if (logging)
      console.log("Toggle- Sync " + (enableSync ? "started." : "stopped."));
  }
});

// ---------------- Async sync loop -----------------
async function startSyncLoop() {
  while (!spotifyTabClosed && roomInitialized) {
    const start = Date.now();

    await syncTrack(clientProgress);
    clientProgress += 1;

    const elapsed = Date.now() - start;
    const delay = Math.max(1000 - elapsed, 0);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function ensurePlaybackAtThreeSeconds(tabId) {
  const checkInterval = 300; // ms
  const timeoutMs = 7000; // 7 seconds
  let spotifyTabs = await chrome.tabs.query({ url: "*://open.spotify.com/*" });
  if (!spotifyTabs.length) {
    console.warn("No Spotify tab found, waiting...");
    while (!spotifyTabs.length) {
      await new Promise((r) => setTimeout(r, 500));
      spotifyTabs = await chrome.tabs.query({ url: "*://open.spotify.com/*" });
    }
  }

  const spotifyTabId = spotifyTabs[0].id;

  // Step 2: wait for playback to start
  let playbackStarted = false;
  const startTime = Date.now();
  while (!playbackStarted) {
    const progress = await getClientPlaybackProgress(spotifyTabId);
    if (progress != null) playbackStarted = true;
    if (Date.now() - startTime > 7000) {
      console.warn("Playback did not start in 7s");
      return true;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  if (logging) console.log("[ensurePlaybackAtThreeSeconds] called");

  // Promise that resolves when playback hits 3s
  const checkPromise = new Promise(async (resolve) => {
    setTimeout(() => {
      resolve(true);
      return;
    }, 10000);

    if (!globalAudioPlayingTabId || !tabId) {
      console.warn("No valid tab to run script on");
      resolve(false);
      return;
    }

    while (true) {
      if (!enableSync) return;
      const tabs = await chrome.tabs.query({
        url: "*://open.spotify.com/*",
        audible: true,
      });

      if (tabs.length > 0) {
        globalAudioPlayingTabId = tabs[0].id;
      } else if (!globalAudioPlayingTabId) {
        return; // no audible tab and no saved tab
      }

      chrome.scripting.executeScript({
        target: { tabId: globalAudioPlayingTabId },
        func: async (shouldPlay) => {
          const btn = document.querySelector(
            '[data-testid="control-button-playpause"]'
          );
          if (!btn) return;

          const isPaused = btn.getAttribute("aria-label") === "Play";
          if (shouldPlay && isPaused) {
            await new Promise((res) => setTimeout(res, 4000));
            if (btn.getAttribute("aria-label") === "Play") btn.click();
          }
        },
        args: [data.playing],
      });

      const timeStr = await getClientPlaybackProgress(
        globalAudioPlayingTabId || tabId
      );

      if (timeStr == 3) {
        if (refreshTimeout) clearTimeout(refreshTimeout);
        refreshTimeout = setTimeout(() => {
          refreshing = false;
          refreshTimeout = null;
          if (logging) console.log("[TrackCheck] Refreshing set to false");
        }, 3000);
        resolve(true);
        return;
      }

      await new Promise((r) => setTimeout(r, checkInterval));
    }
  });

  return checkPromise;
}

function timeStrToSec(str) {
  const [min, sec] = str.split(":").map(Number);
  return min * 60 + sec;
}

function secToTimeStr(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

async function getClientPlaybackProgress(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const el = document.querySelector('[data-testid="playback-position"]');
        return el ? el.textContent : null;
      },
    });

    const timeStr = results?.[0]?.result;
    if (!timeStr) return null;

    // Convert MM:SS to seconds using your existing helper
    return timeStrToSec(timeStr);
  } catch (err) {
    console.error("[getPlaybackPosition] failed:", err);
    return null;
  }
}

function seekToSeconds(tabId, progressSec, trackDurationSec, offset = 0) {
  if (!enableSync || slowConn || firstSeek || doNotSeekSlowPing || refreshing)
    return;
  if (!tabId || !progressSec || !trackDurationSec) return;
  offset = Math.min(3000, offset);
  progressSec += offset / 1000; // convert ms to seconds
  if (logging) console.log("seeking to", progressSec, "seconds");

  chrome.scripting.executeScript({
    target: { tabId },
    func: (progressSec, durationSec) => {
      const fraction = progressSec / durationSec; // convert seconds to fraction
      const pb = document.querySelector('[data-testid="progress-bar"]');
      if (!pb) return;
      const rect = pb.getBoundingClientRect();
      const x = rect.left + rect.width * fraction;
      const y = rect.top + rect.height / 2;

      pb.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: x,
          clientY: y,
          bubbles: true,
        })
      );
      pb.dispatchEvent(
        new PointerEvent("pointerup", {
          clientX: x,
          clientY: y,
          bubbles: true,
        })
      );
      pb.dispatchEvent(
        new MouseEvent("click", { clientX: x, clientY: y, bubbles: true })
      );
    },
    args: [progressSec, trackDurationSec],
  });
  firstSeek = false;
}

function startProgressSync(interval = 300) {
  if (!enableSync) return;
  async function loop() {
    if (!enableSync) return;
    if (songMismatch) return;

    const tabs = await chrome.tabs.query({
      url: "*://open.spotify.com/*",
      audible: true,
    });

    if (tabs.length > 0) {
      globalAudioPlayingTabId = tabs[0].id;
    } else if (!globalAudioPlayingTabId && !spotifyTabId) {
      return; // no audible tab and no saved tab
    }

    const tab = spotifyTabId || tabs[0] || globalAudioPlayingTabId;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id || spotifyTabId },
      func: () => {
        const durationEl = document.querySelector(
          '[data-testid="playback-duration"]'
        );
        return durationEl ? durationEl.textContent : null;
      },
    });

    const durationText = results[0]?.result ?? null;
    const durationSec = timeStrToSec(durationText);
    const serverDuarationSec = data.duration
      ? timeStrToSec(data.duration)
      : null;
    // If there’s a mismatch of more than 3 seconds, reload the tab to the correct track
    if (
      data.duration &&
      durationSec &&
      serverDuarationSec &&
      Math.abs(durationSec - serverDuarationSec) > 3
    ) {
      songMismatch = true;
      return;
    }

    try {
      if (!globalAudioPlayingTabId) {
        setTimeout(loop, interval); // schedule next run even if no tab
        return;
      }

      const serverProgressSec = timeStrToSec(data.progress);
      const clientProgressSec = await getClientPlaybackProgress(
        globalAudioPlayingTabId
      );
      const songDurationSec = timeStrToSec(data.duration);

      if (
        serverProgressSec &&
        clientProgressSec &&
        Math.abs(serverProgressSec - clientProgressSec) > 5
      ) {
        if (logging)
          console.log(
            `Sync triggered. Server: ${serverProgressSec}s, Client: ${clientProgressSec}s, difference: ${Math.abs(
              serverProgressSec - clientProgressSec
            )}s`
          );

        seekToSeconds(
          globalAudioPlayingTabId,
          serverProgressSec,
          songDurationSec
        );
      }
    } catch (err) {
      console.error("Progress sync error:", err);
    }

    // schedule next run
    setTimeout(loop, interval);
  }

  loop(); // start immediately
}

function openSpotifyWithFallback(url) {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      // Find the current playing Spotify tab (audible + open.spotify.com)
      const originalTab =
        tabs.find((t) => t.audible && t.url.includes("open.spotify.com")) ||
        tabs.find((t) => t.active) || // fallback: active tab
        tabs[0]; // fallback: first tab

      const originalTabId = originalTab?.id || null;

      chrome.tabs.create({ url, active: true }, (newTab) => {
        if (!newTab || !newTab.id) {
          console.warn("Failed to create new tab");
          resolve(null);
          return;
        }
        new Promise((resolve) => {
          const listener = (updatedTabId, changeInfo) => {
            if (
              updatedTabId === newTab.id &&
              changeInfo.status === "complete"
            ) {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
        resolve(newTab.id);
      });
    });
  });
}

// Usage:

//if serverprogress < 5 to end, call this func;
//stop processing checkandupdate with a isChangingTracks flag, for 5 seconds
//resume checkandupdate and close tabToClose
