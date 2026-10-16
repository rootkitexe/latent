'use client'

import { create } from 'zustand';

/* ------------------------------------------------------------------------------------------------
 * The neuron's real math. Everything on screen (liquid level, curve bead, firing, plane, accuracy)
 * is computed from these few numbers.
 * ---------------------------------------------------------------------------------------------- */

export const ACTS = {
  step: { id: 'step', name: 'Step', sym: 'step', fn: (z) => (z > 0 ? 1 : 0), formula: 'step(z) = 1 if z > 0, else 0' },
  sigmoid: { id: 'sigmoid', name: 'Sigmoid', sym: 'σ', fn: (z) => 1 / (1 + Math.exp(-z)), formula: 'σ(z) = 1 / (1 + e^−z)' },
  tanh: { id: 'tanh', name: 'Tanh', sym: 'tanh', fn: (z) => Math.tanh(z), formula: 'tanh(z) = (e^z − e^−z) / (e^z + e^−z)' },
  relu: { id: 'relu', name: 'ReLU', sym: 'ReLU', fn: (z) => Math.max(0, z), formula: 'ReLU(z) = max(0, z)' },
};
export const ACT_LIST = ['step', 'sigmoid', 'tanh', 'relu'];
export const ACT_INDEX = { step: 0, sigmoid: 1, tanh: 2, relu: 3 };

export const W_RANGE = 3;
export const B_RANGE = 3;

export const dot = (w, x, b) => w[0] * x[0] + w[1] * x[1] + w[2] * x[2] + b;

/* Deterministic PRNG so the dataset is the same for everyone. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Two classes in the unit cube, separable by a hidden plane (normal TRUE_W). Label 1 = "should fire"
 * (orange), 0 = "stay quiet" (ice). A small margin keeps it learnable by the perceptron rule.
 */
const TRUE_W = [1.3, 1.0, -0.9];
const TRUE_B = -0.7;
export const N_POINTS = 140;
export const DATA = (() => {
  const r = mulberry32(7);
  const pts = [];
  const len = Math.hypot(...TRUE_W);
  let tries = 0;
  while (pts.length < N_POINTS && tries < 20000) {
    tries++;
    const want = pts.length % 2; // alternate classes
    // cluster centres either side of the plane
    const c = want ? [0.68, 0.66, 0.36] : [0.32, 0.34, 0.64];
    const p = c.map((v) => v + gauss(r) * 0.17);
    if (p.some((v) => v < 0.03 || v > 0.97)) continue;
    const s = dot(TRUE_W, p, TRUE_B) / len;
    if (Math.abs(s) < 0.05) continue;
    const label = s > 0 ? 1 : 0;
    if (label !== want) continue;
    pts.push({ p, label });
  }
  return pts;
})();

export function accuracy(w, b) {
  let ok = 0;
  for (const d of DATA) if ((dot(w, d.p, b) > 0 ? 1 : 0) === d.label) ok++;
  return ok;
}

const clampW = (v) => Math.max(-W_RANGE, Math.min(W_RANGE, v));
const clampB = (v) => Math.max(-B_RANGE, Math.min(B_RANGE, v));

export const INITIAL = { x: [0.9, 0.2, 0.5], w: [0.8, -0.4, 1.2], b: -0.3 };

export const useNeuron = create((set, get) => ({
  x: [...INITIAL.x],
  w: [...INITIAL.w],
  b: INITIAL.b,
  act: 'sigmoid',
  prevAct: 'sigmoid',
  actChangedAt: 0,
  step: 0,
  learning: false,
  epoch: 0,
  probe: -1, // index of data point feeding the inputs (step 5)
  mistakes: [],
  setX: (i, v) => set((s) => { const x = [...s.x]; x[i] = Math.max(0, Math.min(1, v)); return { x, probe: -1 }; }),
  setW: (i, v) => set((s) => { const w = [...s.w]; w[i] = clampW(v); return { w }; }),
  setB: (v) => set({ b: clampB(v) }),
  setAct: (act) => set((s) => (s.act === act ? {} : { act, prevAct: s.act, actChangedAt: performance.now() })),
  setStep: (step) => set({ step }),
  setProbe: (i) => set(i < 0 ? { probe: -1 } : { probe: i, x: [...DATA[i].p] }),
  reset: () => set({ x: [...INITIAL.x], w: [...INITIAL.w], b: INITIAL.b, epoch: 0, learning: false, probe: -1 }),
  scramble: () => {
    const r = Math.random;
    set({ w: [r() * 4 - 2, r() * 4 - 2, r() * 4 - 2].map((v) => +v.toFixed(2)), b: +(r() * 2 - 1).toFixed(2), epoch: 0, learning: false });
  },
  setLearning: (learning) => set({ learning }),
  /** One epoch of the perceptron learning rule: for every mistake, w ← w + η(y − ŷ)x, b ← b + η(y − ŷ). */
  learnEpoch: (order) => {
    const s = get();
    const lr = 0.12;
    const w = [...s.w];
    let b = s.b;
    let errs = 0;
    for (const i of order) {
      const d = DATA[i];
      const yhat = dot(w, d.p, b) > 0 ? 1 : 0;
      const e = d.label - yhat;
      if (e !== 0) {
        errs++;
        for (let k = 0; k < 3; k++) w[k] = clampW(w[k] + lr * e * d.p[k]);
        b = clampB(b + lr * e);
      }
    }
    set({ w: w.map((v) => +v.toFixed(3)), b: +b.toFixed(3), epoch: s.epoch + 1 });
    return errs;
  },
}));

/** Diverging scale frost (#5C7CFA) → #1A1B20 → signal (#FF4F1F), t in -1..1. Writes into out[3] (linear-ish 0..1 sRGB). */
const FROST = [0x5c / 255, 0x7c / 255, 0xfa / 255];
const MID = [0x1a / 255, 0x1b / 255, 0x20 / 255];
const SIG = [0xff / 255, 0x4f / 255, 0x1f / 255];
export function diverging(t, out) {
  const a = Math.max(-1, Math.min(1, t));
  const src = a < 0 ? FROST : SIG;
  const k = Math.abs(a);
  out[0] = MID[0] + (src[0] - MID[0]) * k;
  out[1] = MID[1] + (src[1] - MID[1]) * k;
  out[2] = MID[2] + (src[2] - MID[2]) * k;
  return out;
}
export const divergingCss = (t) => {
  const c = diverging(t, [0, 0, 0]);
  return `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;
};

export const fmt = (v, d = 2) => {
  const s = Math.abs(v) < 0.5 * Math.pow(10, -d) ? (0).toFixed(d) : v.toFixed(d);
  return s.replace('-', '−');
};
