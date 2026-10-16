'use client'

/**
 * Opt-in generative sound. Nothing plays until the visitor turns sound on (HUD toggle).
 *  - a low drone whose filter opens with page depth (setDepth 0..1)
 *  - playBlip(pitch 0..1, gain 0..1): a short glassy tick for activations / UI
 *  - playChord(): a soft three-note bloom for big moments
 */
let ctx = null;
let master = null;
let droneFilter = null;
let enabled = false;

const scale = [0, 2, 3, 7, 9, 12, 14, 15, 19, 21, 24]; // minor-pentatonic-ish, in semitones
const noteHz = (n) => 110 * Math.pow(2, n / 12);

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);

  // Drone: two detuned saws + a sine sub through a slow low-pass.
  droneFilter = ctx.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 220;
  droneFilter.Q.value = 4;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.06;
  droneFilter.connect(droneGain).connect(master);
  [[55, 'sawtooth', -7], [55, 'sawtooth', 6], [27.5, 'sine', 0]].forEach(([f, type, det]) => {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = f; o.detune.value = det;
    o.connect(droneFilter); o.start();
  });
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.07; lfoGain.gain.value = 60;
  lfo.connect(lfoGain).connect(droneFilter.frequency); lfo.start();
  return ctx;
}

export function setSoundEnabled(on) {
  enabled = on;
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') c.resume();
  master.gain.cancelScheduledValues(c.currentTime);
  master.gain.setTargetAtTime(on ? 0.9 : 0, c.currentTime, 0.4);
}

export function setDepth(d) {
  if (!ctx || !enabled) return;
  droneFilter.frequency.setTargetAtTime(180 + d * 900, ctx.currentTime, 0.5);
}

export function playBlip(pitch = 0.5, gain = 0.5) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  const n = scale[Math.max(0, Math.min(scale.length - 1, Math.round(pitch * (scale.length - 1))))];
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = noteHz(n + 24);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.08 * gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 0.4);
}

export function playChord() {
  if (!ctx || !enabled) return;
  [0, 7, 15].forEach((n, i) => setTimeout(() => playBlip((scale.indexOf(n) + 2) / scale.length, 0.8), i * 70));
}
