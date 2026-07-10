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

// Call every loop() iteration; advances the servo by at most one degree per
// SERVO_STEP_MS, exactly matching the physical sweep rate, without blocking.
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
      if (ldr3) {
        // beam broken again while holding open -> keep holding, reset timer
        holdUntil = now + DOOR_HOLD_MS;
      } else if (now >= holdUntil) {
        startClosing();
      }
      break;

    case DOOR_CLOSING:
      if (ldr3) {
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

          if (ldr3 && !lastLdr3) {
            startOpening();
          }
          if (!ldr3 && lastLdr3 && doorState != DOOR_CLOSING && doorState != DOOR_CLOSED) {
            beginHold();
          }

          lastLdr3 = ldr3;

          // Broadcast JSON to browser immediately — no longer delayed by a
          // blocking servo sweep or hold.
          ws.textAll(serialBuffer);

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