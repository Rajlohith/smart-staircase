import { NUM_STEPS, DOOR_STEP } from './config.js';
import { ledsByStep, pointLightsByStep, beamsByStep, stepLabels, speakerLight, speakerMesh } from './staircase.js';
import { openDoor, scheduleCloseDoor } from './door.js';
import { announceStep } from './audio.js';
import { logRaw, logFieldChange, FIELD_INFO } from './ui-log.js';

// The ESP32 forwards the exact JSON it receives from the Uno:
// {ldr1, ldr2, ldr3, strip5, strip6, strip7, strip9, speaker}.
// strip7 (blue, DATA_PIN2) <-> LDR1 <-> Step 1
// strip5 (red, DATA_PIN1)  <-> LDR2 <-> Step 2
// strip9 (white, DATA_PIN4)<-> LDR3 <-> Step 3 (also opens the door via servo)
// strip6 (green, DATA_PIN3) is the idle/no-step-active indicator.
export const STEP_LDR_KEY = ['ldr1','ldr2','ldr3'];
export const STEP_COLOR = [
  { r:0.20, g:0.42, b:0.95 }, // step 1 - blue
  { r:0.95, g:0.14, b:0.14 }, // step 2 - red
  { r:0.95, g:0.95, b:0.98 }  // step 3 - white
];

let ws = null;
let wsReconnectTimer = null;
export let physicalConnected = false;
export let physicalData = null;

function setPhysicalStatus(state, text){
  const dot = document.getElementById('physicalDot');
  const label = document.getElementById('physicalStatusText');
  dot.classList.remove('connected','error');
  if(state === 'connected') dot.classList.add('connected');
  if(state === 'error') dot.classList.add('error');
  label.textContent = text;
}

let prevPhysical = { ldr1:false, ldr2:false, ldr3:false, strip5:false, strip6:false, strip7:false, strip9:false, speaker:false };

export function connectPhysical(){
  const ipField = document.getElementById('physicalIp');
  const ip = ipField.value.trim();
  if(!ip){ setPhysicalStatus('error','Enter the ESP32 IP first'); return; }

  if(ws){ ws.onclose = null; ws.close(); }
  if(wsReconnectTimer){ clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }

  setPhysicalStatus('connecting','Connecting…');

  // Direct LAN mode: ws://<esp32-ip>/ws (works when the browser and the rig
  // share the same network — including the offline/no-internet setup).
  // Cloud-relay mode: if the IP field is instead a relay hostname (see the
  // Render relay in /server), the ESP32 dials out to the relay and this same
  // code path connects to the relay's public wss:// endpoint transparently —
  // just paste the relay's wss://... URL into the field instead of a LAN IP.
  const url = ip.startsWith('ws://') || ip.startsWith('wss://') ? ip : ('ws://' + ip + '/ws');
  ws = new WebSocket(url);

  ws.onopen = () => {
    physicalConnected = true;
    setPhysicalStatus('connected','Connected to rig');
    logRaw('LINK · connected to ' + ip);
  };

  ws.onmessage = (evt) => {
    let data;
    try{ data = JSON.parse(evt.data); } catch(e){ return; }
    physicalData = data;

    // Edge-triggered announcement (numbers or musical-stairs tune), mirroring
    // the Uno's Talkie.say() calls.
    if(data.ldr1 && !prevPhysical.ldr1) announceStep(0);
    if(data.ldr2 && !prevPhysical.ldr2) announceStep(1);
    if(data.ldr3 && !prevPhysical.ldr3) announceStep(2);

    // Door/servo: opens the instant step 3's beam breaks, closes 2s after it clears
    if(data.ldr3 && !prevPhysical.ldr3) openDoor();
    if(!data.ldr3 && prevPhysical.ldr3) scheduleCloseDoor(2000);

    // Log EVERY sensor and actuator field the instant it changes state.
    Object.keys(FIELD_INFO).forEach(key=>{
      const now = !!data[key];
      if(now !== prevPhysical[key]) logFieldChange(key, now);
    });

    prevPhysical = {
      ldr1: !!data.ldr1, ldr2: !!data.ldr2, ldr3: !!data.ldr3,
      strip5: !!data.strip5, strip6: !!data.strip6, strip7: !!data.strip7, strip9: !!data.strip9,
      speaker: !!data.speaker
    };

    document.getElementById('hint').style.opacity = 0;
  };

  ws.onerror = () => { setPhysicalStatus('error','Connection error'); };

  ws.onclose = () => {
    physicalConnected = false;
    physicalData = null;
    setPhysicalStatus('error','Disconnected — retrying…');
    logRaw('LINK · disconnected, retrying…');
    wsReconnectTimer = setTimeout(connectPhysical, 2000);
  };
}

// Drives the staircase LEDs/beams/speaker/labels straight from the latest rig
// data, overriding whatever the click-simulation demo is doing while connected.
export function updatePhysicalVisuals(){
  if(!physicalConnected || !physicalData) return;

  for(let i=0;i<NUM_STEPS;i++){
    const broken = !!physicalData[STEP_LDR_KEY[i]];
    const leds = ledsByStep[i];
    const color = STEP_COLOR[i];

    if(broken){
      leds.forEach(led=>{
        led.material.emissive.setRGB(color.r, color.g, color.b);
        led.material.emissiveIntensity = 1.6;
      });
      pointLightsByStep[i].color.setRGB(color.r, color.g, color.b);
      pointLightsByStep[i].intensity = 4.5;
    } else {
      leds.forEach(led=>{
        led.material.emissive.setRGB(0.02,0.05,0.045);
        led.material.emissiveIntensity = 0.15;
      });
      pointLightsByStep[i].intensity = 0;
    }

    // beam disappears in the digital model exactly as it does on the rig —
    // Spiderman (see spiderman.js) is what visually "catches" it now.
    const b = beamsByStep[i];
    b.beam.visible = !broken;
    b.indicatorMat.color.set(broken ? 0xff3b3b : 0x400a0a);
    b.indicatorMat.emissive.set(broken ? 0x8a0000 : 0x000000);

    stepLabels[i].visible = broken;
  }

  if(physicalData.speaker){
    speakerLight.intensity = 3.2;
    speakerMesh.scale.set(1,1.06,1);
  } else {
    speakerLight.intensity = 0;
    speakerMesh.scale.set(1,1,1);
  }
}

// Exposes which steps are currently "broken" per the live rig, for the
// Spiderman blocker and the idle-glow logic in main.js.
export function physicalBrokenFlags(){
  if(!physicalConnected || !physicalData) return [false,false,false];
  return STEP_LDR_KEY.map(k => !!physicalData[k]);
}
