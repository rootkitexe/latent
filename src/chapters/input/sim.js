'use client'

/**
 * The hero's leaky integrate-and-fire neuron. Shared between the WebGL scene (pulses) and the DOM
 * overlay (readouts, membrane trace). Mutable module state, read in rAF loops — no React renders.
 *
 *   dV/dt = −V / τ  (leak)        each input that reaches the soma adds a weighted step to V
 *   V ≥ θ  →  spike: an action potential runs down the axon, V resets
 */
export const MAX_PULSES = 24;
export const TAU = 1.6;          // membrane time constant (s)
export const THRESHOLD = 1.0;
export const TRAVEL = 0.75;      // seconds for a dendritic pulse to reach the soma

export const sim = {
  V: 0,
  spikes: 0,
  typed: '',                    // everything the visitor typed into the hero (read by the finale)
  inputs: 0,
  lastSpike: -10,
  time: 0,
  // pulses: { t0, branch (0..1), kind 0=dendrite 1=axon, w (weight), arrived }
  pulses: [],
  trace: new Float32Array(160), // recent V for the oscilloscope
  traceHead: 0,
  listeners: new Set(),         // fired on spike
  project: null,                // set by the scene: (branch) => {x, y} screen px of a dendrite tip
};

export function stimulate(branch = Math.random(), w = 0.22 + Math.random() * 0.12) {
  sim.pulses.push({ t0: sim.time, branch, kind: 0, w, arrived: false });
  if (sim.pulses.length > MAX_PULSES) sim.pulses.shift();
  return branch;
}

export function step(dt) {
  sim.time += dt;
  sim.V *= Math.exp(-dt / TAU);
  for (const p of sim.pulses) {
    if (p.kind === 0 && !p.arrived && sim.time - p.t0 >= TRAVEL) {
      p.arrived = true;
      sim.V += p.w;
    }
  }
  if (sim.V >= THRESHOLD) {
    sim.V = 0;
    sim.spikes += 1;
    sim.lastSpike = sim.time;
    sim.pulses.push({ t0: sim.time, branch: 0.93, kind: 1, w: 1, arrived: true });
    if (sim.pulses.length > MAX_PULSES) sim.pulses.shift();
    sim.listeners.forEach((f) => f());
  }
  // forget old pulses
  sim.pulses = sim.pulses.filter((p) => sim.time - p.t0 < 4);
  sim.trace[sim.traceHead] = sim.time - sim.lastSpike < 0.05 ? 1.6 : sim.V;
  sim.traceHead = (sim.traceHead + 1) % sim.trace.length;
}
