# Smart Staircase — Digital Twin

A real-time 3D digital twin, built with Three.js, of a physical step-triggered LED and audio staircase. The web application mirrors the state of a physical rig — an Arduino Uno driving LDR beam sensors, WS2812B LED strips, and a speech synthesizer, bridged by an ESP32 that also drives a servo-actuated door — and supports full two-way control: actions performed in the browser can move the real hardware, and the real hardware's state is reflected live in the 3D scene.

The project runs in three modes with no code changes required between them:

- **Simulation only** — no hardware connected, fully interactive in the browser.
- **Local network** — the browser and the physical rig communicate directly over WiFi.
- **Internet-wide** — the rig and any number of browsers communicate through a cloud relay, from anywhere.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Repository Structure](#repository-structure)
- [Technology Stack](#technology-stack)
- [Hardware](#hardware)
- [How the Physical Rig Decides What to Show](#how-the-physical-rig-decides-what-to-show)
- [Getting Started](#getting-started)
  - [1. Run the Digital Twin Locally](#1-run-the-smart-staircase-locally)
  - [2. Flash the Microcontrollers](#2-flash-the-microcontrollers)
- [Two-Way Communication Protocol](#two-way-communication-protocol)
- [Frontend Application Details](#frontend-application-details)
- [Cloud Deployment](#cloud-deployment)
  - [Architecture Rationale](#architecture-rationale)
  - [Step-by-Step Deployment](#step-by-step-deployment)
  - [Single-Service Alternative](#single-service-alternative)
  - [Event History API](#event-history-api)
- [Progressive Web App](#progressive-web-app)
- [Visual Design](#visual-design)
- [Customization](#customization)
- [Configuration Reference](#configuration-reference)
- [Troubleshooting](#troubleshooting)
- [Roadmap Ideas](#roadmap-ideas)
- [License](#license)

---

## Overview

The Smart Staircase is a physical staircase installation instrumented with laser/LDR beam-break sensors, addressable LED strips, a speaker, and a servo-actuated door. Each of the three steps, when triggered, lights an LED strip in a distinct color, plays either a spoken number or a short musical phrase, and — on the final step — opens a door.

This repository contains the **digital twin** of that installation: a browser-based 3D reconstruction of the staircase that can run entirely standalone as an interactive demo, or connect live to the physical rig so that the virtual and real staircases stay synchronized in both directions.

The project intentionally supports a spectrum of operating conditions, from a laptop with no internet connection at all, to a fully hosted, internet-accessible deployment reachable from any device, anywhere.

---

## Key Features

**3D Simulation**
- A full Three.js scene of the staircase: risers, treads, closed side-stringer panels, LED strips, laser beams, LDR receiver/transmitter modules, a speaker, and a door with a servo-driven hinge — all built procedurally from primitive geometry, with no external 3D model files.
- Click any step to simulate a footstep, play a full three-step sequence, or trigger a random footstep.
- Toggle between spoken step numbers and a short three-note musical phrase per step, matching the physical Talkie voice module and the LED strip layout.
- A small chibi character model — styled as a laser "beam blocker" — sits wherever a beam is currently broken, so the beam visually appears to be physically obstructed rather than disappearing with no apparent cause. It rests at the entrance landing when no beam is broken, gliding smoothly between positions with a subtle idle bob animation.
- A free-orbit camera (drag to rotate, scroll to zoom) implemented without any external controls library.
- An idle "welcome" ambient glow at the landing that dims automatically whenever any step is active, mirroring the physical rig's idle LED strip.

**Two-Way Physical Link**
- WebSocket connection to the physical rig, either directly over the local network or through a cloud relay, using the same client code path for both.
- Telemetry flows from the rig to the browser — sensor states, LED strip states, speaker state, door position, and door control mode — and is reflected in the 3D scene in real time, overriding the click-to-simulate demo whenever a live connection is active.
- Commands flow from the browser to the rig: open the door, close the door, hand door control back to the beam sensor, or simulate any of the three beam-breaks directly on the physical hardware.
- Automatic reconnection with a fixed retry interval if the link drops.
- Graceful backward compatibility: if the connected rig is running older firmware that does not report door state, the frontend falls back to inferring the door's position from the step-3 sensor alone.

**Multiple Deployment Modes**
- **Offline / LAN** — a zero-dependency Python static file server for use with no internet access at all, or for local testing on a shared WiFi network.
- **Hosted** — Firebase Hosting for the static frontend, a Node.js relay on Render for the cloud bridge to the ESP32, and an optional Neon Postgres database for event history — enabling access from any device, on any network, without port forwarding on the home router.

**Progressive Web App**
- Installable on Android and iOS via a web app manifest, custom icons, and a service worker that caches the entire application shell for offline use after the first load.

**Event Logging**
- Every sensor and actuator state change is logged in a live, timestamped, color-coded event panel in the browser, labeling each field as a sensor or an actuator.
- Optionally, every telemetry frame received by the cloud relay can be persisted to Postgres and exported as CSV for external analysis.

---

## System Architecture

The project has three physical/logical tiers: the microcontrollers on the staircase itself, an optional cloud relay, and the browser-based digital twin.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Physical Staircase Rig                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Arduino Uno                                                                 │
│   • 3× LDR beam sensors                                                      │
│   • 4× WS2812B LED strips                                                    │
│   • Talkie speech synthesizer + speaker                                      │
│                                                                              │
│              UART (Full-Duplex Serial)                                       │
│                        │                                                     │
│                        ▼                                                     │
│  ESP32 Bridge                                                                │
│   • Reads telemetry from Arduino                                             │
│   • Controls SG90 door servo                                                 │
│   • Broadcasts state                                                         │
│   • Accepts remote commands                                                  │
│                                                                              │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │
                ┌───────────────┴────────────────┐
                │                                │
                │                                │
          LAN Mode                          Cloud Mode
                │                                │
                │                                │
      ws://<esp32-ip>/ws                 wss://relay-server
                │                                │
                ▼                                ▼
      ┌───────────────────┐         ┌─────────────────────────────────────┐
      │ Browser           │         │ Cloud Relay (Render)                │
      │ Digital Twin App  │         ├─────────────────────────────────────┤
      │ (Local Network)   │         │ Node.js + Express + WebSocket (ws)  │
      └───────────────────┘         │                                     │
                                    │ /esp32  ← Device uplink             │
                                    │ /ws      ← Browser clients          │
                                    │                                     │
                                    │ Optional:                           │
                                    │ Neon PostgreSQL                     │
                                    │ • Event history                     │
                                    │ • Logs                              │
                                    └─────────────────┬───────────────────┘
                                                      │
                                                      │  wss://
                                                      ▼
                                    ┌─────────────────────────────────────┐
                                    │ Browser                             │
                                    │ Digital Twin App                    │
                                    │ Firebase Hosting                    │
                                    │ (Accessible from Anywhere)          │
                                    └─────────────────────────────────────┘
```

Data flows in both directions across every hop: sensor and actuator telemetry moves from the Uno up through the ESP32 and, optionally, the relay, to any connected browser, while door and simulation commands issued in a browser travel back down the same path to move the real servo or trigger the Uno's simulated beam-break handling.

---

## Repository Structure

```
smart-staircase/
│
├── index.html                     # Main application entry point
├── manifest.json                  # Progressive Web App (PWA) manifest
├── sw.js                          # Service Worker for offline caching
├── firebase.json                  # Firebase Hosting configuration
├── .firebaserc                    # Firebase project alias
├── serve_offline.py               # Local static server for offline testing
├── three.min.js                   # Three.js library (r128)
├── 404.html                       # Firebase fallback page
│
├── css/
│   └── style.css                  # Application styles and theme variables
│
├── js/
│   ├── config.js                  # Shared constants and physical dimensions
│   ├── scene.js                   # Scene, camera, renderer, lighting, controls
│   ├── materials.js               # Shared Three.js materials
│   ├── labels.js                  # Canvas-based floating labels
│   ├── staircase.js               # Staircase, LEDs, sensors, speaker geometry
│   ├── door.js                    # Door model and servo animation
│   ├── spiderman.js               # Beam-blocking character model
│   ├── audio.js                   # Tone generation and speech synthesis
│   ├── ui-log.js                  # Live telemetry/event log
│   ├── network.js                 # WebSocket communication layer
│   ├── ui.js                      # UI controls and PWA install handling
│   └── main.js                    # Application initialization and render loop
│
├── assets/
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
│
├── microcontroller/
│   ├── arduino/
│   │   └── arduino_code.ino       # Arduino Uno firmware
│   │                               # LDR sensors
│   │                               # WS2812B LEDs
│   │                               # Talkie speech synthesizer
│   │
│   ├── esp32_lan/
│   │   └── esp32_bridge_lan.ino    # ESP32 firmware (LAN mode)
│   │                               # Local WebSocket server
│   │                               # Servo control
│   │                               # Arduino serial bridge
│   │
│   └── esp32_cloud/
│       └── esp32_bridge_cloud.ino  # ESP32 firmware (Cloud mode)
│                                   # Secure WebSocket client
│                                   # Remote relay connection
│                                   # Arduino serial bridge
│
└── server/
    ├── server.js                  # Express + WebSocket relay server
    ├── db.js                      # Neon PostgreSQL logging utilities
    ├── package.json               # Node.js dependencies
    ├── .env.example               # Environment variable template
    └── README.md                  # Server setup instructions
```

---

## Technology Stack

**Frontend**
- Vanilla JavaScript using native ES modules — no build step, bundler, or framework required.
- [Three.js](https://threejs.org/) (r128) for 3D rendering, vendored locally as `three.min.js`.
- Native WebSocket API for the real-time link to the physical rig.
- Web Audio API (oscillator-based tone synthesis) and the Speech Synthesis API for spoken announcements.
- Canvas 2D API for procedurally generated textures (character model face/emblem, floating labels).
- Web App Manifest and Service Worker API for Progressive Web App support.

**Backend / Relay**
- [Node.js](https://nodejs.org/) (version 18 or later).
- [Express](https://expressjs.com/) for HTTP routing and status/history endpoints.
- [ws](https://github.com/websockets/ws) for WebSocket server functionality.
- [pg](https://node-postgres.com/) for PostgreSQL connectivity.
- [dotenv](https://github.com/motdotla/dotenv) for environment variable management.

**Firmware**
- Arduino Uno sketch using [FastLED](https://fastled.io/) for addressable LED control and [Talkie](https://github.com/going-digital/Talkie) with the US TI99 vocabulary for retro speech synthesis.
- ESP32 LAN firmware using `WiFi.h`, `AsyncTCP`, `ESPAsyncWebServer`, `ArduinoJson`, and `ESP32Servo`.
- ESP32 cloud firmware using `WiFi.h`, the `WebSocketsClient` library (WebSockets by Markus Sattler / Links2004), `ArduinoJson`, and `ESP32Servo`.

**Hosting / Infrastructure**
- [Firebase Hosting](https://firebase.google.com/products/hosting) for the static frontend.
- [Render](https://render.com/) for the always-on Node.js cloud relay.
- [Neon](https://neon.tech/) for optional serverless PostgreSQL event history.

---

## Hardware

The physical rig consists of a three-step staircase, each step instrumented identically:

| Component | Role | Location |
|---|---|---|
| Laser transmitter | Emits a beam across the tread | Right side of each step |
| LDR receiver module | Detects when the beam is broken | Left side of each step |
| WS2812B LED strip | Lights up per riser when its step is triggered | One per riser, plus a dedicated vertical strip on the door wall |
| Speaker | Plays spoken numbers or musical tones via Talkie | Left wall, beside step 2 |
| SG90 micro servo | Drives the door open and closed | Side jamb of the doorway at step 3 |
| Door | Physical barrier that opens on the final step | Top of step 3 |

Signal flow on the rig itself:

- The **Arduino Uno** reads all three LDR sensors on digital pins 2, 4, and 8, drives four WS2812B strips on pins 5, 6, 7, and 9 via FastLED, and produces spoken output via the Talkie library. It sends a compact JSON telemetry line over serial to the ESP32 on a fixed cadence.
- The **ESP32** reads that serial line on a dedicated hardware UART (RX on GPIO16, TX on GPIO17), forwards it as JSON over WebSocket, and separately owns the SG90 door servo on GPIO18, driving it either automatically off the step-3 sensor or manually off commands received from a browser.
- The Uno and ESP32 communicate over a full-duplex UART connection, which also carries commands in the opposite direction — browser-triggered simulated beam-breaks — with no additional wiring required beyond the existing serial link.

---

## How the Physical Rig Decides What to Show

The Uno's logic is deliberately simple and priority-based, which the digital twin's live-data rendering mirrors exactly:

1. If step 3's beam (LDR3) is broken, the white strip (Strip 9) lights, regardless of the state of the other two sensors.
2. Otherwise, if step 2's beam (LDR2) is broken, the red strip (Strip 5) lights.
3. Otherwise, if step 1's beam (LDR1) is broken, the blue strip (Strip 7) lights.
4. If no beam is broken, the idle/ambient green strip (Strip 6) lights instead.

Only one of the four strips is ever active at a time on the physical rig. The speaker is considered active whenever any of the three beams is broken. A spoken number ("one", "two", or "three") is triggered once, on the rising edge of its corresponding sensor, whether that edge comes from an actual beam break or from a simulated one sent down from the digital twin. Step 3 additionally drives the door: breaking its beam opens the servo automatically (unless the door has been placed in manual mode from the browser), and the door begins closing after a fixed hold period once the beam clears.

---

## Getting Started

### 1. Run the Digital Twin Locally

From the `smart-staircase/` directory:

```bash
python3 serve_offline.py
```

Open the printed `http://localhost:8000` address in a browser. Click a step, toggle between the "Numbers" and "Musical stairs" announce modes, and confirm the beam-blocker character sits at the landing until a beam is tripped.

This same script doubles as the **offline mode**: run it on any machine with no internet connection at all, and any device on the same WiFi network can reach it at `http://<host-machine-LAN-IP>:8000`, including the ESP32's own network. The only external dependency is the one-time load of Three.js from a CDN on first run; see the comment at the top of `serve_offline.py` for instructions on vendoring that file locally for a fully offline demo, or simply allow the service worker to cache it once while internet is available.

### 2. Flash the Microcontrollers

**Arduino Uno**
- Flash `microcontroller/arduino_code/arduino_code.ino` as-is. This sketch requires the `FastLED`, `Talkie`, and `Vocab_US_TI99` libraries, available through the Arduino Library Manager.

**ESP32 — choose one variant depending on deployment mode:**

- **LAN-only** (rig and browser share the same WiFi network): flash `microcontroller/esp32_bridge_lan/esp32_bridge_lan.ino`. Update the `ssid` and `password` constants near the top of the file to match your network. In the application's "Physical Rig Link" panel, enter the ESP32's IP address and select Connect.
- **Internet-wide access** (see [Cloud Deployment](#cloud-deployment)): flash `microcontroller/esp32_bridge_cloud/esp32_bridge_cloud.ino` instead. Before flashing, update the following values in the sketch:
  ```cpp
  const char* RELAY_HOST = "your-relay-name.onrender.com"; // your Render URL
  const char* RELAY_AUTH_TOKEN = "CHANGE_ME_SHARED_SECRET"; // must match server/.env RELAY_TOKEN
  ```
  This variant additionally requires the **WebSockets** library by Markus Sattler (search "WebSockets" in the Arduino Library Manager and install the entry by Links2004).

Both ESP32 variants require the `ArduinoJson` and `ESP32Servo` libraries; the LAN variant additionally requires `AsyncTCP` and `ESPAsyncWebServer`.

> Note: the WiFi credentials and the cloud relay hostname/token are hardcoded directly in the `.ino` files rather than pulled from a config file. Update them in the source before flashing, and avoid committing real credentials to a public repository.

---

## Two-Way Communication Protocol

Telemetry and commands share a single JSON-over-WebSocket connection between the browser and the rig, whether directly on the LAN or via the cloud relay.

```
Browser  --{"cmd":"door_open"}-->         ESP32  moves the real SG90 servo directly
Browser  --{"cmd":"sim","step":1}-->      ESP32 --serial--> Uno  lights the real strip and speaker
Browser  <--{...sensors, door, doorMode}--  ESP32
```

**Door commands** (browser to rig)
- `{"cmd":"door_open"}` and `{"cmd":"door_close"}` place the door in **manual** mode, in which the beam sensor is ignored until control is handed back.
- `{"cmd":"door_auto"}` returns control of the door to the step-3 beam sensor, immediately re-evaluating the door's target position against the last known sensor reading rather than waiting for the next sensor change.

**Simulation commands** (browser to rig)
- `{"cmd":"sim","step":1|2|3}` is sent whenever a step is clicked or a laser is broken in the 3D twin, including during the automated sequence and random-footstep demos.
- The ESP32 forwards this as a short serial line (`SIM1`, `SIM2`, or `SIM3`) to the Uno, which treats it exactly as it would treat a real beam-break for approximately 600 milliseconds — same LED strip color, same spoken output, same priority logic as an actual footstep.
- No separate door command is required for step 3: because the Uno's next telemetry line reports LDR3 as tripped, the ESP32's existing automatic door logic opens the servo the same way it would for a real footstep. If the door had been left in manual mode by an earlier command, a step-3 simulation command automatically hands control back to automatic mode so the door can still open.

**Telemetry** (rig to browser)
- The core sensor/actuator frame — `ldr1`, `ldr2`, `ldr3`, `strip5`, `strip6`, `strip7`, `strip9`, `speaker` — additionally carries `door` (one of `closed`, `opening`, `open`, `closing`, tracking the real servo sweep) and `doorMode` (`auto` or `manual`).
- This frame is broadcast both immediately after a new line arrives from the Uno, and on a fixed 150 millisecond timer, so that a door movement triggered purely by a browser command — with no accompanying sensor line — is still reported back to all clients promptly.
- The servo sweep itself is driven by a non-blocking state machine on the ESP32 (`closed` → `opening` → `open` (holding) → `closing` → `closed`), advancing at most one step every few milliseconds, so that reading the Uno's serial line and broadcasting over WebSocket are never blocked by a servo movement in progress.

**Compatibility and reliability**
- If a connected rig's telemetry does not include a `door` field (older firmware), the frontend falls back automatically to inferring open/closed state purely from `ldr3`.
- All three boards must be running the versions of firmware described above for two-way commands to move real hardware; sending a command to hardware running older firmware is silently ignored.
- The browser client automatically attempts to reconnect after a fixed delay on disconnection, and door control buttons in the UI are disabled whenever there is no active connection.

---

## Frontend Application Details

**Scene and camera**
- The scene uses a dark, fog-tinted background with a key directional light casting shadows, a secondary rim light, ambient fill light, and a faint grid floor for spatial reference.
- Camera orbit is implemented from scratch (no external controls library): drag to rotate around the staircase, scroll or pinch to zoom, with rotation clamped to a comfortable viewing range.

**Staircase construction**
- Riser height, tread depth, tread thickness, step width, and step count are all defined in `js/config.js` in centimeters, mirroring the physical build's actual dimensions.
- The final riser — the one behind which the door sits — is deliberately built at half the height of the other risers, with the tread, door, and servo geometry offset automatically to sit correctly on top of it.
- Each step gets a matching LDR receiver / laser transmitter pair (receiver on the left, transmitter on the right), a laser beam mesh that disappears when broken, an LED strip along the riser's top edge, and a floating "beam broken" label that appears only while that step is active.
- Closed side-stringer panels are generated once from a 2D profile that traces the exact step geometry, then extruded and mirrored to close both sides of the staircase.

**Interaction**
- Clicking or tapping directly on a tread raycasts against the scene and triggers that step exactly as a real footstep would, including sending the corresponding simulation command to a connected rig.
- A "Play full sequence" button triggers all three steps in order with a short delay between each; a "Random footstep" button triggers one step at random.
- When a live rig connection is active, the click-to-simulate demo still runs its local animation, but announcement (spoken word or musical phrase) is deferred to the telemetry echo coming back from the rig, to avoid double-announcing the same step.

**Door and beam-blocker animation**
- The door's open/close animation timing (900 milliseconds) is deliberately matched to the real SG90 servo's actual sweep duration on the physical rig, so the virtual and physical doors move in sync.
- The beam-blocker character model is built entirely from primitive Three.js geometry (spheres, cylinders, and hand-rolled capsule shapes, since the Three.js version in use predates built-in capsule geometry) plus two small canvas-generated textures, requiring no external 3D assets. It smoothly glides to whichever step's beam is currently broken and returns to the entrance landing when idle.

---

## Cloud Deployment

### Architecture Rationale

The frontend is a static site, for which Firebase Hosting is well suited and free of charge. The ESP32, however, sits behind a home router; nothing on the public internet can reach it directly without port forwarding, which is undesirable for most setups. The solution is a small, always-on relay that the ESP32 dials **out** to — outbound connections traverse NAT without any router configuration — which then re-broadcasts telemetry to any connected browser and forwards commands back down. Render is used for that always-on Node.js process, and Neon provides optional free serverless Postgres for persisting an event history (which beam was tripped, when the door opened, and so on) rather than only exposing live data.

```
ESP32 (dials out) --wss--> Render (relay) --wss--> Browser(s) on Firebase Hosting
                                 │
                                 └──> Neon Postgres (event history, optional)
```

### Step-by-Step Deployment

**A. Neon (Postgres) — optional, only required for event history**
1. Create a project at [neon.tech](https://neon.tech).
2. Copy the connection string provided (begins with `postgres://`).
3. Retain it for step B.

**B. Render (the relay)**
1. Push the `smart-staircase/` folder to a GitHub repository.
2. In the Render dashboard, select New → Web Service and connect the repository.
3. Set the **Root Directory** to `server`.
4. Set the build command to `npm install` and the start command to `npm start`.
5. Add the following environment variables:
   - `RELAY_TOKEN` — a long random string used as a shared secret; this same value must also be set as `RELAY_AUTH_TOKEN` in `esp32_bridge_cloud.ino`.
   - `DATABASE_URL` — the Neon connection string from step A. Leave unset to run the relay without history logging.
6. Deploy. Render provides a URL such as `https://your-relay-name.onrender.com`. Enter the hostname portion (without `https://`) as `RELAY_HOST` in `esp32_bridge_cloud.ino` and reflash the ESP32.
7. Verify the deployment by opening `https://your-relay-name.onrender.com` in a browser; it should return a plain-text status line indicating whether history logging is enabled.

**C. Firebase (the frontend)**
1. Install the Firebase CLI once: `npm install -g firebase-tools`.
2. Authenticate: `firebase login`.
3. In `smart-staircase/.firebaserc`, replace the placeholder project ID with an actual Firebase project ID (create one at no cost at the [Firebase console](https://console.firebase.google.com) if needed).
4. From `smart-staircase/`, deploy:
   ```bash
   firebase deploy --only hosting
   ```
5. Firebase prints a live URL, such as `https://your-project.web.app`.
6. In the application's "Physical Rig Link" field, instead of a LAN IP address, enter the Render relay's browser endpoint (for example, `wss://your-relay-name.onrender.com/ws`) and select Connect. Live rig data will then flow from anywhere with an internet connection.

**D. Optional — reviewing logged history**
- `GET /api/history` on the relay returns the most recent events as JSON, sourced from Neon.
- `GET /api/history.csv` downloads every logged event as a CSV file with columns `id, received_at, ldr1, ldr2, ldr3, strip5, strip6, strip7, strip9, speaker`, suitable for spreadsheet applications or further analysis in tools such as pandas. This requires `DATABASE_URL` to be set; without it, the endpoint returns only the header row.

### Single-Service Alternative

For a deployment with fewer moving parts, Render can serve both the static frontend and the relay from the same Node.js process, by adding static file serving to `server.js` and pointing Render's root directory at the repository root instead of `server/`. This reduces the deployment to Render plus Neon only — one service, one URL — at the cost of Render's free tier spinning down after inactivity, which introduces a cold-start delay of roughly 30 seconds on the first request after idle. The two-service split described above avoids this by keeping the static frontend on Firebase Hosting, which has no equivalent cold start. Either approach is valid; the choice is a trade-off between operational simplicity and consistently instant availability.

### Event History API

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Plain-text relay status, including whether history logging is enabled |
| `/api/history` | GET | Returns the most recent events as JSON; accepts an optional `?limit=` query parameter (default 100, maximum 500) |
| `/api/history.csv` | GET | Downloads the complete event history as a CSV file |
| `/esp32` | WebSocket | Device uplink; requires an initial `hello` message containing the shared `RELAY_TOKEN` |
| `/ws` | WebSocket | Browser client endpoint; receives telemetry and accepts command messages |

The relay stores events in a single `staircase_events` table (id, received timestamp, and the raw JSON payload), created automatically on first run if `DATABASE_URL` is configured.

---

## Progressive Web App

Once the application is hosted — whether via Firebase, Render, or `serve_offline.py` on a local network — it can be installed as a standalone app:

- **Android / Chrome**: an in-app "Install app" prompt appears automatically, or it can be triggered manually from the browser menu via "Install app" or "Add to Home screen".
- **iOS / Safari**: Safari does not surface an automatic install prompt; use the Share menu and select "Add to Home Screen" to install it as a standalone app using the same manifest.

The service worker caches the entire application shell (markup, styles, all JavaScript modules, icons, and the vendored Three.js library) on install, serving cached content first and updating the cache in the background on subsequent loads, so the app continues to function without a network connection once installed. The WebSocket link to the physical rig is never intercepted by the service worker, since it is not a `fetch()`-based request.

Service workers require either HTTPS (provided automatically by both Firebase Hosting and Render) or `localhost`. Accessing the app over plain `http://<LAN-IP>` via `serve_offline.py` will function fully for the 3D application itself, but the offline-caching portion of the PWA will not be available under that configuration.

---

## Visual Design

The interface uses a dark, technical aesthetic intended to evoke a blueprint or schematic view of the installation:

- A near-black background (`#0a0d13`) with panel surfaces in a slightly lighter tone, subtle borders, and backdrop blur, giving the heads-up-display panels a frosted-glass appearance.
- A teal accent color (`#21e6c1`) used for primary actions, the idle ambient glow, and monospaced section labels, echoing the color of the physical rig's own idle indicator strip.
- Per-step LED colors matched exactly to the physical build: blue for step 1, red for step 2, and white for step 3.
- A monospace typeface for technical labels and log entries, and a system sans-serif typeface for body text and headings.
- All on-screen panels (title, controls, physical rig link, door controls, component legend, and the event log) are positioned as fixed overlays around the edges of the viewport, leaving the 3D scene itself unobstructed.

---

## Customization

**Beam-blocker character model**
- Appearance and pose are defined entirely in `js/spiderman.js`, built from primitive Three.js geometries and two small canvas-generated textures, with no external model files required. Colors, proportions, and pose angles can be adjusted directly in this file.
- Placement logic lives in the `updateSpiderman()` function in the same file. It selects the lowest-indexed step whose beam is currently broken — functioning identically for both the click-to-simulate demo and the live rig feed — and moves the model to that beam's exact position, or returns it to the entrance landing when no beam is broken.

**Staircase dimensions**
- All physical dimensions are centralized in `js/config.js`, expressed in centimeters to mirror the physical build: step width, tread depth and thickness, riser height, and the number of steps. The final riser is deliberately configured at half the standard riser height, with the tread, door, and servo geometry automatically offset to sit correctly on top of it.

**Announce mode**
- The choice between spoken step numbers and a short musical phrase per step is implemented in `js/audio.js` and exposed as a segmented control in the "Simulate" panel of the UI.

**Theme and layout**
- All colors, spacing, and panel positioning are defined as CSS custom properties and rules in `css/style.css`, making the color scheme and HUD layout straightforward to restyle without touching any JavaScript.

---

## Configuration Reference

| File | Purpose |
|---|---|
| `js/config.js` | Staircase dimensions, step count, note frequencies, accent color |
| `.firebaserc` | Firebase project ID used for hosting deployment |
| `firebase.json` | Firebase Hosting configuration (public directory, ignored files) |
| `server/.env` | Relay environment variables: `RELAY_TOKEN`, `DATABASE_URL`, `PORT` |
| `microcontroller/esp32_bridge_lan/esp32_bridge_lan.ino` | WiFi `ssid` / `password` for LAN mode |
| `microcontroller/esp32_bridge_cloud/esp32_bridge_cloud.ino` | WiFi credentials, `RELAY_HOST`, and `RELAY_AUTH_TOKEN` for cloud mode |
| `manifest.json` | PWA metadata: name, icons, theme colors, display mode |

---

## Troubleshooting

**The "Physical Rig Link" panel will not connect**
- Confirm the ESP32 is powered, connected to WiFi, and running firmware matching the intended mode (LAN or cloud).
- For LAN mode, confirm the browser and the ESP32 are on the same network and that the entered IP address is current (DHCP-assigned addresses can change).
- For cloud mode, confirm the WebSocket URL begins with `wss://` and points at the relay's `/ws` path, and that the relay is deployed and running.

**Door or LED commands from the browser have no visible effect**
- Verify both the Uno and the relevant ESP32 sketch have been reflashed with the versions described in this document; hardware running older firmware silently ignores browser-originated commands.

**Cloud relay shows no history**
- Confirm `DATABASE_URL` is set in the Render environment variables and that the Neon project is active; the relay operates normally without it, simply without persistence.

**Service worker or install prompt not appearing**
- Confirm the app is being served over HTTPS or `localhost`; plain HTTP over a LAN IP address will not register a service worker.

---

## Roadmap Ideas

- Authentication for the "Physical Rig Link" panel to prevent unauthorized command access on public deployments.
- A dashboard view over the Neon-backed event history, built directly into the frontend rather than requiring the raw CSV/JSON endpoints.
- Support for additional steps or fully configurable step counts beyond the current fixed three-step layout.
- Externalizing WiFi credentials and relay configuration out of the `.ino` source files, so they are not committed to version control in plain text.

---

## License

This project is licensed under the Apache License 2.0.

Copyright © 2026 [Your Name]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

See the `LICENSE` file for the full license text.