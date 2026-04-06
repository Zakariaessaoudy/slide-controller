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
  if (e.touches.length === 1) {
    isPinching = false;
    swipeStartX = e.changedTouches[0].clientX;
    swipeStartY = e.changedTouches[0].clientY;
  } else {
    isPinching = true; // second finger down — cancel any pending swipe
  }
}, { passive: true });

document.addEventListener("touchend", (e) => {
  if (isPinching) return; // don't fire swipe if a pinch was in progress
  const dx = e.changedTouches[0].clientX - swipeStartX;
  const dy = e.changedTouches[0].clientY - swipeStartY;
  const isHorizontal = Math.abs(dx) >= SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(dy);
  if (!isHorizontal) return;
  sendAction(dx < 0 ? "next" : "prev");
}, { passive: true });

// ── Pinch-to-zoom gesture (zoom pad only) ───────────────────────────────────
// The pad has touch-action:none (CSS) + preventDefault (JS) so Chrome never
// zooms the browser page, only the remote slide.

const PINCH_THRESHOLD = 6;   // px — lower = more sensitive
const ZOOM_THROTTLE_MS = 100; // ms — faster repeat for smoother feel

let lastPinchDist = null;
let zoomThrottle = false;

const zoomPadEl = document.getElementById("zoom-pad");

function getPinchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

zoomPadEl.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) {
    lastPinchDist = getPinchDist(e.touches);
    zoomPadEl.classList.add("zoom-pad--active");
  }
  e.preventDefault(); // block browser zoom on this element
}, { passive: false });

zoomPadEl.addEventListener("touchmove", (e) => {
  e.preventDefault(); // critical — blocks Chrome's native pinch-to-zoom
  if (e.touches.length !== 2 || lastPinchDist === null || zoomThrottle) return;
  const dist = getPinchDist(e.touches);
  const delta = dist - lastPinchDist;
  if (Math.abs(delta) >= PINCH_THRESHOLD) {
    sendAction(delta > 0 ? "zoom-in" : "zoom-out");
    lastPinchDist = dist;
    zoomThrottle = true;
    setTimeout(() => { zoomThrottle = false; }, ZOOM_THROTTLE_MS);
  }
}, { passive: false });

zoomPadEl.addEventListener("touchend", (e) => {
  if (e.touches.length < 2) {
    lastPinchDist = null;
    zoomPadEl.classList.remove("zoom-pad--active");
  }
}, { passive: true });

// ── Keyboard fallback (desktop / testing) ───────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowUp")   sendAction("next");
  if (e.key === "ArrowLeft"  || e.key === "ArrowDown") sendAction("prev");
});
