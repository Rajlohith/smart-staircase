import { rig, beamsByStep, stepTopY } from './staircase.js';
import { NUM_STEPS } from './config.js';

// ---------------------------------------------------------------
// SPIDERMAN "BEAM BLOCKER"
// ---------------------------------------------------------------
// Concept: on the real rig, a laser beam just vanishes on the "broken" frame
// (photodiode reads dark) — there's no visible cause. In the digital twin
// that read as if the beam "magically" disappeared. This chibi Spiderman
// figure (styled after the reference keychain photos, minus the keyring/
// chain) is placed physically in the beam's path whenever that step's beam
// is broken, so the beam looks like it's being blocked by him rather than
// vanishing for no reason. When no beam anywhere is broken, he sits at the
// bottom "welcome" landing, where there is no laser/LDR pair at all.

function makeWebTexture(){
  const size = 512;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#c81f1f';
  ctx.fillRect(0,0,size,size);
  ctx.strokeStyle = 'rgba(20,10,10,0.55)';
  ctx.lineWidth = 3;
  const cx = size/2, cy = size/2;
  // radial web lines
  for(let a=0;a<Math.PI*2;a+=Math.PI/8){
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.lineTo(cx+Math.cos(a)*size, cy+Math.sin(a)*size);
    ctx.stroke();
  }
  // concentric web arcs
  for(let r=30;r<size;r+=40){
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeSpiderEmblemTexture(){
  const w = 128, h = 160;
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = '#f2f2f2';
  ctx.strokeStyle = '#f2f2f2';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  // simple spider glyph: body + legs
  ctx.beginPath(); ctx.ellipse(w/2, h*0.42, 10, 22, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(w/2, h*0.18, 7, 10, 0, 0, Math.PI*2); ctx.fill();
  const legPairs = 4;
  for(let i=0;i<legPairs;i++){
    const y = h*0.3 + i*14;
    ctx.beginPath(); ctx.moveTo(w/2, y); ctx.lineTo(w/2 - 34 - i*4, y - 10 + i*6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w/2, y); ctx.lineTo(w/2 + 34 + i*4, y - 10 + i*6); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(w/2, h*0.55); ctx.lineTo(w/2, h*0.85); ctx.stroke();
  const tex = new THREE.CanvasTexture(cvs);
  return tex;
}

const webTexture = makeWebTexture();

// three.js r128 doesn't have CapsuleGeometry (added in a later release), so
// build the same rounded-rod shape manually: a cylinder shaft with a sphere
// cap on each end. Returns a Group that behaves like any other mesh for
// positioning/rotation purposes.
function makeCapsule(radius, length, material){
  const grp = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), material);
  grp.add(shaft);
  const capTop = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material);
  capTop.position.y = length/2;
  const capBottom = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material);
  capBottom.position.y = -length/2;
  grp.add(capTop, capBottom);
  return grp;
}

const headMat = new THREE.MeshStandardMaterial({ map: webTexture, roughness:0.55, metalness:0.05 });
const suitMat = new THREE.MeshStandardMaterial({ color:0x1c3f8f, roughness:0.5, metalness:0.05 });
const limbRedMat = new THREE.MeshStandardMaterial({ color:0xc81f1f, roughness:0.5, metalness:0.05 });
const lensMat = new THREE.MeshStandardMaterial({ color:0xf4f7fb, roughness:0.3, metalness:0.1 });
const lensRimMat = new THREE.MeshStandardMaterial({ color:0x111318, roughness:0.4 });
const emblemMat = new THREE.MeshStandardMaterial({
  map: makeSpiderEmblemTexture(), transparent:true, roughness:0.5, metalness:0.05
});

export const spidermanGroup = new THREE.Group();
spidermanGroup.name = 'SpidermanBlocker';

{
  // head (big round chibi head, web-patterned)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 20), headMat);
  head.position.set(0, 1.05, 0);
  head.castShadow = true;
  spidermanGroup.add(head);

  // eye lenses (white, black rim) — angled like the toy's expressive eyes
  function makeEye(x, angle){
    const grp = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.SphereGeometry(0.26,16,12), lensRimMat);
    rim.scale.set(1,1.3,0.4);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.185,16,12), lensMat);
    lens.scale.set(1,1.3,0.5);
    lens.position.z = 0.05;
    grp.add(rim, lens);
    grp.position.set(x, 1.1, 0.52);
    grp.rotation.z = angle;
    return grp;
  }
  spidermanGroup.add(makeEye(-0.24, 0.18));
  spidermanGroup.add(makeEye(0.24, -0.18));

  // torso
  const torso = makeCapsule(0.34, 0.45, suitMat);
  torso.position.set(0, 0.42, 0);
  torso.castShadow = true;
  spidermanGroup.add(torso);

  // chest emblem
  const emblem = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.46), emblemMat);
  emblem.position.set(0, 0.46, 0.36);
  spidermanGroup.add(emblem);

  // arms — one reaching out, one bent, echoing the keychain's dynamic pose
  function makeArm(side){
    const grp = new THREE.Group();
    const upper = makeCapsule(0.11, 0.32, suitMat);
    upper.position.set(0, -0.16, 0);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), limbRedMat);
    hand.position.set(0, -0.36, 0);
    grp.add(upper, hand);
    grp.position.set(side*0.42, 0.68, 0);
    return grp;
  }
  const armL = makeArm(-1);
  armL.rotation.z = 0.9;   // reaching outward/up
  const armR = makeArm(1);
  armR.rotation.z = -0.4;  // bent in
  spidermanGroup.add(armL, armR);

  // legs — bent, mid-tumble pose like the reference photos
  function makeLeg(side){
    const grp = new THREE.Group();
    const upper = makeCapsule(0.135, 0.34, suitMat);
    upper.position.set(0, -0.17, 0);
    const boot = makeCapsule(0.14, 0.18, limbRedMat);
    boot.rotation.z = Math.PI/2;
    boot.position.set(0.05, -0.4, 0.05);
    grp.add(upper, boot);
    grp.position.set(side*0.18, 0.08, 0);
    return grp;
  }
  const legL = makeLeg(-1);
  legL.rotation.x = 0.5;
  const legR = makeLeg(1);
  legR.rotation.x = -0.3;
  spidermanGroup.add(legL, legR);

  spidermanGroup.traverse(o=>{ if(o.isMesh){ o.castShadow = true; } });
}

// Sits on the landing (the "welcome" step — no laser/LDR there) by default.
// x=0 matches the landing platform's own center (see landing.position.set(0,...)
// in staircase.js) so he's centered left-right, not offset toward one side.
const WELCOME_POS = new THREE.Vector3(0, 1.0, -6.5);
spidermanGroup.position.copy(WELCOME_POS);
spidermanGroup.scale.setScalar(2.4); // toy-proportioned but visible against the full rig
rig.add(spidermanGroup);

const targetPos = new THREE.Vector3().copy(spidermanGroup.position);
let bobPhase = Math.random()*Math.PI*2;

// Picks the lowest-indexed step whose beam is currently broken, or null.
function firstBrokenStep(brokenFlags){
  for(let i=0;i<NUM_STEPS;i++){ if(brokenFlags[i]) return i; }
  return null;
}

export function updateSpiderman(brokenFlags, dt){
  const step = firstBrokenStep(brokenFlags);
  if(step === null){
    targetPos.copy(WELCOME_POS);
    spidermanGroup.rotation.y = 0;
  } else {
    const beamMid = beamsByStep[step].beamMidLocal;
    targetPos.set(beamMid.x, beamMid.y - 0.15, beamMid.z);
    spidermanGroup.rotation.y = Math.PI/2; // lie across the beam, spanning left-right
  }
  // smooth glide between spots rather than teleporting
  spidermanGroup.position.lerp(targetPos, Math.min(1, dt*4));
  bobPhase += dt*2.2;
  spidermanGroup.position.y += Math.sin(bobPhase)*0.02;
}
