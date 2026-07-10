// ---------------------------------------------------------------
// Sensor / event log panel
// ---------------------------------------------------------------
export function logRaw(text){
  const list = document.getElementById('logList');
  const div = document.createElement('div');
  const t = new Date().toLocaleTimeString('en-US',{hour12:false});
  div.innerHTML = `<span>[${t}]</span> ${text}`;
  list.prepend(div);
  while(list.children.length > 60) list.removeChild(list.lastChild);
}

// Every field the rig reports, tagged as SENSOR (input) or ACTUATOR (output)
// with a friendly label, so the log reads clearly instead of raw JSON keys.
export const FIELD_INFO = {
  ldr1:    { label:'LDR 1 · beam sensor (Step 1)', kind:'SENSOR',   onColor:'#ffd23f' },
  ldr2:    { label:'LDR 2 · beam sensor (Step 2)', kind:'SENSOR',   onColor:'#ffd23f' },
  ldr3:    { label:'LDR 3 · beam sensor (Step 3)', kind:'SENSOR',   onColor:'#ffd23f' },
  strip7:  { label:'Strip 7 · blue LEDs (Step 1)', kind:'ACTUATOR', onColor:'#3a6bf2' },
  strip5:  { label:'Strip 5 · red LEDs (Step 2)',  kind:'ACTUATOR', onColor:'#ff4444' },
  strip9:  { label:'Strip 9 · white LEDs (Step 3)',kind:'ACTUATOR', onColor:'#e8e8e8' },
  strip6:  { label:'Strip 6 · green LEDs (idle)',  kind:'ACTUATOR', onColor:'#21e6c1' },
  speaker: { label:'Speaker · Talkie voice',       kind:'ACTUATOR', onColor:'#c58cff' }
};

export function logFieldChange(key, state){
  const info = FIELD_INFO[key];
  const list = document.getElementById('logList');
  const div = document.createElement('div');
  const t = new Date().toLocaleTimeString('en-US',{hour12:false});
  const color = state ? info.onColor : '#5a6274';
  const stateText = state ? 'ON' : 'OFF';
  div.innerHTML = `<span>[${t}]</span> <span style="color:${color};font-weight:700;">${info.kind}</span> ${info.label} → <b style="color:${color}">${stateText}</b>`;
  list.prepend(div);
  while(list.children.length > 60) list.removeChild(list.lastChild);
}
