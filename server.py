#!/usr/bin/env python3
"""
Wireless Slide Controller — Flask server
Serves the mobile web UI and relays button/swipe actions as arrow-key presses.
"""

import socket

import pyautogui
from flask import Flask, jsonify, render_template

# ── Configuration ─────────────────────────────────────────────────────────────

PORT = 8080
pyautogui.FAILSAFE = False

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


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def index():
    return render_template("index.html")


@app.post("/next")
def next_slide():
    pyautogui.press("right")
    return jsonify(action="next")


@app.post("/prev")
def prev_slide():
    pyautogui.press("left")
    return jsonify(action="prev")


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
