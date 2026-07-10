import { STEP_WIDTH, TREAD_DEPTH, TREAD_THICK, NUM_STEPS, DOOR_STEP, ACCENT, riserHeightFor, topYFor } from './config.js';
import { scene } from './scene.js';
import { boardMat, boardEdgeMat, pcbBlackMat, pcbBlueMat, goldMat, potMat, speakerBodyMat, speakerConeMat, ledMaterial } from './materials.js';
import { makeDynamicLabel, makeLabelSprite } from './labels.js';

export const rig = new THREE.Group();
scene.add(rig);

export const ledsByStep = [];
export const beamsByStep = [];
export const pointLightsByStep = [];
export const stepLabels = [];
export const stepTopY = [];
export let speakerMesh, speakerLight, speechLabel;
export let welcomeLight, welcomeDome;
export let idleGlowMat, idleLight;

// base landing board — flush with the stair sides, matching the real rig's
// single continuous flat board (previously overhung the sides by 4cm, which
// didn't match the physical build)
const landingDepth = 14;
const landing = new THREE.Mesh(
  new THREE.BoxGeometry(STEP_WIDTH, TREAD_THICK, landingDepth),
  boardEdgeMat
);
landing.position.set(0, TREAD_THICK/2, -landingDepth/2 + 0.01);
landing.receiveShadow = true; landing.castShadow = true;
rig.add(landing);

// --- welcome light: a small always-on fixture at the entrance of the staircase ---
{
  const welcomeGroup = new THREE.Group();
  const welcomeBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9,1.0,0.5,24),
    new THREE.MeshStandardMaterial({ color:0x1a1a1a, roughness:0.5, metalness:0.3 })
  );
  welcomeDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.75,24,16,0,Math.PI*2,0,Math.PI/2),
    new THREE.MeshStandardMaterial({ color:0xfff3d6, emissive:0xffd98a, emissiveIntensity:1.1, roughness:0.3 })
  );
  welcomeDome.position.y = 0.5;
  welcomeGroup.add(welcomeBase, welcomeDome);
  welcomeGroup.position.set(0, TREAD_THICK + 0.25, -landingDepth + 1.5);
  rig.add(welcomeGroup);

  welcomeLight = new THREE.PointLight(0xffd98a, 1.6, 20, 2);
  welcomeLight.position.set(0, TREAD_THICK + 1.4, -landingDepth + 1.5);
  rig.add(welcomeLight);
}

// --- reusable sensor-pair builder — LDR receiver on the LEFT, laser transmitter on the RIGHT ---
function buildSensorPair(ldrX, laserX, sensorY, sensorZ){
  const txGroup = new THREE.Group();
  const txBoard = new THREE.Mesh(new THREE.BoxGeometry(1.6,0.25,2.0), pcbBlackMat);
  const txBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.45,1.3,16), goldMat);
  txBarrel.rotation.z = Math.PI/2;
  txBarrel.position.set(-0.9,0.35,0);
  txGroup.add(txBoard, txBarrel);
  txGroup.position.set(laserX, sensorY+0.15, sensorZ);
  txGroup.castShadow = true;
  rig.add(txGroup);

  const rxGroup = new THREE.Group();
  const rxBoard = new THREE.Mesh(new THREE.BoxGeometry(1.7,0.25,2.3), pcbBlueMat);
  const rxPot = new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,0.3,16), potMat);
  rxPot.position.set(0.4,0.28,0.3);
  const rxLdr = new THREE.Mesh(new THREE.SphereGeometry(0.18,10,10), new THREE.MeshStandardMaterial({color:0xffe9a8, roughness:0.4}));
  rxLdr.position.set(-0.4,0.25,-0.6);
  const indicator = new THREE.Mesh(new THREE.SphereGeometry(0.16,10,10), new THREE.MeshStandardMaterial({color:0x400a0a, emissive:0x000000, roughness:0.3}));
  indicator.position.set(-0.5,0.28,0.7);
  rxGroup.add(rxBoard, rxPot, rxLdr, indicator);
  rxGroup.position.set(ldrX, sensorY+0.15, sensorZ);
  rxGroup.castShadow = true;
  rig.add(rxGroup);

  // laser beam between them — hides completely when "broken"
  const beamLen = Math.abs(laserX - ldrX) - 1.0;
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(beamLen, 0.12, 0.12),
    new THREE.MeshBasicMaterial({ color:0xff3b3b, transparent:true, opacity:0.85 })
  );
  beam.position.set((laserX+ldrX)/2, sensorY+0.5, sensorZ);
  rig.add(beam);

  // world-space midpoint of the beam, exposed so the Spiderman blocker can be
  // placed exactly in the beam's path (before `rig` itself is offset — callers
  // re-derive world position via rig.localToWorld once rig is positioned).
  const beamMidLocal = new THREE.Vector3((laserX+ldrX)/2, sensorY+0.5, sensorZ);

  return { beam, indicatorMat: indicator.material, beamMidLocal };
}

for(let i=0;i<NUM_STEPS;i++){
  const zFront = i*TREAD_DEPTH;
  const riserH = riserHeightFor(i);
  const yBottom = topYFor(i-1) || 0; // top of previous riser (0 for i===0)
  const yTop = topYFor(i);
  stepTopY.push(yTop);

  // --- riser (vertical face) — half height on the door step ---
  const riser = new THREE.Mesh(new THREE.BoxGeometry(STEP_WIDTH, riserH, 1.0), boardMat);
  riser.position.set(0, yBottom + riserH/2, zFront + 0.5);
  riser.castShadow = true; riser.receiveShadow = true;
  rig.add(riser);

  // --- tread (horizontal surface) ---
  const tread = new THREE.Mesh(new THREE.BoxGeometry(STEP_WIDTH, TREAD_THICK, TREAD_DEPTH), boardMat);
  tread.position.set(0, yTop + TREAD_THICK/2, zFront + TREAD_DEPTH/2);
  tread.castShadow = true; tread.receiveShadow = true;
  tread.userData.stepIndex = i;
  rig.add(tread);

  // --- LED strip along top edge of the riser ---
  const stripCount = 16;
  const stripY = yBottom + riserH - 0.35;
  const stripZ = zFront + 1.01;
  const leds = [];
  const stripGroup = new THREE.Group();
  for(let s=0;s<stripCount;s++){
    const led = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.15), ledMaterial());
    const x = -STEP_WIDTH/2 + 1 + s*((STEP_WIDTH-2)/(stripCount-1));
    led.position.set(x, stripY, stripZ);
    stripGroup.add(led);
    leds.push(led);
  }
  rig.add(stripGroup);
  ledsByStep.push(leds);

  const pl = new THREE.PointLight(ACCENT, 0, 26, 2);
  pl.position.set(0, stripY, stripZ + 3);
  rig.add(pl);
  pointLightsByStep.push(pl);

  // --- sensor pair: every step gets one (LDR left / laser right) ---
  const sensorZ = zFront + TREAD_DEPTH/2;
  const sensorY = yTop + TREAD_THICK + 0.4;
  const ldrX   = -STEP_WIDTH/2 + 2.0;
  const laserX =  STEP_WIDTH/2 - 2.0;
  beamsByStep.push(buildSensorPair(ldrX, laserX, sensorY, sensorZ));

  // --- floating "beam broken" label above this step ---
  const lbl = makeDynamicLabel(11, 2.6);
  lbl.userData.setText('STEP ' + (i+1) + ' · BEAM BROKEN', '#ff5a5a');
  lbl.position.set(0, yTop + TREAD_THICK + 4.5, zFront + TREAD_DEPTH/2);
  rig.add(lbl);
  stepLabels.push(lbl);

  // --- step 3's dedicated LED strip running up the vertical edge of the door wall ---
  if(i === DOOR_STEP){
    const edgeStripCount = 9;
    const edgeX = -STEP_WIDTH/2 + 1.1;
    const edgeGroup = new THREE.Group();
    const edgeYBottom = yTop + TREAD_THICK;
    const edgeYTop = edgeYBottom + 21.5;
    for(let s=0;s<edgeStripCount;s++){
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), ledMaterial());
      const y = edgeYBottom + s*((edgeYTop-edgeYBottom)/(edgeStripCount-1));
      led.position.set(edgeX, y, zFront + TREAD_DEPTH + 0.35);
      edgeGroup.add(led);
      leds.push(led);
    }
    rig.add(edgeGroup);
  }
}

// --- closed side stringer panels (traces the exact step profile, closing both sides) ---
const panelThickness = 0.6;
const stringerShape = new THREE.Shape();
stringerShape.moveTo(-landingDepth, 0);
stringerShape.lineTo(-landingDepth, TREAD_THICK);
stringerShape.lineTo(0, TREAD_THICK);
for(let i=0;i<NUM_STEPS;i++){
  const riserTopY = topYFor(i);
  const zFront = i*TREAD_DEPTH;
  const zBack = (i+1)*TREAD_DEPTH;
  stringerShape.lineTo(zFront, riserTopY);
  stringerShape.lineTo(zBack, riserTopY);
}
const backZ = NUM_STEPS*TREAD_DEPTH;
stringerShape.lineTo(backZ, 0);
stringerShape.lineTo(-landingDepth, 0);

const stringerGeo = new THREE.ExtrudeGeometry(stringerShape, { depth: panelThickness, bevelEnabled:false });
stringerGeo.rotateY(-Math.PI/2);
const stringerMat = new THREE.MeshStandardMaterial({ color:0xf3f3f0, roughness:0.85, metalness:0.02, side:THREE.DoubleSide });

const rightPanel = new THREE.Mesh(stringerGeo, stringerMat);
rightPanel.position.x = STEP_WIDTH/2;
rightPanel.castShadow = true; rightPanel.receiveShadow = true;
rig.add(rightPanel);

const leftPanel = new THREE.Mesh(stringerGeo, stringerMat);
leftPanel.scale.x = -1;
leftPanel.position.x = -STEP_WIDTH/2;
leftPanel.castShadow = true; leftPanel.receiveShadow = true;
rig.add(leftPanel);

// --- small speaker, mounted on the left side wall beside STEP 2 ---
{
  const stepIdx = 1; // step 2
  const sx = -STEP_WIDTH/2;
  const sy = topYFor(stepIdx-1) + riserHeightFor(stepIdx)/2;
  const sz = stepIdx*TREAD_DEPTH + TREAD_DEPTH/2;

  const sGroup = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.0,2.0,0.9,32), speakerBodyMat);
  body.rotation.z = -Math.PI/2;
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.4,1.6,0.35,32), speakerConeMat);
  cone.rotation.z = -Math.PI/2;
  cone.position.x = -0.5;
  sGroup.add(body, cone);
  sGroup.position.set(sx - 0.35, sy, sz);
  rig.add(sGroup);
  speakerMesh = cone;

  const spl = new THREE.PointLight(0xffffff, 0, 14, 2);
  spl.position.set(sx - 4, sy, sz);
  rig.add(spl);
  speakerLight = spl;

  speechLabel = makeDynamicLabel(11, 2.75);
  speechLabel.position.set(sx - 5, sy + 3.2, sz);
  rig.add(speechLabel);
}

// --- idle/"welcome" ambient glow (strip6 on the real rig) — mounted along
// the FRONT edge of the landing, spanning its width, matching the physical
// build (previously ran along the right side spanning the full depth, which
// didn't match) ---
{
  idleGlowMat = new THREE.MeshStandardMaterial({ color:0x123018, emissive:0x21e6c1, emissiveIntensity:0.9, roughness:0.5 });
  const idleGlowStrip = new THREE.Mesh(new THREE.BoxGeometry(STEP_WIDTH, 0.4, 0.4), idleGlowMat);
  idleGlowStrip.position.set(0, TREAD_THICK + 0.3, -landingDepth + 0.35);
  rig.add(idleGlowStrip);
  idleLight = new THREE.PointLight(0x21e6c1, 1.4, 30, 2);
  idleLight.position.set(0, TREAD_THICK + 1.2, -landingDepth + 0.6);
  rig.add(idleLight);
}

// --- step number billboards ---
for(let i=0;i<NUM_STEPS;i++){
  const label = makeLabelSprite('STEP '+(i+1));
  label.position.set(STEP_WIDTH/2 - 3, stepTopY[i] + 2.6, i*TREAD_DEPTH + TREAD_DEPTH/2);
  rig.add(label);
}

export const landingDepthExport = landingDepth;
export const backZExport = backZ;
export const panelThicknessExport = panelThickness;
