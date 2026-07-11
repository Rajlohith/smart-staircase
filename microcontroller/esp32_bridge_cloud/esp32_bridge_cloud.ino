// esp32_bridge_cloud.ino
// -----------------------------------------------------------------------
// CLOUD-RELAY VARIANT of esp32_bridge_lan.ino
// -----------------------------------------------------------------------
// The LAN version (esp32_bridge_lan.ino) runs its own AsyncWebServer + WS
// server, so a browser must be on the SAME network to reach ws://<esp32-ip>/ws.
// That's fine for the offline/local demo, but it can't be reached from the
// internet — home routers don't expose the ESP32 without port-forwarding.
//
// This variant flips the connection direction: the ESP32 becomes a WebSocket
// CLIENT that dials OUT to your Render relay (outbound connections work fine
// behind NAT/firewalls, no port-forwarding needed). The relay then re-
// broadcasts whatever it receives to any connected browser, anywhere — and,
// TWO-WAY, forwards whatever a browser sends back down to this device (see
// server/server.js). This file used to ignore everything the relay sent it
// ("one-way uplink") — that's why door/sim commands never reached the real
// hardware over the cloud path even though the browser and relay already
// supported it. It now processes commands exactly like the LAN sketch does.
//
// Requires the "WebSockets" library by Markus Sattler (Links2004) —
// install via Library Manager: search "WebSockets" by Markus Sattler.
// -----------------------------------------------------------------------

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ---------------- WiFi ----------------
const char* ssid     = "Nord 4";
const char* password = "viaadamo";

// ---------------- Cloud relay ----------------
// Set this to your deployed Render service, e.g. "musical-stairs-relay.onrender.com"
const char* RELAY_HOST = "smart-staircase.onrender.com";
const uint16_t RELAY_PORT = 443;         // Render terminates TLS on 443
const char* RELAY_PATH = "/esp32";       // matches server/server.js's ESP32 endpoint
const char* RELAY_AUTH_TOKEN = "SmartStaircase2026!Relay#987"; // must match server/.env RELAY_TOKEN

WebSocketsClient wsClient;
bool relayConnected = false;

// ---------------- Servo ----------------
#define SERVO_PIN 18
#define SERVO_OPEN_ANGLE   45
#define SERVO_CLOSED_ANGLE 0
#define SERVO_STEP_MS      3   // ms between 1-degree steps
#define DOOR_HOLD_MS       2000

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
// up-to-date {..., door, doorMode} frame on a timer, same as the LAN sketch.
StaticJsonDocument<256> lastSensorDoc;
bool haveSensorReading = false;
unsigned long lastBroadcastAt = 0;
const unsigned long BROADCAST_INTERVAL_MS = 150;

// ---- non-blocking door/servo state machine (millis()-based, see LAN
// sketch for the full rationale — blocking delay()s here would stall
// wsClient.loop() and drop the relay connection). ----
enum DoorState { DOOR_CLOSED, DOOR_OPENING, DOOR_HOLD_OPEN, DOOR_CLOSING };
DoorState doorState = DOOR_CLOSED;
int servoAngle = SERVO_CLOSED_ANGLE;
unsigned long lastServoStepAt = 0;
unsigned long holdUntil = 0;

// ---------------- Serial from Arduino ----------------
HardwareSerial UnoSerial(2); // RX = GPIO16, TX = GPIO17
String serialBuffer = "";

void startOpening() { if (doorState != DOOR_OPENING) doorState = DOOR_OPENING; }
void beginHold() { doorState = DOOR_HOLD_OPEN; holdUntil = millis() + DOOR_HOLD_MS; }
void startClosing() { doorState = DOOR_CLOSING; }

const char* doorStateName() {
  switch (doorState) {
    case DOOR_CLOSED:    return "closed";
    case DOOR_OPENING:   return "opening";
    case DOOR_HOLD_OPEN: return "open";
    case DOOR_CLOSING:   return "closing";
  }
  return "closed";
}

const char* doorModeName() {
  return doorMode == MODE_MANUAL ? "manual" : "auto";
}

// Handles a JSON command relayed from a browser, e.g. {"cmd":"door_open"}
// or {"cmd":"sim","step":1}.
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
    if (lastLdr3) startOpening(); else startClosing();
  } else if (strcmp(cmd, "sim") == 0) {
    // TWO-WAY: browser clicked/broke a laser in the 3D twin. Forward to the
    // Uno, which owns the LED strips + speaker and treats it exactly like a
    // real beam-break for ~600ms. For step 3 the Uno's next telemetry line
    // reports ldr3:true, which the AUTO-mode logic in loop() below already
    // turns into a real servo/door open.
    int step = cmdDoc["step"] | 0;
    if (step >= 1 && step <= 3) {
      UnoSerial.print("SIM");
      UnoSerial.println(step);

      // A virtual footstep on the door step should always be able to open
      // the door, even if a previous door_open/door_close command left us
      // stuck in MANUAL mode. Hand control back to the sensor so the
      // upcoming ldr3:true from the Uno actually opens it.
      if (step == 3 && doorMode == MODE_MANUAL) {
        doorMode = MODE_AUTO;
      }
    }
  }
}

void updateDoor(bool ldr3) {
  unsigned long now = millis();

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
          servoAngle += 2;
          if (servoAngle > SERVO_OPEN_ANGLE) servoAngle = SERVO_OPEN_ANGLE;
          gateServo.write(servoAngle);
        } else {
          beginHold();
        }
      }
      break;
    case DOOR_HOLD_OPEN:
      if (doorMode != MODE_AUTO) break;
      if (ldr3) {
        holdUntil = now + DOOR_HOLD_MS;
      } else if (now >= holdUntil) {
        startClosing();
      }
      break;
    case DOOR_CLOSING:
      if (doorMode == MODE_AUTO && ldr3) { startOpening(); break; }
      if (now - lastServoStepAt >= SERVO_STEP_MS) {
        lastServoStepAt = now;
        if (servoAngle > SERVO_CLOSED_ANGLE) {
          servoAngle -= 2;
          if (servoAngle < SERVO_CLOSED_ANGLE) servoAngle = SERVO_CLOSED_ANGLE;
          gateServo.write(servoAngle);
        } else {
          doorState = DOOR_CLOSED;
        }
      }
      break;
  }
}

// Sends the latest known sensor reading plus current door/doorMode up
// through the relay to every connected browser.
void broadcastState() {
  if (!haveSensorReading || !relayConnected) return;
  lastSensorDoc["door"] = doorStateName();
  lastSensorDoc["doorMode"] = doorModeName();
  String out;
  serializeJson(lastSensorDoc, out);
  wsClient.sendTXT(out);
}

void wsEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      relayConnected = false;
      Serial.println("[RELAY] disconnected");
      break;
    case WStype_CONNECTED:
      relayConnected = true;
      Serial.println("[RELAY] connected to cloud relay");
      // identify + authenticate this device to the relay
      {
        StaticJsonDocument<128> hello;
        hello["type"] = "hello";
        hello["device"] = "esp32-staircase";
        hello["token"] = RELAY_AUTH_TOKEN;
        String out;
        serializeJson(hello, out);
        wsClient.sendTXT(out);
      }
      break;
    case WStype_TEXT: {
      // TWO-WAY: the relay forwards whatever a browser sent, e.g.
      // {"cmd":"door_open"} or {"cmd":"sim","step":1}.
      String msg;
      msg.reserve(length);
      for (size_t i = 0; i < length; i++) msg += (char)payload[i];
      handleCommand(msg);
      break;
    }
    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  UnoSerial.begin(115200, SERIAL_8N1, 16, 17);

  gateServo.setPeriodHertz(50);
  gateServo.attach(SERVO_PIN, 500, 2400);
  gateServo.write(SERVO_CLOSED_ANGLE);
  servoAngle = SERVO_CLOSED_ANGLE;
  delay(500);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println();
  Serial.print("Connected! IP: "); Serial.println(WiFi.localIP());

  // wss:// to Render (TLS) — beginSSL uses the device's built-in CA bundle
  wsClient.beginSSL(RELAY_HOST, RELAY_PORT, RELAY_PATH);
  wsClient.onEvent(wsEvent);
  wsClient.setReconnectInterval(3000); // auto-retry if the relay bounces
}

void loop() {
  wsClient.loop();

  // Always advance the door state machine every pass through loop(), same
  // as the LAN sketch, so the sweep/hold timing stays accurate without
  // blocking the relay connection or serial reads.
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
            if (ldr3 && !lastLdr3) startOpening();
            if (!ldr3 && lastLdr3 && doorState != DOOR_CLOSING && doorState != DOOR_CLOSED) beginHold();
          }
          lastLdr3 = ldr3;

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
