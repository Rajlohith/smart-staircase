import { NOTES } from './config.js';
import { speechLabel } from './staircase.js';
import { logRaw } from './ui-log.js';

// ---------------------------------------------------------------
// AUDIO — tone generator
// ---------------------------------------------------------------
let audioCtx = null;
function ensureAudio(){
  if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state === 'suspended') audioCtx.resume();
}
export function playNote(freq){
  ensureAudio();
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.32, t0+0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0+1.0);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0+1.05);
}

// A short 3-note "musical stairs" phrase per step, instead of just the single
// sustained note, so switching to Music mode feels like an actual tune per
// step rather than one tone repeated.
const STAIR_TUNES = [
  [261.63, 329.63, 392.00],   // step 1 — C4 E4 G4
  [329.63, 392.00, 493.88],   // step 2 — E4 G4 B4
  [392.00, 493.88, 523.25],   // step 3 — G4 B4 C5
];
export function playStairTune(stepIndex){
  const notes = STAIR_TUNES[stepIndex] || [NOTES[stepIndex]];
  notes.forEach((freq, k)=> setTimeout(()=>playNote(freq), k*140));
}

// ---------------------------------------------------------------
// MODE: 'numbers' (spoken word per step, original behavior) vs
// 'music' (a little musical-stairs tune per step, no speech)
// ---------------------------------------------------------------
export let announceMode = 'numbers';
export function setAnnounceMode(mode){
  announceMode = mode;
}

let speechHideTimer = null;
function showSpeech(word){
  speechLabel.userData.setText('🔊 "' + word.toUpperCase() + '"', '#c58cff');
  speechLabel.visible = true;
  if(speechHideTimer) clearTimeout(speechHideTimer);
  speechHideTimer = setTimeout(()=>{ speechLabel.visible = false; }, 2400);
}
function showMusicBubble(stepIndex){
  speechLabel.userData.setText('🎵 STEP ' + (stepIndex+1) + ' TUNE', '#7ee6ff');
  speechLabel.visible = true;
  if(speechHideTimer) clearTimeout(speechHideTimer);
  speechHideTimer = setTimeout(()=>{ speechLabel.visible = false; }, 2400);
}

function speakWord(word){
  showSpeech(word);
  logRaw('SPEAKER · Talkie voice → “' + word.toUpperCase() + '”');
  if(!('speechSynthesis' in window)) return;
  try{
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.rate = 1.0;
    u.pitch = 0.85;
    window.speechSynthesis.speak(u);
  }catch(e){ /* speech synthesis unsupported/blocked, fail silently */ }
}

const NUMBER_WORDS = ['one','two','three'];

// Central entrypoint every step trigger (demo click OR live rig data) should
// call. Dispatches to spoken numbers or a musical-stairs tune per the toggle.
export function announceStep(stepIndex){
  if(announceMode === 'music'){
    playStairTune(stepIndex);
    showMusicBubble(stepIndex);
    logRaw('SPEAKER · Musical stairs → STEP ' + (stepIndex+1) + ' tune');
  } else {
    speakWord(NUMBER_WORDS[stepIndex] || String(stepIndex+1));
  }
}
