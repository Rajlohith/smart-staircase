// ---------------------------------------------------------------
// MATERIALS
// ---------------------------------------------------------------
export const boardMat = new THREE.MeshStandardMaterial({ color:0xf3f3f0, roughness:0.85, metalness:0.02 });
export const boardEdgeMat = new THREE.MeshStandardMaterial({ color:0xe7e7e2, roughness:0.9 });
export const pcbBlackMat = new THREE.MeshStandardMaterial({ color:0x14151a, roughness:0.4, metalness:0.3 });
export const pcbBlueMat  = new THREE.MeshStandardMaterial({ color:0x1c4fb0, roughness:0.35, metalness:0.25 });
export const goldMat = new THREE.MeshStandardMaterial({ color:0xc9993f, roughness:0.3, metalness:0.85 });
export const potMat = new THREE.MeshStandardMaterial({ color:0x2a63c9, roughness:0.4, metalness:0.2 });
export const speakerBodyMat = new THREE.MeshStandardMaterial({ color:0x121212, roughness:0.55, metalness:0.1 });
export const speakerConeMat = new THREE.MeshStandardMaterial({ color:0x2b2b2b, roughness:0.6 });

export function ledMaterial(){
  return new THREE.MeshStandardMaterial({
    color:0x1a1a1a, emissive:0x062b26, emissiveIntensity:0.15, roughness:0.5, metalness:0.2
  });
}
