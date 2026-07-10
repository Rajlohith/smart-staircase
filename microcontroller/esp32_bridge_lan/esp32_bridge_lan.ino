#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ---------------- WiFi ----------------
const char* ssid     = "Nord 4";
const char* password = "viaadamo";

// ---------------- Servo ----------------
#define SERVO_PIN 18
#define SERVO_OPEN_ANGLE   45
#define SERVO_CLOSED_ANGLE 0
#define SERVO_STEP_MS      3   // ms between 1-degree steps -> full 60-step
                                 // sweep takes 60*15 = 900ms, same as before,
                                 // but now timed with millis() instead of delay()
#define DOOR_HOLD_MS       2000 // how long the door stays open after the
                                 // beam clears, before it starts closing

Servo gateServo;
bool lastLdr3 = false;

// ---- TWO-WAY: virtual -> real door control ----
// AUTO   = beam-sensor-driven, exactly the original behavior.
// MANUAL = the browser told us to open/close directly; the beam sensor is
//          ignored until a "door_auto" command hands control back.
enum DoorMode { MODE_AUTO, MODE_MANUAL };
DoorMode doorMode = MODE_AUTO;
bool manualWantOpen = false;

// Last sensor reading from the Uno, kept around so we can broadcast an
// up-to-date {..., door, doorMode} frame on a timer -- not just when a new
// line arrives from the Uno -- so a door move triggered purely by a browser
// command (with no new sensor line) still gets reported back promptly.
StaticJsonDocument<256> lastSensorDoc;
bool haveSensorReading = false;
unsigned long lastBroadcastAt = 0;
const unsigned long BROADCAST_INTERVAL_MS = 150;

// ---- non-blocking door/servo state machine ----
// The previous version used delay(15) in a for-loop to sweep the servo, and
// a blocking delay(2000) (plus a nested while loop) to hold the door open.
// Both of those completely froze the ESP32's loop(), which meant *nothing*
// was read from the Uno or forwarded to the browser while the door was
// mid-sweep or holding open. That's exactly the "significant delay" seen
// when stepping down from step 3 to a lower step: LDR1/LDR2 events from the
// Uno were queued up and only processed once the door finished its blocking
// sequence. This rewrite tracks the servo's own angle and timing with
// millis(), so the sweep/hold happens at the *same real speed* as before,
// but the rest of loop() (reading the Uno, broadcasting over WebSocket)
// keeps running the whole time.
enum DoorState { DOOR_CLOSED, DOOR_OPENING, DOOR_HOLD_OPEN, DOOR_CLOSING };
DoorState doorState = DOOR_CLOSED;
int servoAngle = SERVO_CLOSED_ANGLE;
unsigned long lastServoStepAt = 0;
unsigned long holdUntil = 0;

void startOpening() {
  if (doorState != DOOR_OPENING) {
    doorState = DOOR_OPENING;
  }
}

void beginHold() {
  doorState = DOOR_HOLD_OPEN;
  holdUntil = millis() + DOOR_HOLD_MS;
}

void startClosing() {
  doorState = DOOR_CLOSING;
}

const char* doorStateName() {
  switch (doorState) {
    case DOOR_CLOSED:     return "closed";
    case DOOR_OPENING:    return "opening";
    case DOOR_HOLD_OPEN:  return "open";
    case DOOR_CLOSING:    return "closing";
  }
  return "closed";
}

const char* doorModeName() {
  return doorMode == MODE_MANUAL ? "manual" : "auto";
}

// Handles a JSON command from the browser, e.g. {"cmd":"door_open"}.
void handleCommand(const String& text) {
  StaticJsonDocument<128> cmdDoc;
  if (deserializeJson(cmdDoc, text)) return; // not JSON, ignore
  const char* cmd = cmdDoc["cmd"];
  if (!cmd) return;

  if (strcmp(cmd, "door_open") == 0) {
    doorMode = MODE_MANUAL;
    manualWantOpen = true;
    startOpening();
  } else if (strcmp(cmd, "door_close") == 0) {
    doorMode = MODE_MANUAL;
    manualWantOpen = false;
    startClosing();
  } else if (strcmp(cmd, "door_auto") == 0) {
    doorMode = MODE_AUTO;
    // Immediately re-evaluate against the last known beam reading so the
    // door doesn't sit stuck in whatever position the manual command left
    // it in until the next beam-state change.
    if (lastLdr3) startOpening(); else startClosing();
  }
}

// Call every loop() iteration; advances the servo by at most one degree per
// SERVO_STEP_MS, exactly matching the physical sweep rate, without blocking.
void updateDoor(bool ldr3) {
  unsigned long now = millis();

  // In MANUAL mode the beam sensor is ignored entirely -- only commands
  // (handleCommand above) can start an open/close sweep.
  if (doorMode == MODE_MANUAL) {
    if (manualWantOpen && (doorState == DOOR_CLOSED || doorState == DOOR_CLOSING)) startOpening();
    if (!manualWantOpen && (doorState == DOOR_HOLD_OPEN || doorState == DOOR_OPENING)) startClosing();
  }

  switch (doorState) {
    case DOOR_CLOSED:
      if (doorMode == MODE_AUTO && ldr3) startOpening();
      break;

    case DOOR_OPENING:
      if (now - lastServoStepAt >= SERVO_STEP_MS) {
        lastServoStepAt = now;

        if (servoAngle < SERVO_OPEN_ANGLE) {
          servoAngle += 2;   // Move 2° each step

          if (servoAngle > SERVO_OPEN_ANGLE)
            servoAngle = SERVO_OPEN_ANGLE;

          gateServo.write(servoAngle);
        } else {
          beginHold();
        }
      }
      break;

    case DOOR_HOLD_OPEN:
      // Auto-close-after-timeout is sensor logic -- skip it in MANUAL mode,
      // where only an explicit "door_close"/"door_auto" command may close it.
      if (doorMode != MODE_AUTO) break;
      if (ldr3) {
        // beam broken again while holding open -> keep holding, reset timer
        holdUntil = now + DOOR_HOLD_MS;
      } else if (now >= holdUntil) {
        startClosing();
      }
      break;

    case DOOR_CLOSING:
      if (doorMode == MODE_AUTO && ldr3) {
        // someone stepped back onto step 3 mid-close -> reopen from wherever we are
        startOpening();
        break;
      }
      if (now - lastServoStepAt >= SERVO_STEP_MS) {
        lastServoStepAt = now;

        if (servoAngle > SERVO_CLOSED_ANGLE) {
          servoAngle -= 2;   // Move 2° each step

          if (servoAngle < SERVO_CLOSED_ANGLE)
            servoAngle = SERVO_CLOSED_ANGLE;

          gateServo.write(servoAngle);
        } else {
          doorState = DOOR_CLOSED;
        }
      }
      break;
  }
}

// ---------------- Web Server ----------------
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// ---------------- Serial from Arduino ----------------
HardwareSerial UnoSerial(2);   // RX = GPIO16, TX = GPIO17
String serialBuffer = "";

void onWsEvent(AsyncWebSocket *server,
               AsyncWebSocketClient *client,
               AwsEventType type,
               void *arg,
               uint8_t *data,
               size_t len) {

  if (type == WS_EVT_CONNECT) {
    Serial.printf("[WS] Client #%u connected from %s\n",
                  client->id(),
                  client->remoteIP().toString().c_str());
  }

  if (type == WS_EVT_DISCONNECT) {
    Serial.printf("[WS] Client #%u disconnected\n",
                  client->id());
  }

  // TWO-WAY: a browser sent us something, e.g. {"cmd":"door_open"}.
  if (type == WS_EVT_DATA) {
    AwsFrameInfo *info = (AwsFrameInfo*)arg;
    if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
      String msg;
      msg.reserve(len);
      for (size_t i = 0; i < len; i++) msg += (char)data[i];
      handleCommand(msg);
    }
  }
}

// Sends the latest known sensor reading plus current door/doorMode to every
// connected browser. Called both right after a fresh Uno line arrives and on
// a plain timer, so door-only changes (from a command, with no new Uno line)
// still reach the browser promptly.
void broadcastState() {
  if (!haveSensorReading) return;
  lastSensorDoc["door"] = doorStateName();
  lastSensorDoc["doorMode"] = doorModeName();
  String out;
  serializeJson(lastSensorDoc, out);
  ws.textAll(out);
}

void setup() {

  Serial.begin(115200);

  // Serial from Arduino
  UnoSerial.begin(115200, SERIAL_8N1, 16, 17);

  // Servo
  gateServo.setPeriodHertz(50);
  gateServo.attach(SERVO_PIN, 500, 2400);
  gateServo.write(SERVO_CLOSED_ANGLE);
  servoAngle = SERVO_CLOSED_ANGLE;
  delay(500); // one-time startup settle, not in the hot loop

  // WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  Serial.print("Connecting");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("Connected! IP: ");
  Serial.println(WiFi.localIP());

  ws.onEvent(onWsEvent);
  server.addHandler(&ws);

  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {

    String msg = "Musical Staircase ESP32 Bridge\n";
    msg += "WebSocket: ws://" + WiFi.localIP().toString() + "/ws";

    request->send(200, "text/plain", msg);
  });

  server.begin();
}

void loop() {

  ws.cleanupClients();

  // Always advance the door state machine every pass through loop() —
  // this is what keeps the sweep/hold timing accurate without ever
  // blocking serial reads or WebSocket broadcasts.
  updateDoor(lastLdr3);

  // Periodic broadcast (independent of the Uno's serial cadence) so a door
  // move triggered purely by a browser command is reported back promptly.
  unsigned long nowMs = millis();
  if (nowMs - lastBroadcastAt >= BROADCAST_INTERVAL_MS) {
    lastBroadcastAt = nowMs;
    broadcastState();
  }

  while (UnoSerial.available()) {

    char c = UnoSerial.read();

    if (c == '\n') {

      serialBuffer.trim();

      if (serialBuffer.length() > 0) {

        DeserializationError err = deserializeJson(lastSensorDoc, serialBuffer);

        if (!err) {

          Serial.println(serialBuffer);
          haveSensorReading = true;

          bool ldr3 = lastSensorDoc["ldr3"];

          if (doorMode == MODE_AUTO) {
            if (ldr3 && !lastLdr3) {
              startOpening();
            }
            if (!ldr3 && lastLdr3 && doorState != DOOR_CLOSING && doorState != DOOR_CLOSED) {
              beginHold();
            }
          }

          lastLdr3 = ldr3;

          // Broadcast the sensor reading plus door/doorMode immediately —
          // no longer delayed by a blocking servo sweep or hold, and no
          // longer just an echo of the raw Uno line since we now append
          // door state that the Uno doesn't know about.
          lastBroadcastAt = millis();
          broadcastState();

        } else {

          Serial.print("JSON Error: ");
          Serial.println(err.c_str());

        }
      }

      serialBuffer = "";

    } else {

      serialBuffer += c;

    }
  }
}