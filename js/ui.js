import { connectPhysical, sendDoorCommand } from './network.js';
import { setAnnounceMode } from './audio.js';

export function initModeToggle(){
  const btnNumbers = document.getElementById('modeNumbers');
  const btnMusic = document.getElementById('modeMusic');
  function select(mode){
    setAnnounceMode(mode);
    btnNumbers.classList.toggle('active', mode==='numbers');
    btnMusic.classList.toggle('active', mode==='music');
  }
  btnNumbers.addEventListener('click', ()=>select('numbers'));
  btnMusic.addEventListener('click', ()=>select('music'));
  select('numbers'); // default: spoken numbers, same as the original behavior
}

export function initPhysicalLink(){
  document.getElementById('btnPhysicalConnect').addEventListener('click', connectPhysical);
}

// ---------------------------------------------------------------
// VIRTUAL → REAL door control (two-way link)
// Buttons start disabled and are only enabled once network.js confirms a
// live WebSocket connection to the rig (see setDoorButtonsEnabled there).
// ---------------------------------------------------------------
export function initDoorControls(){
  document.getElementById('btnDoorOpen').addEventListener('click', ()=> sendDoorCommand('door_open'));
  document.getElementById('btnDoorClose').addEventListener('click', ()=> sendDoorCommand('door_close'));
  document.getElementById('btnDoorAuto').addEventListener('click', ()=> sendDoorCommand('door_auto'));
}

// ---------------------------------------------------------------
// PWA install prompt
// ---------------------------------------------------------------
export function initInstallPrompt(){
  const btn = document.getElementById('installBtn');
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.style.display = 'block';
  });
  btn.addEventListener('click', async () => {
    if(!deferredPrompt) return;
    btn.style.display = 'none';
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });
  window.addEventListener('appinstalled', () => { btn.style.display = 'none'; });
}
