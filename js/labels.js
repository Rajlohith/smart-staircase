// ---------------------------------------------------------------
// SMALL HELPERS: dynamic + static floating text labels (canvas sprites)
// ---------------------------------------------------------------
function roundRectPath(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

export function makeDynamicLabel(scaleX, scaleY){
  const cvs = document.createElement('canvas');
  cvs.width = 320; cvs.height = 80;
  const ctx = cvs.getContext('2d');
  const tex = new THREE.CanvasTexture(cvs);
  const mat = new THREE.SpriteMaterial({ map:tex, transparent:true, opacity:0.96, depthTest:false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scaleX||11, scaleY||2.75, 1);
  sprite.visible = false;
  sprite.renderOrder = 999;
  sprite.userData.setText = function(text, color){
    ctx.clearRect(0,0,320,80);
    ctx.fillStyle = 'rgba(9,12,18,0.82)';
    roundRectPath(ctx,4,4,312,72,14); ctx.fill();
    ctx.strokeStyle = color || '#ff5a5a';
    ctx.lineWidth = 2;
    roundRectPath(ctx,4,4,312,72,14); ctx.stroke();
    ctx.font = '600 24px ui-monospace, monospace';
    ctx.fillStyle = color || '#ff5a5a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 160, 41);
    tex.needsUpdate = true;
  };
  return sprite;
}

export function makeLabelSprite(text){
  const cvs = document.createElement('canvas');
  cvs.width = 128; cvs.height = 64;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = 'rgba(10,13,19,0.0)';
  ctx.fillRect(0,0,128,64);
  ctx.font = '600 28px ui-monospace, monospace';
  ctx.fillStyle = '#21e6c1';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(cvs);
  const mat = new THREE.SpriteMaterial({ map:tex, transparent:true, opacity:0.85 });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(6,3,1);
  return sprite;
}
