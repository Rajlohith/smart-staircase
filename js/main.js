import { NUM_STEPS, DOOR_STEP, TREAD_DEPTH, NOTES, riserHeightFor } from './config.js';
import { scene, camera, renderer, clock, setOrbitTarget, isCurrentlyDragging, wasDragMoved } from './scene.js';
import {
  rig, ledsByStep, beamsByStep, pointLightsByStep, stepLabels,
  welcomeLight, welcomeDome, idleGlowMat, idleLight,
  speakerLight, speakerMesh,
  landingDepthExport as landingDepth
} from './staircase.js';
import { openDoor, scheduleCloseDoor, updateDoor } from './door.js';
import { updateSpiderman } from './spiderman.js';
import { playNote, announceStep } from './audio.js';
import { connectPhysical, updatePhysicalVisuals, physicalConnected, physicalData } from './network.js';
import { logRaw } from './ui-log.js';
import { initModeToggle, initPhysicalLink, initInstallPrompt, initDoorControls } from './ui.js';

// ---------------------------------------------------------------
// Center the whole rig for a nicer default orbit target
// ---------------------------------------------------------------
let totalHeight = 0;
for(let i=0;i<NUM_STEPS;i++) totalHeight += riserHeightFor(i);
const totalRun = NUM_STEPS*TREAD_DEPTH;
rig.position.set(0,0, -totalRun/2 - landingDepth/4);
setOrbitTarget(0, totalHeight/2, 0);

// ---------------------------------------------------------------
// STEP TRIGGER LOGIC (click-to-simulate demo)
// ---------------------------------------------------------------
const activeAnims = [];

function logEvent(i){
  logRaw('STEP_0'+(i+1)+' · BEAM:BROKEN · LDR:TRIG · NOTE:'+NOTES[i].toFixed(2)+'Hz');
}

function triggerStep(i){
  playNote(NOTES[i]);
  activeAnims.push({ stepIndex:i, start: clock.getElapsedTime(), duration: 1.3 });

  // break the laser beam briefly + light receiver indicator + show the label
  const b = beamsByStep[i];
  b.beam.visible = false;
  b.indicatorMat.color.set(0xff3b3b);
  b.indicatorMat.emissive.set(0x8a0000);
  stepLabels[i].visible = true;
  setTimeout(()=>{
    b.beam.visible = true;
    b.indicatorMat.color.set(0x400a0a);
    b.indicatorMat.emissive.set(0x000000);
    stepLabels[i].visible = false;
  }, 500);

  // that step's speaker lights up too
  speakerLight.intensity = 3.2;
  speakerMesh.scale.set(1,1.12,1);
  setTimeout(()=>{ speakerMesh.scale.set(1,1,1); }, 160);
  setTimeout(()=>{ speakerLight.intensity = 0; }, 900);

  announceStep(i); // numbers or musical-stairs tune, per the toggle
  logEvent(i);

  if(i === DOOR_STEP){
    openDoor();
    scheduleCloseDoor(2000);
  }

  document.getElementById('hint').style.opacity = 0;
}

function playSequence(){
  [0,1,2].forEach((idx, k)=> setTimeout(()=>triggerStep(idx), k*550));
}
function randomStep(){ triggerStep(Math.floor(Math.random()*NUM_STEPS)); }

document.getElementById('btnSequence').addEventListener('click', playSequence);
document.getElementById('btnRandom').addEventListener('click', randomStep);
initModeToggle();
initPhysicalLink();
initDoorControls();
initInstallPrompt();

// ---------------------------------------------------------------
// RAYCAST CLICK ON TREADS
// ---------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function handleSelect(clientX, clientY){
  if(wasDragMoved()) return;
  mouse.x = (clientX/window.innerWidth)*2-1;
  mouse.y = -(clientY/window.innerHeight)*2+1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(rig.children, true);
  for(const h of hits){
    if(h.object.userData && h.object.userData.stepIndex !== undefined){
      triggerStep(h.object.userData.stepIndex);
      break;
    }
  }
}
renderer.domElement.addEventListener('click', e=> handleSelect(e.clientX, e.clientY));
renderer.domElement.addEventListener('touchend', e=>{
  if(e.changedTouches && e.changedTouches[0]){
    const t = e.changedTouches[0];
    handleSelect(t.clientX, t.clientY);
  }
});

setTimeout(()=>{ document.getElementById('hint').style.opacity = 1; }, 800);

// ---------------------------------------------------------------
// ANIMATE
// ---------------------------------------------------------------
function updateLEDs(){
  const now = clock.getElapsedTime();
  for(let i=activeAnims.length-1;i>=0;i--){
    const a = activeAnims[i];
    const t = (now - a.start)/a.duration;
    if(t >= 1){ activeAnims.splice(i,1); continue; }
    const envelope = Math.sin(Math.min(t,1)*Math.PI);
    const leds = ledsByStep[a.stepIndex];
    leds.forEach(led=>{
      led.material.emissive.setRGB(0.13*envelope, 0.9*envelope, 0.76*envelope);
      led.material.emissiveIntensity = 0.2 + envelope*1.6;
    });
    pointLightsByStep[a.stepIndex].intensity = envelope*4.5;
  }
}

function updateWelcomeLight(){
  const now = clock.getElapsedTime();
  const breathe = 0.75 + 0.35*Math.sin(now*1.1);
  welcomeLight.intensity = breathe;
  welcomeDome.material.emissiveIntensity = 0.8 + 0.5*breathe;
}

function updateIdleGlow(){
  const anyPhysicalActive = physicalConnected && physicalData &&
    (physicalData.ldr1 || physicalData.ldr2 || physicalData.ldr3);
  const active = activeAnims.length > 0 || anyPhysicalActive;
  const targetIntensity = active ? 0 : 1.4;
  idleLight.intensity += (targetIntensity - idleLight.intensity) * 0.15;
  idleGlowMat.emissiveIntensity += ((active ? 0.15 : 0.9) - idleGlowMat.emissiveIntensity) * 0.15;
}

let lastT = clock.getElapsedTime();
function animate(){
  requestAnimationFrame(animate);
  const now = clock.getElapsedTime();
  const dt = Math.min(0.1, now - lastT);
  lastT = now;

  updateLEDs();
  updateWelcomeLight();
  updateIdleGlow();
  updateDoor();
  updatePhysicalVisuals(); // live rig data wins over the demo simulation

  // Spiderman blocks whichever beam is currently broken (demo OR live rig);
  // both paths flip beamsByStep[i].beam.visible, so this single check covers
  // both without needing separate demo/physical flags.
  const brokenFlags = beamsByStep.map(b => !b.beam.visible);
  updateSpiderman(brokenFlags, dt);

  renderer.render(scene, camera);
}
animate();

// ---------------------------------------------------------------
// PWA — register service worker
// ---------------------------------------------------------------
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('./sw.js').catch(err=>{
      console.warn('Service worker registration failed:', err);
    });
  });
}
