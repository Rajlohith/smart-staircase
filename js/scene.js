// ---------------------------------------------------------------
// SCENE / CAMERA / RENDERER / LIGHTS / ORBIT
// ---------------------------------------------------------------
export const container = document.getElementById('scene');
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d13);
scene.fog = new THREE.Fog(0x0a0d13, 70, 160);

export const camera = new THREE.PerspectiveCamera(38, window.innerWidth/window.innerHeight, 0.1, 1000);

export const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// LIGHTS
scene.add(new THREE.AmbientLight(0x8891a8, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(40, 70, 50);
key.castShadow = true;
key.shadow.mapSize.set(2048,2048);
key.shadow.camera.left = -60; key.shadow.camera.right = 60;
key.shadow.camera.top = 60; key.shadow.camera.bottom = -60;
scene.add(key);
const rim = new THREE.DirectionalLight(0x3a6bd9, 0.35);
rim.position.set(-60,30,-40);
scene.add(rim);

// faint blueprint floor grid
const grid = new THREE.GridHelper(160, 40, 0x1c2330, 0x151b26);
grid.position.y = -0.31;
scene.add(grid);
const floorMat = new THREE.MeshStandardMaterial({ color:0x0d1119, roughness:1 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(160,160), floorMat);
floor.rotation.x = -Math.PI/2;
floor.position.y = -0.32;
floor.receiveShadow = true;
scene.add(floor);

// ---------------------------------------------------------------
// CAMERA ORBIT (custom, no external deps)
// ---------------------------------------------------------------
export const clock = new THREE.Clock();
const orbitTarget = new THREE.Vector3(0, 0, 0);
let radius = 50, theta = 0.55, phi = 1.15;
let isDragging = false, lastX=0, lastY=0, dragMoved = false;

function updateCamera(){
  const x = orbitTarget.x + radius*Math.sin(phi)*Math.sin(theta);
  const y = orbitTarget.y + radius*Math.cos(phi);
  const z = orbitTarget.z + radius*Math.sin(phi)*Math.cos(theta);
  camera.position.set(x,y,z);
  camera.lookAt(orbitTarget);
}

export function setOrbitTarget(x,y,z){
  orbitTarget.set(x,y,z);
  updateCamera();
}

export function isCurrentlyDragging(){ return isDragging; }
export function wasDragMoved(){ return dragMoved; }

function pointerDown(x,y){ isDragging = true; dragMoved = false; lastX = x; lastY = y; }
function pointerMove(x,y){
  if(!isDragging) return;
  const dx = x-lastX, dy = y-lastY;
  if(Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
  theta -= dx*0.006;
  phi -= dy*0.006;
  phi = Math.max(0.35, Math.min(1.5, phi));
  lastX = x; lastY = y;
  updateCamera();
}
function pointerUp(){ isDragging = false; }

renderer.domElement.addEventListener('mousedown', e=>pointerDown(e.clientX,e.clientY));
window.addEventListener('mousemove', e=>pointerMove(e.clientX,e.clientY));
window.addEventListener('mouseup', pointerUp);
renderer.domElement.addEventListener('touchstart', e=>{ const t=e.touches[0]; pointerDown(t.clientX,t.clientY); }, {passive:true});
window.addEventListener('touchmove', e=>{ const t=e.touches[0]; pointerMove(t.clientX,t.clientY); }, {passive:true});
window.addEventListener('touchend', pointerUp);
renderer.domElement.addEventListener('wheel', e=>{
  radius += e.deltaY*0.05;
  radius = Math.max(16, Math.min(100, radius));
  updateCamera();
}, {passive:true});

updateCamera();
