#!/usr/bin/env python3
"""
Wireless Slide Controller — Flask server
Serves the mobile web UI and relays button/swipe actions as arrow-key presses.
"""

import socket

import Quartz
from flask import Flask, jsonify, render_template, request

# ── Configuration ─────────────────────────────────────────────────────────────

PORT = 8080
POINTER_SPEED = 5.0  # amplify phone touch pixels → screen cursor pixels

# macOS virtual key codes
_kVK_LeftArrow  = 0x7B
_kVK_RightArrow = 0x7C
_kVK_Control    = 0x3B

# ── App ───────────────────────────────────────────────────────────────────────

app = Flask(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_local_ip() -> str:
    """Return the machine's LAN IP address (macOS / Linux)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def _press_key(key_code: int) -> None:
    """Press and release a key with modifier flags explicitly zeroed.

    Using Quartz directly (instead of pyautogui) so we can call
    CGEventSetFlags(..., 0) and guarantee no modifier is inherited from
    the system state — which can be dirty after a synthetic Ctrl+scroll
    zoom event is posted.
    """
    for is_down in (True, False):
        ev = Quartz.CGEventCreateKeyboardEvent(None, key_code, is_down)
        Quartz.CGEventSetFlags(ev, 0)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)


def _move_cursor(dx: float, dy: float) -> None:
    """Move the macOS cursor by a relative (dx, dy) offset.

    Uses CGWarpMouseCursorPosition to reposition the cursor, then posts a
    kCGEventMouseMoved so applications (Keynote, Canva, etc.) receive the
    standard cursor-moved notification and update hover state / laser pointer.
    """
    current = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
    new_x = current.x + dx * POINTER_SPEED
    new_y = current.y + dy * POINTER_SPEED

    # Clamp to main display bounds
    bounds = Quartz.CGDisplayBounds(Quartz.CGMainDisplayID())
    new_x = max(bounds.origin.x, min(new_x, bounds.origin.x + bounds.size.width  - 1))
    new_y = max(bounds.origin.y, min(new_y, bounds.origin.y + bounds.size.height - 1))

    new_pos = Quartz.CGPoint(new_x, new_y)
    Quartz.CGWarpMouseCursorPosition(new_pos)

    ev = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, new_pos, 0)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)


def _scroll_zoom(direction: int) -> None:
    """Simulate Ctrl+scroll to trigger macOS system zoom.

    After posting the scroll event we immediately send a synthetic Ctrl
    key-up with flags=0 to flush the modifier state.  Without this,
    macOS keeps Ctrl "active" at the HID level and the next arrow-key
    press (from _press_key or any other source) is interpreted as
    Ctrl+Arrow — which switches Mission Control desktops instead of
    advancing a slide.

    direction: +1 = zoom in, -1 = zoom out
    """
    scroll_ev = Quartz.CGEventCreateScrollWheelEvent2(
        None, Quartz.kCGScrollEventUnitLine, 1, direction * 8, 0, 0
    )
    Quartz.CGEventSetFlags(scroll_ev, Quartz.kCGEventFlagMaskControl)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, scroll_ev)

    # Flush Ctrl modifier — key-up with zero flags resets the HID state.
    ctrl_up = Quartz.CGEventCreateKeyboardEvent(None, _kVK_Control, False)
    Quartz.CGEventSetFlags(ctrl_up, 0)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ctrl_up)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def index():
    return render_template("index.html")


@app.post("/next")
def next_slide():
    _press_key(_kVK_RightArrow)
    return jsonify(action="next")


@app.post("/prev")
def prev_slide():
    _press_key(_kVK_LeftArrow)
    return jsonify(action="prev")


@app.post("/pointer")
def pointer():
    data = request.get_json(silent=True) or {}
    _move_cursor(float(data.get("dx", 0)), float(data.get("dy", 0)))
    return jsonify(action="pointer")


@app.post("/zoom-in")
def zoom_in():
    _scroll_zoom(+1)
    return jsonify(action="zoom-in")


@app.post("/zoom-out")
def zoom_out():
    _scroll_zoom(-1)
    return jsonify(action="zoom-out")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    ip = get_local_ip()
    print()
    print("  Slide Controller")
    print("  " + "─" * 45)
    print(f"  Local:   http://127.0.0.1:{PORT}")
    print(f"  Network: http://{ip}:{PORT}  ← open on your phone")
    print()
    print("  Ctrl+C to stop.")
    print()
    app.run(host="0.0.0.0", port=PORT, debug=False)
