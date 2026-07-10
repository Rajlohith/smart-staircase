#include <FastLED.h>
#include <Talkie.h>
#include <Vocab_US_TI99.h>

#define NUM_LEDS 30

// LED Strip Pins
#define DATA_PIN1 5   // Strip 1
#define DATA_PIN2 7   // Strip 2
#define DATA_PIN3 6   // Strip 3
#define DATA_PIN4 9   // Strip 4

// LDR Pins
#define LDR1_PIN 2
#define LDR2_PIN 4
#define LDR3_PIN 8

CRGB leds1[NUM_LEDS];
CRGB leds2[NUM_LEDS];
CRGB leds3[NUM_LEDS];
CRGB leds4[NUM_LEDS];

Talkie voice;

bool lastLdr1 = LOW;
bool lastLdr2 = LOW;
bool lastLdr3 = LOW;

void setup() {

  Serial.begin(115200);

  FastLED.addLeds<WS2812B, DATA_PIN1, GRB>(leds1, NUM_LEDS);
  FastLED.addLeds<WS2812B, DATA_PIN2, GRB>(leds2, NUM_LEDS);
  FastLED.addLeds<WS2812B, DATA_PIN3, GRB>(leds3, NUM_LEDS);
  FastLED.addLeds<WS2812B, DATA_PIN4, GRB>(leds4, NUM_LEDS);

  FastLED.setBrightness(100);

  pinMode(LDR1_PIN, INPUT);
  pinMode(LDR2_PIN, INPUT);
  pinMode(LDR3_PIN, INPUT);

  voice.doNotUseInvertedOutput();
}

void loop() {

  // Read sensors
  bool ldr1 = digitalRead(LDR1_PIN);
  bool ldr2 = digitalRead(LDR2_PIN);
  bool ldr3 = digitalRead(LDR3_PIN);

  // Speak once when beam is broken
  if (ldr1 == HIGH && lastLdr1 == LOW) {
    voice.say(spt_ONE);
  }

  if (ldr2 == HIGH && lastLdr2 == LOW) {
    voice.say(spt_TWO);
  }

  // Speak once when beam is broken
  if (ldr3 == HIGH && lastLdr3 == LOW) {
    voice.say(spt_THREE);
  }

  lastLdr1 = ldr1;
  lastLdr2 = ldr2;
  lastLdr3 = ldr3;

  // Turn OFF all strips
  fill_solid(leds1, NUM_LEDS, CRGB::Black);
  fill_solid(leds2, NUM_LEDS, CRGB::Black);
  fill_solid(leds3, NUM_LEDS, CRGB::Black);
  fill_solid(leds4, NUM_LEDS, CRGB::Black);

  bool strip5 = false;
  bool strip6 = false;
  bool strip7 = false;
  bool strip9 = false;

  // LED Logic
  if (ldr3 == HIGH) {

    // Strip on D9
    fill_solid(leds4, NUM_LEDS, CRGB::White);
    strip9 = true;

  }
  else if (ldr2 == HIGH) {

    // Strip on D5
    fill_solid(leds1, NUM_LEDS, CRGB::Red);
    strip5 = true;

  }
  else if (ldr1 == HIGH) { 

    // Strip on D7
    fill_solid(leds2, NUM_LEDS, CRGB::Blue);
    strip7 = true;

  }
  else {

    // Strip on D6
    fill_solid(leds3, NUM_LEDS, CRGB::Green);
    strip6 = true;

  }

  FastLED.show();

  // Speaker state
  bool speaker = (ldr1 == HIGH || ldr2 == HIGH || ldr3 == HIGH);

  // Send JSON to ESP32
  Serial.print("{");

  Serial.print("\"ldr1\":");
  Serial.print(ldr1 ? "true" : "false");
  Serial.print(",");

  Serial.print("\"ldr2\":");
  Serial.print(ldr2 ? "true" : "false");
  Serial.print(",");

  Serial.print("\"ldr3\":");
  Serial.print(ldr3 ? "true" : "false");
  Serial.print(",");

  Serial.print("\"strip5\":");
  Serial.print(strip5 ? "true" : "false");
  Serial.print(",");

  Serial.print("\"strip6\":");
  Serial.print(strip6 ? "true" : "false");
  Serial.print(",");

  Serial.print("\"strip7\":");
  Serial.print(strip7 ? "true" : "false");
  Serial.print(",");

  Serial.print("\"strip9\":");
  Serial.print(strip9 ? "true" : "false");
  Serial.print(",");

  Serial.print("\"speaker\":");
  Serial.print(speaker ? "true" : "false");

  Serial.println("}");

  delay(50);
}
