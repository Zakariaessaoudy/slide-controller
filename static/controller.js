/**
 * Slide Controller — client-side logic
 *
 * Two modes, toggled by the mode bar at the top of the page:
 *
 * ┌─ Slides mode ──────────────────────────────────────────────────────────┐
 * │  Prev / Next buttons  → tap                                            │
 * │  Swipe left / right   → next / prev (anywhere outside zoom pad)        │
 * │  Zoom pad             → 1 finger: laser pointer  /  2 fingers: zoom    │
 * │  Arrow keys           → next / prev (desktop testing)                  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Mouse mode ───────────────────────────────────────────────────────────┐
 * │  Mouse trackpad       → 1 finger: move cursor  /  2 fingers: scroll   │
 * │  Hold gesture         → hold 400 ms without moving → drag lock        │
 * │  Click buttons        → left click / right click / double click        │
 * └────────────────────────────────────────────────────────────────────────┘
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
/*
 * sendAction   — for discrete actions; shows status flash on success/failure.
 * sendDelta    — fire-and-forget for high-frequency (dx,dy) events; no flash.
 * sendPost     — fire-and-forget for bare POST (no body); no flash.
 */

const ACTION_LABELS = {
  next:           "▶ next",
  prev:           "◀ prev",
  "zoom-in":      "+ zoom in",
  "zoom-out":     "− zoom out",
  "click/left":   "click",
  "click/right":  "right click",
  "click/double": "double click",
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

async function sendDelta(endpoint, dx, dy) {
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dx, dy }),
    });
  } catch { /* silent — flicker-free for high-frequency events */ }
}

async function sendPost(endpoint) {
  try { await fetch(endpoint, { method: "POST" }); } catch { /* silent */ }
}

// ── App mode (Slides / Mouse) ─────────────────────────────────────────────────
/*
 * setAppMode toggles the hidden attribute on the two <section> elements and
 * keeps the mode-bar button highlight in sync.  All mode-specific touch
 * handlers check `appMode` or are scoped to their own DOM element.
 */

const slidesUiEl    = document.getElementById("slides-ui");
const mouseUiEl     = document.getElementById("mouse-ui");
const btnSlidesMode = document.getElementById("btn-slides-mode");
const btnMouseMode  = document.getElementById("btn-mouse-mode");
const hintEl        = document.getElementById("hint");

const HINTS = {
  slides: "Swipe left\u00a0/\u00a0right\u00a0\u00b7\u00a0Pinch the pad to zoom",
  mouse:  "1\u00a0finger move\u00a0\u00b7\u00a02\u00a0fingers scroll\u00a0\u00b7\u00a0hold to drag",
};

let appMode = "slides"; // "slides" | "mouse"

function setAppMode(mode) {
  appMode = mode;
  const isMouse = mode === "mouse";
  slidesUiEl.hidden = isMouse;
  mouseUiEl.hidden  = !isMouse;
  btnSlidesMode.classList.toggle("mode-bar__btn--active", !isMouse);
  btnMouseMode.classList.toggle("mode-bar__btn--active",   isMouse);
  hintEl.textContent = HINTS[mode];
}

btnSlidesMode.addEventListener("click", () => setAppMode("slides"));
btnMouseMode.addEventListener("click",  () => setAppMode("mouse"));

// ── Slides-mode button listeners ─────────────────────────────────────────────

document.getElementById("btn-next").addEventListener("click", () => sendAction("next"));
document.getElementById("btn-prev").addEventListener("click", () => sendAction("prev"));

// ── Slides-mode swipe detection ──────────────────────────────────────────────
/*
 * Registered on the whole document so a swipe anywhere (outside the zoom pad)
 * triggers next/prev.  Guarded by appMode so it does not fire in mouse mode.
 */

const SWIPE_MIN_DISTANCE = 40; // px — minimum horizontal travel to register

let swipeStartX = 0;
let swipeStartY = 0;
let isPinching  = false;

document.addEventListener("touchstart", (e) => {
  if (appMode !== "slides") return;
  if (e.target.closest("#zoom-pad")) return; // zoom pad has its own handlers
  if (e.touches.length === 1) {
    isPinching  = false;
    swipeStartX = e.changedTouches[0].clientX;
    swipeStartY = e.changedTouches[0].clientY;
  } else {
    isPinching = true; // second finger cancels pending swipe
  }
}, { passive: true });

document.addEventListener("touchend", (e) => {
  if (appMode !== "slides") return;
  if (e.target.closest("#zoom-pad")) return;
  if (isPinching) return;
  const dx = e.changedTouches[0].clientX - swipeStartX;
  const dy = e.changedTouches[0].clientY - swipeStartY;
  const isHorizontal = Math.abs(dx) >= SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(dy);
  if (!isHorizontal) return;
  sendAction(dx < 0 ? "next" : "prev");
}, { passive: true });

// ── Slides-mode zoom pad — pinch to zoom + 1-finger laser pointer ─────────────
/*
 * touch-action:none (CSS) + preventDefault (JS) block Chrome/Safari native
 * gestures so we own every touch event inside this element.
 *
 * 1 finger → sendDelta("/pointer", dx, dy) — moves macOS cursor
 * 2 fingers → pinch distance change → zoom-in / zoom-out action
 */

const PINCH_THRESHOLD  = 6;    // px — minimum distance change to register zoom step
const ZOOM_THROTTLE_MS = 100;  // ms between zoom steps
const MOVE_THROTTLE_MS = 30;   // ms between pointer/move events (~33 fps)

let lastPinchDist = null;
let zoomThrottle  = false;
let zpLastX       = null;  // zoom-pad last touch position
let zpLastY       = null;
let zpThrottle    = false;

const zoomPadEl = document.getElementById("zoom-pad");

function getPinchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

zoomPadEl.addEventListener("touchstart", (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (e.touches.length === 1) {
    zpLastX = e.touches[0].clientX;
    zpLastY = e.touches[0].clientY;
    zoomPadEl.classList.add("zoom-pad--pointing");
  } else if (e.touches.length === 2) {
    zpLastX = null;
    zpLastY = null;
    zoomPadEl.classList.remove("zoom-pad--pointing");
    lastPinchDist = getPinchDist(e.touches);
    zoomPadEl.classList.add("zoom-pad--active");
  }
}, { passive: false });

zoomPadEl.addEventListener("touchmove", (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (e.touches.length === 1 && zpLastX !== null && !zpThrottle) {
    const dx = e.touches[0].clientX - zpLastX;
    const dy = e.touches[0].clientY - zpLastY;
    zpLastX = e.touches[0].clientX;
    zpLastY = e.touches[0].clientY;
    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
      sendDelta("/pointer", dx, dy);
      zpThrottle = true;
      setTimeout(() => { zpThrottle = false; }, MOVE_THROTTLE_MS);
    }
  } else if (e.touches.length === 2 && lastPinchDist !== null && !zoomThrottle) {
    const dist  = getPinchDist(e.touches);
    const delta = dist - lastPinchDist;
    if (Math.abs(delta) >= PINCH_THRESHOLD) {
      sendAction(delta > 0 ? "zoom-in" : "zoom-out");
      lastPinchDist = dist;
      zoomThrottle  = true;
      setTimeout(() => { zoomThrottle = false; }, ZOOM_THROTTLE_MS);
    }
  }
}, { passive: false });

zoomPadEl.addEventListener("touchend", (e) => {
  e.stopPropagation();
  if (e.touches.length < 2) {
    lastPinchDist = null;
    zoomPadEl.classList.remove("zoom-pad--active");
  }
  if (e.touches.length < 1) {
    zpLastX = null;
    zpLastY = null;
    zoomPadEl.classList.remove("zoom-pad--pointing");
  }
}, { passive: true });

// ── Mouse-mode trackpad — move + 2-finger scroll + hold-to-drag ──────────────
/*
 * 1 finger (moving)   → sendDelta("/pointer", dx, dy)   — cursor move
 * 1 finger (held)     → after DRAG_HOLD_MS without moving: drag lock
 *                        sendPost("/mouse-down"), subsequent moves →
 *                        sendDelta("/drag", dx, dy), lift → sendPost("/mouse-up")
 * 2 fingers           → sendDelta("/scroll", cx_delta, cy_delta)
 *
 * Visual state machine:
 *   idle → --active (1-finger down) → --dragging (hold threshold reached)
 *   idle → --scrolling (2-finger down)
 */

const DRAG_HOLD_MS      = 400; // ms hold before drag lock activates
const SCROLL_THROTTLE_MS = 30; // ms between scroll events (~33 fps)

const mouseTrackpadEl = document.getElementById("mouse-trackpad");

let mtLastX        = null;  // last recorded touch position (or centroid for 2-finger)
let mtLastY        = null;
let mtMoveThrottle = false;
let mtScrollThrottle = false;
let mtDragTimer    = null;  // setTimeout handle for drag-hold
let mtDragActive   = false; // true while left button is held via hold-to-drag
let mtMoved        = false; // finger moved significantly before hold threshold?

function mtStartDrag() {
  mtDragActive = true;
  sendPost("/mouse-down");
  mouseTrackpadEl.classList.remove("mouse-trackpad--active");
  mouseTrackpadEl.classList.add("mouse-trackpad--dragging");
}

function mtStopDrag() {
  if (!mtDragActive) return;
  mtDragActive = false;
  sendPost("/mouse-up");
  mouseTrackpadEl.classList.remove("mouse-trackpad--dragging");
}

mouseTrackpadEl.addEventListener("touchstart", (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (e.touches.length === 1) {
    mtLastX = e.touches[0].clientX;
    mtLastY = e.touches[0].clientY;
    mtMoved = false;
    mouseTrackpadEl.classList.add("mouse-trackpad--active");
    // Start hold timer — fires drag lock if finger doesn't move first
    mtDragTimer = setTimeout(() => {
      if (!mtMoved) mtStartDrag();
    }, DRAG_HOLD_MS);
  } else if (e.touches.length === 2) {
    // Second finger: cancel drag setup, switch to scroll centroid tracking
    clearTimeout(mtDragTimer);
    mtStopDrag();
    mouseTrackpadEl.classList.remove("mouse-trackpad--active");
    mouseTrackpadEl.classList.add("mouse-trackpad--scrolling");
    mtLastX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    mtLastY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
  }
}, { passive: false });

mouseTrackpadEl.addEventListener("touchmove", (e) => {
  e.preventDefault();
  e.stopPropagation();

  if (e.touches.length === 1 && mtLastX !== null && !mtMoveThrottle) {
    const dx = e.touches[0].clientX - mtLastX;
    const dy = e.touches[0].clientY - mtLastY;
    mtLastX = e.touches[0].clientX;
    mtLastY = e.touches[0].clientY;

    // If the finger moved significantly before the hold timer fires, cancel drag lock
    if (!mtMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      mtMoved = true;
      if (!mtDragActive) clearTimeout(mtDragTimer);
      // (if drag already active — timer fired — keep dragging normally)
    }

    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
      sendDelta(mtDragActive ? "/drag" : "/pointer", dx, dy);
      mtMoveThrottle = true;
      setTimeout(() => { mtMoveThrottle = false; }, MOVE_THROTTLE_MS);
    }
  } else if (e.touches.length === 2 && mtLastX !== null && !mtScrollThrottle) {
    // Track centroid of the two fingers for scroll delta
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const dx = cx - mtLastX;
    const dy = cy - mtLastY;
    mtLastX = cx;
    mtLastY = cy;
    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
      sendDelta("/scroll", dx, dy);
      mtScrollThrottle = true;
      setTimeout(() => { mtScrollThrottle = false; }, SCROLL_THROTTLE_MS);
    }
  }
}, { passive: false });

mouseTrackpadEl.addEventListener("touchend", (e) => {
  e.stopPropagation();
  clearTimeout(mtDragTimer);
  if (e.touches.length === 1) {
    // Lifted one finger (was 2) — exit scroll, resume 1-finger tracking
    mouseTrackpadEl.classList.remove("mouse-trackpad--scrolling");
    mouseTrackpadEl.classList.add("mouse-trackpad--active");
    mtLastX = e.touches[0].clientX;
    mtLastY = e.touches[0].clientY;
    mtMoved = false;
  } else if (e.touches.length === 0) {
    // All fingers lifted — clean up
    mtStopDrag();
    mtLastX = null;
    mtLastY = null;
    mouseTrackpadEl.classList.remove("mouse-trackpad--active", "mouse-trackpad--scrolling");
  }
}, { passive: true });

// ── Mouse-mode click buttons ──────────────────────────────────────────────────
/*
 * Simple tap buttons that fire discrete click events at the current macOS
 * cursor position.  sendAction handles the status flash + error feedback.
 */

document.getElementById("btn-left-click").addEventListener("click",
  () => sendAction("click/left"));

document.getElementById("btn-right-click").addEventListener("click",
  () => sendAction("click/right"));

document.getElementById("btn-double-click").addEventListener("click",
  () => sendAction("click/double"));

// ── Keyboard fallback (desktop / testing) ────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (appMode !== "slides") return; // arrow keys only make sense in slides mode
  if (e.key === "ArrowRight" || e.key === "ArrowUp")   sendAction("next");
  if (e.key === "ArrowLeft"  || e.key === "ArrowDown") sendAction("prev");
});
