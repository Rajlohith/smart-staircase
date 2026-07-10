// ---------------------------------------------------------------
// CONFIG — dimensions mirror the physical build (units = cm)
// ---------------------------------------------------------------
export const STEP_WIDTH   = 20;
export const TREAD_DEPTH  = 15.2;
export const TREAD_THICK  = 0.6;
export const RISER_HEIGHT = 4;
export const NUM_STEPS    = 3;
export const DOOR_STEP    = NUM_STEPS - 1; // step 3 — the door/servo step

// The last riser (the one with the door behind it) is scaled to HALF the
// height of a normal riser, per request. Every other riser keeps RISER_HEIGHT.
export const DOOR_RISER_HEIGHT = RISER_HEIGHT / 2;

export const NOTES = [261.63, 392.00, 523.25]; // C4 G4 C5 - matches the 3 physical steps
export const ACCENT = 0x21e6c1;

// Per-step riser height helper (only the door step is shrunk)
export function riserHeightFor(stepIndex){
  return stepIndex === DOOR_STEP ? DOOR_RISER_HEIGHT : RISER_HEIGHT;
}

// Cumulative tread-top height helper (accounts for the shrunk last riser)
export function topYFor(stepIndex){
  let y = 0;
  for(let i=0;i<=stepIndex;i++) y += riserHeightFor(i);
  return y;
}
