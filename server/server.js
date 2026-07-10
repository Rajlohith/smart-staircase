// server/server.js
// -----------------------------------------------------------------------
// Cloud relay for the Musical Staircase digital twin.
//
//   ESP32 (esp32_bridge_cloud.ino)  --wss-->  THIS SERVER  --wss-->  Browser(s)
//                                         |
//                                         `--> Neon Postgres (optional log)
//
// Two WebSocket endpoints on the same HTTP server:
//   /esp32  — the rig dials into this one (must send a "hello" with the
//             shared RELAY_TOKEN first, or it's dropped).
//   /ws     — browsers dial into this one; they receive everything the
//             device sends, re-broadcast verbatim (same JSON shape the
//             frontend already expects from the LAN mode).
//
// Deploy this folder as a Render "Web Service" (Node). See ../README.md
// for the full step-by-step.
// -----------------------------------------------------------------------
require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const db = require('./db');

const app = express();
const server = http.createServer(app);

const RELAY_TOKEN = process.env.RELAY_TOKEN || 'CHANGE_ME_SHARED_SECRET';

app.get('/', (req, res) => {
  res.type('text/plain').send(
    'Musical Staircase cloud relay is running.\n' +
    'Device uplink:  wss://<this-host>/esp32\n' +
    'Browser feed:   wss://<this-host>/ws\n' +
    'History logging: ' + (db.enabled ? 'ENABLED (Neon)' : 'disabled (no DATABASE_URL)')
  );
});

// Simple JSON history endpoint, so you can sanity-check Neon logging from a
// browser without a DB client: GET /api/history?limit=50
app.get('/api/history', async (req, res) => {
  const limit = Math.min(500, parseInt(req.query.limit, 10) || 100);
  const rows = await db.recentEvents(limit);
  res.json(rows);
});

// CSV export of every received JSON payload, for future analytics
// (Excel/Sheets/pandas, etc): GET /api/history.csv
app.get('/api/history.csv', async (req, res) => {
  const csv = await db.allEventsCSV();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="staircase_events.csv"');
  res.send(csv);
});

const wssDevice = new WebSocketServer({ noServer: true });
const wssBrowsers = new WebSocketServer({ noServer: true });

let deviceSocket = null;
const browserSockets = new Set();

wssDevice.on('connection', (ws) => {
  let authenticated = false;

  ws.on('message', (raw) => {
    const text = raw.toString();

    if (!authenticated) {
      // First message from the device must be the hello/auth frame.
      try {
        const msg = JSON.parse(text);
        if (msg.type === 'hello' && msg.token === RELAY_TOKEN) {
          authenticated = true;
          deviceSocket = ws;
          console.log('[relay] ESP32 device authenticated:', msg.device || 'unknown');
          return;
        }
      } catch (e) { /* fall through to reject below */ }
      console.log('[relay] rejecting unauthenticated device message');
      ws.close(4001, 'unauthorized');
      return;
    }

    // Every subsequent message is the same JSON payload the Uno produces
    // ({ldr1, ldr2, ldr3, strip5, strip6, strip7, strip9, speaker}).
    // Re-broadcast verbatim to every connected browser, and log it.
    for (const b of browserSockets) {
      if (b.readyState === b.OPEN) b.send(text);
    }
    try { db.logEvent(JSON.parse(text)); } catch (e) { /* non-JSON, skip logging */ }
  });

  ws.on('close', () => {
    if (deviceSocket === ws) deviceSocket = null;
    console.log('[relay] device disconnected');
  });
});

wssBrowsers.on('connection', (ws) => {
  browserSockets.add(ws);
  console.log('[relay] browser connected, total:', browserSockets.size);
  ws.on('close', () => {
    browserSockets.delete(ws);
    console.log('[relay] browser disconnected, total:', browserSockets.size);
  });
});

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/esp32')) {
    wssDevice.handleUpgrade(req, socket, head, (ws) => wssDevice.emit('connection', ws, req));
  } else if (req.url.startsWith('/ws')) {
    wssBrowsers.handleUpgrade(req, socket, head, (ws) => wssBrowsers.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log('[relay] listening on', PORT));
