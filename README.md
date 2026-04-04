# Slide Controller

Control presentation slides wirelessly from your phone's browser.

## How it works

A small Flask server runs on your laptop. Your phone connects to it over Wi-Fi and sends `POST /next` or `POST /prev` requests, which the server translates into **Right / Left arrow key** presses via `pyautogui` — advancing or rewinding any presentation app (PowerPoint, Keynote, Google Slides, PDF viewers, etc.).

## Requirements

- Python 3.8+
- macOS or Linux
- Phone and laptop on the same Wi-Fi network

> **macOS note:** `pyautogui` requires Accessibility permissions.  
> Go to **System Settings → Privacy & Security → Accessibility** and add your terminal.

## Setup

```bash
pip install -r requirements.txt
```

## Usage

```bash
python server.py
```

The terminal prints a network URL:

```
  Network: http://192.168.x.x:8080  ← open on your phone
```

Open that URL in your phone's browser — no app install needed.

## Controls

| Input | Action |
|---|---|
| Tap **Next** button | Next slide |
| Tap **Prev** button | Previous slide |
| Swipe left | Next slide |
| Swipe right | Previous slide |
| → / ↑ key *(desktop)* | Next slide |
| ← / ↓ key *(desktop)* | Previous slide |

## Project structure

```
slide-controller/
├── server.py          # Flask server — routes + key simulation
├── templates/
│   └── index.html     # Mobile web UI (markup only)
├── static/
│   ├── style.css      # Styles
│   └── controller.js  # Swipe, tap, and keyboard handling
└── requirements.txt
```
