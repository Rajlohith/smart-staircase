# Musical Staircase — Digital Twin

A live 3D digital twin (Three.js) of a step-triggered LED + audio staircase,
with an optional live link to the physical ESP32/Arduino rig.

## What changed in this pass

- **Spiderman beam-blocker** — a small chibi Spiderman model (styled off your
  keychain photos, no keyring/chain) now sits wherever a laser beam is
  currently broken, so the beam looks like it's being physically blocked
  instead of vanishing out of nowhere. When nothing is broken, he sits at the
  bottom landing (the "welcome" area, where there's no laser/LDR at all).
- **Last riser (with the door) is now half height** — only that riser; the
  tread above it, the door, and the servo all shift down to sit correctly on
  top of it.
- **Servo relocated** — moved to the center of the door, mounted on the back
  face, and lower than before.
- **Numbers ⇄ Musical stairs toggle** — a segmented control in the "Simulate"
  panel switches between the original spoken numbers and a short 3-note tune
  per step.
- **Split into a proper file structure** (see below) instead of one 1,000+
  line `index.html`.
- **PWA support** — installable on mobile (manifest + service worker + icons).
- **Offline mode** — a zero-dependency Python static server.
- **Online hosting** — Firebase Hosting (frontend) + Render (cloud relay) +
  Neon (Postgres event log), with the reasoning for that split explained
  below, plus a simpler fallback if you want less moving parts.

## File structure

```
digital-twin/
├── index.html              # markup shell only
├── manifest.json           # PWA manifest
├── sw.js                    # service worker (offline caching)
├── firebase.json            # Firebase Hosting config
├── .firebaserc               # Firebase project alias (edit this)
├── serve_offline.py          # run this when there's no internet at all
├── css/
│   └── style.css
├── js/
│   ├── config.js             # shared dimensions/constants
│   ├── scene.js               # scene/camera/renderer/lights/orbit
│   ├── materials.js
│   ├── labels.js               # floating canvas-sprite text labels
│   ├── staircase.js            # builds risers/treads/LEDs/sensors/stringers
│   ├── door.js                 # door + servo geometry & animation
│   ├── spiderman.js             # the beam-blocker model + placement logic
│   ├── audio.js                 # tones, speech, numbers/music toggle
│   ├── ui-log.js                  # sensor/event log panel
│   ├── network.js                  # WebSocket link to the physical rig
│   ├── ui.js                        # button wiring, install prompt
│   └── main.js                       # entry point / render loop
├── assets/icons/              # PWA icons (192px, 512px)
├── microcontroller/
│   ├── arduino_code/
│   │   └── arduino_code.ino         # Uno sketch — UNCHANGED
│   ├── esp32_bridge_lan/
│   │   └── esp32_bridge_lan.ino      # ESP32, LAN-only (your original bridge)
│   └── esp32_bridge_cloud/
│       └── esp32_bridge_cloud.ino     # ESP32, dials out to the Render relay
└── server/                          # optional cloud relay (for internet hosting)
    ├── server.js
    ├── db.js
    ├── package.json
    └── .env.example
```

---

## 1. Run it locally first (sanity check)

From the `digital-twin/` folder:

```bash
python3 serve_offline.py
```

Then open the printed `http://localhost:8000` in a browser. Click a step,
try both buttons in the "Announce mode" toggle, and confirm Spiderman sits at
the landing until you trip a beam.

This same script is your **offline mode** — run it on any laptop with no
internet at all, and any phone/laptop on the same WiFi can open
`http://<your-computer's-LAN-IP>:8000`. The only internet dependency is the
one-time load of `three.js` from a CDN; see the comment at the top of
`serve_offline.py` for how to vendor that file locally for a 100%-offline
demo, or just let the service worker cache it the first time you have
internet.

---

## 2. Flash the Arduino / ESP32 (unchanged wiring)

- `microcontroller/arduino_code/arduino_code.ino` → your Uno, unchanged.
- For **LAN-only** use (rig and browser on the same WiFi): flash
  `microcontroller/esp32_bridge_lan/esp32_bridge_lan.ino` — this is your
  original sketch, untouched. In the app's "Physical Rig Link" panel, type
  the ESP32's IP and hit Connect.
- For **internet-wide** access (see architecture below): flash
  `microcontroller/esp32_bridge_cloud/esp32_bridge_cloud.ino` instead. Before
  flashing, edit these two lines in that file:
  ```cpp
  const char* RELAY_HOST = "musical-stairs-relay.onrender.com"; // your Render URL
  const char* RELAY_AUTH_TOKEN = "CHANGE_ME_SHARED_SECRET";     // must match server/.env
  ```
  You'll also need the **WebSockets** library by Markus Sattler
  (Arduino Library Manager → search "WebSockets" → install the one by
  Links2004).

---

## 3. Hosting online — architecture

**Why not just Firebase alone, or just Render alone?** The frontend is a
static site (Firebase Hosting is perfect and free for that). But the ESP32
sits behind your home router — nothing on the internet can reach it directly
without port-forwarding, which most people don't want to set up. So we need
a small always-on relay the ESP32 can dial *out* to (outbound connections
work fine through NAT), which then re-broadcasts to any browser. Render is a
good fit for that always-on Node process. Neon gives you a free serverless
Postgres if you want to keep a history of events (who tripped which beam,
when the door opened, etc.) instead of just live data.

```
 ESP32 (dials out) --wss--> Render (relay) --wss--> Browser(s) on Firebase Hosting
                                  |
                                  `--> Neon Postgres (event history, optional)
```

### Step-by-step

**A. Neon (Postgres) — optional, only if you want event history**
1. Go to https://neon.tech → sign up → "New Project".
2. Copy the connection string it gives you (starts with `postgres://...`).
3. Keep it handy for step B.

**B. Render (the relay)**
1. Push this whole `digital-twin/` folder to a GitHub repo.
2. Go to https://render.com → "New +" → "Web Service" → connect your repo.
3. Set **Root Directory** to `server`.
4. Build command: `npm install` — Start command: `npm start`.
5. Add environment variables (Render dashboard → Environment):
   - `RELAY_TOKEN` = pick a long random string (this is your shared secret —
     put the same value in `esp32_bridge_cloud.ino`'s `RELAY_AUTH_TOKEN`).
   - `DATABASE_URL` = the Neon connection string from step A (leave unset to
     skip history logging entirely — the relay still works fine).
6. Deploy. Render gives you a URL like
   `https://musical-stairs-relay.onrender.com`. Put that (without `https://`)
   into `RELAY_HOST` in `esp32_bridge_cloud.ino` and re-flash the ESP32.
7. Sanity check: open `https://musical-stairs-relay.onrender.com` in a
   browser — it should print a plain-text status line.

**C. Firebase (the frontend)**
1. `npm install -g firebase-tools` (one-time).
2. `firebase login`.
3. In `digital-twin/`, edit `.firebaserc` — replace
   `"your-firebase-project-id"` with your actual Firebase project ID (create
   one free at https://console.firebase.google.com if you don't have one).
4. From `digital-twin/`, run:
   ```bash
   firebase deploy --only hosting
   ```
5. Firebase prints your live URL, e.g. `https://your-project.web.app`. Open
   it — that's your digital twin, live on the internet.
6. In the app's "Physical Rig Link" field, instead of a LAN IP, type your
   Render relay's browser endpoint: `wss://musical-stairs-relay.onrender.com/ws`
   and hit Connect. Live rig data now flows in from anywhere.

**D. (Optional) check logged history**
- `https://musical-stairs-relay.onrender.com/api/history` returns the most
  recent events as JSON, straight from Neon.
- `https://musical-stairs-relay.onrender.com/api/history.csv` downloads
  **every** logged event as a CSV file (`id, received_at, ldr1, ldr2, ldr3,
  strip5, strip6, strip7, strip9, speaker`) — one row per received JSON
  message, ready to open in Excel/Sheets or load into pandas for analytics.
  Requires `DATABASE_URL` (Neon) to be set; without it, the file just comes
  back with the header row and no data.

### If you'd rather have fewer moving parts

Render alone can do double duty: serve the static frontend *and* run the
relay in the same Node process (just add `express.static(__dirname + '/..')`
in `server.js` and point Render's root directory at the repo root instead of
`server/`). That collapses it to **just Render + Neon**, one deploy, one URL
— simpler to operate, at the cost of Render's free tier spinning down after
inactivity (which adds a ~30s cold-start delay on the first request; Firebase
Hosting for the static part avoids that entirely, which is why it's split
out above). Either is a legitimate choice — pick the two-service split if you
want the frontend always instantly available, or the single-service version
if you want the least amount of configuration.

---

## 4. PWA — install on mobile

Once the site is hosted (Firebase, Render, or even `serve_offline.py` on
your own WiFi), open it in Chrome/Safari on your phone:
- **Android/Chrome:** a "⬇ Install app" button appears at the bottom of the
  screen (or use the browser menu → "Install app" / "Add to Home screen").
- **iOS/Safari:** Safari doesn't fire the install-prompt button, so use
  Share → "Add to Home Screen" instead — it'll still install as a
  standalone app using the same manifest.

Note: service workers require HTTPS (Firebase/Render both give you this
automatically) or `localhost` — plain `http://<LAN-IP>` from
`serve_offline.py` will run everything except the offline-cache part of the
PWA (the 3D app itself works fine either way).

---

## 5. Customizing the Spiderman model or its behavior

- Look/pose: `js/spiderman.js` — it's built entirely from primitive
  geometries + two small canvas textures (a web pattern for the head, a
  spider glyph for the chest), so you can tweak colors, proportions, or pose
  angles directly without any external model files.
- Placement logic: `updateSpiderman()` in the same file — it picks the
  lowest-indexed step whose beam is currently broken (works for both the
  click-to-simulate demo and the live rig feed) and glides Spiderman to that
  beam's exact position; otherwise it returns him to the landing.
