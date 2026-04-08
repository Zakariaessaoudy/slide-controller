#!/usr/bin/env python3
"""
Wireless Slide Controller — Flask server

Two controller modes are exposed through this server:

Slides mode
  POST /next          — right-arrow key press
  POST /prev          — left-arrow key press
  POST /zoom-in       — Ctrl+scroll up  (macOS system zoom)
  POST /zoom-out      — Ctrl+scroll down
  POST /pointer       — move cursor by relative (dx, dy)   [laser pointer]

Mouse mode
  POST /click/left    — left mouse click at current cursor
  POST /click/right   — right mouse click at current cursor
  POST /click/double  — double left-click at current cursor
  POST /mouse-down    — left button press (for drag)
  POST /mouse-up      — left button release (end drag)
  POST /scroll        — two-finger trackpad scroll by (dx, dy)
  POST /drag          — drag-move cursor by (dx, dy) while button held
"""

import socket

import Quartz
from flask import Flask, jsonify, render_template, request

# ── Configuration ─────────────────────────────────────────────────────────────

PORT = 8080
POINTER_SPEED = 11   # amplify phone touch pixels → screen cursor pixels
SCROLL_SPEED  = 3.0  # amplify phone touch pixels → scroll pixels (mouse mode)

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


# ── Mouse-mode helpers ────────────────────────────────────────────────────────

def _click(button: int = 0) -> None:
    """Simulate a mouse-button click (down + up) at the current cursor position.

    button: 0 = left, 1 = right
    """
    pos = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
    consts = [
        (Quartz.kCGEventLeftMouseDown,  Quartz.kCGEventLeftMouseUp,  Quartz.kCGMouseButtonLeft),
        (Quartz.kCGEventRightMouseDown, Quartz.kCGEventRightMouseUp, Quartz.kCGMouseButtonRight),
    ]
    down_t, up_t, btn = consts[button]
    Quartz.CGEventPost(Quartz.kCGHIDEventTap,
        Quartz.CGEventCreateMouseEvent(None, down_t, pos, btn))
    Quartz.CGEventPost(Quartz.kCGHIDEventTap,
        Quartz.CGEventCreateMouseEvent(None, up_t,   pos, btn))


def _double_click() -> None:
    """Simulate a double left-click at the current cursor position.

    Posts two down/up pairs with incrementing clickState so the OS registers
    the second pair as a proper double-click (e.g. selects a word in text).
    """
    pos = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
    for n in (1, 2):
        for ev_type in (Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp):
            ev = Quartz.CGEventCreateMouseEvent(None, ev_type, pos, Quartz.kCGMouseButtonLeft)
            Quartz.CGEventSetIntegerValueField(ev, Quartz.kCGMouseEventClickState, n)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)


def _scroll(dx: float, dy: float) -> None:
    """Two-finger trackpad scroll using natural-scrolling convention.

    finger UP   → dy < 0 → content moves up
    finger DOWN → dy > 0 → content moves down
    (same direction mapping as a physical Apple trackpad with natural scroll on)
    """
    ev = Quartz.CGEventCreateScrollWheelEvent2(
        None, Quartz.kCGScrollEventUnitPixel, 2,
        int(-dy * SCROLL_SPEED),   # wheel1: vertical
        int(-dx * SCROLL_SPEED),   # wheel2: horizontal
        0,
    )
    Quartz.CGEventSetFlags(ev, 0)  # no modifiers — plain scroll
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)


def _mouse_button(button: int, down: bool) -> None:
    """Press or release a mouse button at the current cursor position.

    Used to bracket a drag gesture: call with down=True before sending drag
    deltas, then call with down=False when the finger lifts.
    """
    pos = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
    consts = [
        (Quartz.kCGEventLeftMouseDown,  Quartz.kCGEventLeftMouseUp,  Quartz.kCGMouseButtonLeft),
        (Quartz.kCGEventRightMouseDown, Quartz.kCGEventRightMouseUp, Quartz.kCGMouseButtonRight),
    ]
    ev_type = consts[button][0 if down else 1]
    Quartz.CGEventPost(Quartz.kCGHIDEventTap,
        Quartz.CGEventCreateMouseEvent(None, ev_type, pos, consts[button][2]))


def _drag_move(dx: float, dy: float) -> None:
    """Move the cursor by (dx, dy) while the left button is held.

    Posts kCGEventLeftMouseDragged so applications receive the correct event
    type for a drag operation (e.g. window moving, text selection, slider drag).
    """
    current = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
    new_x = current.x + dx * POINTER_SPEED
    new_y = current.y + dy * POINTER_SPEED
    bounds = Quartz.CGDisplayBounds(Quartz.CGMainDisplayID())
    new_x = max(bounds.origin.x, min(new_x, bounds.origin.x + bounds.size.width  - 1))
    new_y = max(bounds.origin.y, min(new_y, bounds.origin.y + bounds.size.height - 1))
    new_pos = Quartz.CGPoint(new_x, new_y)
    Quartz.CGWarpMouseCursorPosition(new_pos)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap,
        Quartz.CGEventCreateMouseEvent(
            None, Quartz.kCGEventLeftMouseDragged, new_pos, Quartz.kCGMouseButtonLeft))


# ── Slides-mode zoom helper ───────────────────────────────────────────────────

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


# ── Mouse-mode routes ─────────────────────────────────────────────────────────

@app.post("/click/left")
def click_left():
    _click(0)
    return jsonify(action="click-left")


@app.post("/click/right")
def click_right():
    _click(1)
    return jsonify(action="click-right")


@app.post("/click/double")
def click_double():
    _double_click()
    return jsonify(action="click-double")


@app.post("/mouse-down")
def mouse_down():
    _mouse_button(0, True)
    return jsonify(action="mouse-down")


@app.post("/mouse-up")
def mouse_up():
    _mouse_button(0, False)
    return jsonify(action="mouse-up")


@app.post("/scroll")
def scroll():
    data = request.get_json(silent=True) or {}
    _scroll(float(data.get("dx", 0)), float(data.get("dy", 0)))
    return jsonify(action="scroll")


@app.post("/drag")
def drag():
    data = request.get_json(silent=True) or {}
    _drag_move(float(data.get("dx", 0)), float(data.get("dy", 0)))
    return jsonify(action="drag")


# ── Slides-mode zoom routes ───────────────────────────────────────────────────

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
