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

async function sendAction(action) {
  try {
    const res = await fetch(`/${action}`, { method: "POST" });
    if (res.ok) {
      showStatus(action === "next" ? "▶ next" : "◀ prev", "ok");
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

document.addEventListener("touchstart", (e) => {
  swipeStartX = e.changedTouches[0].clientX;
  swipeStartY = e.changedTouches[0].clientY;
}, { passive: true });

document.addEventListener("touchend", (e) => {
  const dx = e.changedTouches[0].clientX - swipeStartX;
  const dy = e.changedTouches[0].clientY - swipeStartY;

  const isHorizontal = Math.abs(dx) >= SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(dy);
  if (!isHorizontal) return;

  // Swipe LEFT  → next slide (natural: sweeping current slide away)
  // Swipe RIGHT → previous slide
  sendAction(dx < 0 ? "next" : "prev");
}, { passive: true });

// ── Keyboard fallback (desktop / testing) ───────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowUp")   sendAction("next");
  if (e.key === "ArrowLeft"  || e.key === "ArrowDown") sendAction("prev");
});
