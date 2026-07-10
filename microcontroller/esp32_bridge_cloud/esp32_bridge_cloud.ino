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
// broadcasts whatever it receives to any connected browser, anywhere.
//
// Requires the "WebSockets" library by Markus Sattler (Links2004) —
// install via Library Manager: search "WebSockets" by Markus Sattler.
//
// Everything else (servo/door state machine, reading the Uno over serial)
// is IDENTICAL to esp32_bridge_lan.ino.
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
#define SERVO_STEP_MS      3
#define DOOR_HOLD_MS       2000

Servo gateServo;
bool lastLdr3 = false;

enum DoorState { DOOR_CLOSED, DOOR_OPENING, DOOR_HOLD_OPEN, DOOR_CLOSING };
DoorState doorState = DOOR_CLOSED;
int servoAngle = SERVO_CLOSED_ANGLE;
unsigned long lastServoStepAt = 0;
unsigned long holdUntil = 0;

void startOpening() { if (doorState != DOOR_OPENING) doorState = DOOR_OPENING; }
void beginHold() { doorState = DOOR_HOLD_OPEN; holdUntil = millis() + DOOR_HOLD_MS; }
void startClosing() { doorState = DOOR_CLOSING; }

void updateDoor(bool ldr3) {
  unsigned long now = millis();
  switch (doorState) {
    case DOOR_CLOSED:
      if (ldr3) startOpening();
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
      if (ldr3) {
        holdUntil = now + DOOR_HOLD_MS;
      } else if (now >= holdUntil) {
        startClosing();
      }
      break;
    case DOOR_CLOSING:
      if (ldr3) { startOpening(); break; }
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

// ---------------- Serial from Arduino ----------------
HardwareSerial UnoSerial(2); // RX = GPIO16, TX = GPIO17
String serialBuffer = "";

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
    default:
      break; // ignore relay->device messages; this bridge is one-way uplink
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
  updateDoor(lastLdr3);

  while (UnoSerial.available()) {
    char c = UnoSerial.read();
    if (c == '\n') {
      serialBuffer.trim();
      if (serialBuffer.length() > 0) {
        StaticJsonDocument<256> doc;
        DeserializationError err = deserializeJson(doc, serialBuffer);
        if (!err) {
          Serial.println(serialBuffer);
          bool ldr3 = doc["ldr3"];
          if (ldr3 && !lastLdr3) startOpening();
          if (!ldr3 && lastLdr3 && doorState != DOOR_CLOSING && doorState != DOOR_CLOSED) beginHold();
          lastLdr3 = ldr3;

          if (relayConnected) {
            wsClient.sendTXT(serialBuffer); // forward straight to the relay,
                                             // which re-broadcasts to browsers
          }
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
