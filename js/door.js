import { STEP_WIDTH, DOOR_STEP, TREAD_THICK, NUM_STEPS, TREAD_DEPTH } from './config.js';
import { rig, stepTopY } from './staircase.js';
import { boardMat, boardEdgeMat } from './materials.js';
import { clock } from './scene.js';

const wallWidth  = STEP_WIDTH;
const wallHeight = 22;
const panelThickness = 0.6;
const backZ = NUM_STEPS * TREAD_DEPTH;

export let doorPivot, hornPivot;

{
  const topY = stepTopY[DOOR_STEP] + TREAD_THICK;
  const wallThick  = panelThickness;
  const doorZ = backZ + wallThick/2;

  // hole cut into the wall — centered, with margin above/below, matching photos
  const holeW = wallWidth * 0.34;
  const holeH = wallHeight * 0.55;
  const holeBottomY = wallHeight * 0.22;
  const holeCenterX = 0;

  const wallShape = new THREE.Shape();
  wallShape.moveTo(-wallWidth/2, 0);
  wallShape.lineTo(wallWidth/2, 0);
  wallShape.lineTo(wallWidth/2, wallHeight);
  wallShape.lineTo(-wallWidth/2, wallHeight);
  wallShape.lineTo(-wallWidth/2, 0);

  const holePath = new THREE.Path();
  holePath.moveTo(holeCenterX-holeW/2, holeBottomY);
  holePath.lineTo(holeCenterX+holeW/2, holeBottomY);
  holePath.lineTo(holeCenterX+holeW/2, holeBottomY+holeH);
  holePath.lineTo(holeCenterX-holeW/2, holeBottomY+holeH);
  holePath.lineTo(holeCenterX-holeW/2, holeBottomY);
  wallShape.holes.push(holePath);

  const wallGeo = new THREE.ExtrudeGeometry(wallShape, { depth: wallThick, bevelEnabled:false });
  const doorWall = new THREE.Mesh(wallGeo, boardMat);
  doorWall.position.set(0, topY, doorZ - wallThick/2);
  doorWall.castShadow = true; doorWall.receiveShadow = true;
  rig.add(doorWall);

  // the door flap — hinged on the right edge of the opening
  doorPivot = new THREE.Group();
  doorPivot.position.set(holeCenterX + holeW/2, topY + holeBottomY, doorZ);
  rig.add(doorPivot);

  const doorThick = 0.5;
  const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(holeW, holeH, doorThick), boardEdgeMat);
  doorPanel.position.set(-holeW/2, holeH/2, 0);
  doorPanel.castShadow = true;
  doorPivot.add(doorPanel);

  // SG90-style servo — mounted on the SIDE jamb of the doorway (the right
  // edge, next to the hinge), facing sideways into the opening, and
  // vertically centered on the door's height. Previously this sat flush
  // against the wall's back face, which didn't match the physical build
  // (real servo is mounted to the side, not the front/back).
  const servoGroup = new THREE.Group();
  const servoMat = new THREE.MeshStandardMaterial({ color:0x2255aa, roughness:0.4, metalness:0.3 });
  const servoBody = new THREE.Mesh(new THREE.BoxGeometry(1.6,1.6,1.1), servoMat);
  servoGroup.add(servoBody);
  hornPivot = new THREE.Group();
  hornPivot.position.set(0,0.85,-0.35);
  const horn = new THREE.Mesh(new THREE.BoxGeometry(1.7,0.16,0.16), new THREE.MeshStandardMaterial({color:0xe8e8e8, roughness:0.5}));
  horn.position.set(-0.75,0,0);
  hornPivot.add(horn);
  servoGroup.add(hornPivot);
  servoGroup.rotation.y = Math.PI/2; // turn to face sideways, into the opening
  servoGroup.position.set(
    holeCenterX + holeW/2 + 0.6,      // to the side — against the right jamb edge, by the hinge
    topY + holeBottomY + holeH/2,     // vertically centered on the door's height
    doorZ - 1.5                            // flush with the wall/door plane, not front or back
  );
  servoGroup.castShadow = true;
  rig.add(servoGroup);
}

// ---------------------------------------------------------------
// DOOR / SERVO CONTROL
// ---------------------------------------------------------------
// Timing is synced to the real servo's actual movement: the ESP32 bridge
// sweeps the SG90 one degree at a time, 60 steps at 15ms/step, so a full
// open or close sweep takes exactly 60*15 = 900ms on the physical rig.
const DOOR_SWEEP_MS = 60 * 15; // 900ms — matches gateServo's 0->60 degree sweep
const DOOR_OPEN_ANGLE = 1.7;
let doorAngle = 0;
let doorAnimFrom = 0, doorAnimTo = 0, doorAnimStart = 0;
let doorCloseTimer = null;

function animateDoorTo(target){
  doorAnimFrom = doorAngle;
  doorAnimTo = target;
  doorAnimStart = clock.getElapsedTime();
}
export function openDoor(){
  if(doorCloseTimer){ clearTimeout(doorCloseTimer); doorCloseTimer = null; }
  animateDoorTo(DOOR_OPEN_ANGLE);
}
export function scheduleCloseDoor(delayMs){
  if(doorCloseTimer) clearTimeout(doorCloseTimer);
  doorCloseTimer = setTimeout(()=>{ animateDoorTo(0); doorCloseTimer = null; }, delayMs);
}
export function updateDoor(){
  const elapsedMs = (clock.getElapsedTime() - doorAnimStart) * 1000;
  const t = Math.max(0, Math.min(1, elapsedMs / DOOR_SWEEP_MS));
  doorAngle = doorAnimFrom + (doorAnimTo - doorAnimFrom) * t;
  doorPivot.rotation.y = doorAngle;
  hornPivot.rotation.z = doorAngle * 0.9;
}
