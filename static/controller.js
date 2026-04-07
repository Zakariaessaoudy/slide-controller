/**
 * Slide Controller — client-side logic
 *
 * Input methods supported:
 *   • Tap the Prev / Next buttons
 *   • Swipe left (next) or right (prev) anywhere on the screen
 *   • Arrow keys (desktop / keyboard testing)
 */

// ── Status feedback ──────────────────────────────────────────────────────────

const statusEl = document.getElementById("status");
let statusTimer = null;

function showStatus(message, modifier) {
  clearTimeout(statusTimer);
  statusEl.textContent = message;
  statusEl.className = `status status--${modifier}`;
  statusTimer = setTimeout(() => {
    statusEl.textContent = "";
    statusEl.className = "status";
  }, 1200);
}

// ── Server communication ─────────────────────────────────────────────────────

const ACTION_LABELS = {
  next: "▶ next",
  prev: "◀ prev",
  "zoom-in": "+ zoom in",
  "zoom-out": "− zoom out",
};

async function sendAction(action) {
  try {
    const res = await fetch(`/${action}`, { method: "POST" });
    if (res.ok) {
      showStatus(ACTION_LABELS[action] ?? action, "ok");
    } else {
      showStatus(`error ${res.status}`, "err");
    }
  } catch {
    showStatus("unreachable", "err");
  }
}

// ── Button listeners ─────────────────────────────────────────────────────────

document.getElementById("btn-next").addEventListener("click", () => sendAction("next"));
document.getElementById("btn-prev").addEventListener("click", () => sendAction("prev"));

// ── Swipe gesture detection ──────────────────────────────────────────────────

const SWIPE_MIN_DISTANCE = 40; // px — minimum horizontal travel to register

let swipeStartX = 0;
let swipeStartY = 0;
let isPinching = false; // true while a 2-finger pinch is active — suppresses swipe

document.addEventListener("touchstart", (e) => {
  // Ignore any touch that starts inside the zoom pad — it has its own handlers
  if (e.target.closest("#zoom-pad")) return;
  if (e.touches.length === 1) {
    isPinching = false;
    swipeStartX = e.changedTouches[0].clientX;
    swipeStartY = e.changedTouches[0].clientY;
  } else {
    isPinching = true; // second finger down — cancel any pending swipe
  }
}, { passive: true });

document.addEventListener("touchend", (e) => {
  // Ignore any touch that ends inside the zoom pad — it has its own handlers
  if (e.target.closest("#zoom-pad")) return;
  if (isPinching) return; // don't fire swipe if a pinch was in progress
  const dx = e.changedTouches[0].clientX - swipeStartX;
  const dy = e.changedTouches[0].clientY - swipeStartY;
  const isHorizontal = Math.abs(dx) >= SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(dy);
  if (!isHorizontal) return;
  sendAction(dx < 0 ? "next" : "prev");
}, { passive: true });

// ── Zoom pad — pinch to zoom + 1-finger pan ──────────────────────────────────
// touch-action:none (CSS) + preventDefault (JS) blocks Chrome's native gestures.
// 1 finger → pan the zoomed slide (moves macOS cursor, zoom view follows)
// 2 fingers → pinch to zoom

const PINCH_THRESHOLD = 6;   // px — lower = more sensitive
const ZOOM_THROTTLE_MS = 100; // ms between zoom steps
const PAN_THROTTLE_MS  = 30;  // ms between pan events (~33 fps)

let lastPinchDist = null;
let zoomThrottle  = false;
let panLastX      = null;
let panLastY      = null;
let panThrottle   = false;

const zoomPadEl = document.getElementById("zoom-pad");

function getPinchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

async function sendPan(dx, dy) {
  // Fire-and-forget — no status flash to avoid flickering during drag
  try {
    await fetch("/pan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dx, dy }),
    });
  } catch { /* silent */ }
}

zoomPadEl.addEventListener("touchstart", (e) => {
  e.preventDefault();    // block browser zoom / scroll
  e.stopPropagation();   // prevent document swipe detector from recording this touch
  if (e.touches.length === 1) {
    // Start pan
    panLastX = e.touches[0].clientX;
    panLastY = e.touches[0].clientY;
    zoomPadEl.classList.add("zoom-pad--panning");
  } else if (e.touches.length === 2) {
    // Second finger arrived — switch to pinch, cancel pan
    panLastX = null;
    panLastY = null;
    zoomPadEl.classList.remove("zoom-pad--panning");
    lastPinchDist = getPinchDist(e.touches);
    zoomPadEl.classList.add("zoom-pad--active");
  }
}, { passive: false });

zoomPadEl.addEventListener("touchmove", (e) => {
  e.preventDefault();
  e.stopPropagation();

  if (e.touches.length === 1 && panLastX !== null && !panThrottle) {
    // Pan: compute delta from last recorded position
    const dx = e.touches[0].clientX - panLastX;
    const dy = e.touches[0].clientY - panLastY;
    panLastX = e.touches[0].clientX;
    panLastY = e.touches[0].clientY;
    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
      sendPan(dx, dy);
      panThrottle = true;
      setTimeout(() => { panThrottle = false; }, PAN_THROTTLE_MS);
    }
  } else if (e.touches.length === 2 && lastPinchDist !== null && !zoomThrottle) {
    // Pinch: compare distance to last recorded
    const dist  = getPinchDist(e.touches);
    const delta = dist - lastPinchDist;
    if (Math.abs(delta) >= PINCH_THRESHOLD) {
      sendAction(delta > 0 ? "zoom-in" : "zoom-out");
      lastPinchDist = dist;
      zoomThrottle = true;
      setTimeout(() => { zoomThrottle = false; }, ZOOM_THROTTLE_MS);
    }
  }
}, { passive: false });

zoomPadEl.addEventListener("touchend", (e) => {
  e.stopPropagation(); // prevent document swipe detector from firing on finger lift
  if (e.touches.length < 2) {
    lastPinchDist = null;
    zoomPadEl.classList.remove("zoom-pad--active");
  }
  if (e.touches.length < 1) {
    panLastX = null;
    panLastY = null;
    zoomPadEl.classList.remove("zoom-pad--panning");
  }
}, { passive: true });

// ── Keyboard fallback (desktop / testing) ───────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowUp")   sendAction("next");
  if (e.key === "ArrowLeft"  || e.key === "ArrowDown") sendAction("prev");
});
