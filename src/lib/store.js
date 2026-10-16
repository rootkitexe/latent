'use client'

import { create } from 'zustand';

/**
 * Two layers of state:
 *  - `useStore` (zustand): reactive values React subscribes to.
 *  - `live`: a mutable object updated every frame by scroll/pointer listeners. Read it inside
 *    `useFrame` / rAF loops. It never triggers React renders.
 */
const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;

export const live = {
  scroll: 0,                 // page progress 0..1
  scrollY: 0,                // px
  velocity: 0,               // lenis velocity (px/frame-ish), signed
  pointer: { x: 0, y: 0 },   // normalized -1..1 (y up), viewport-relative
  pointerPx: { x: -100, y: -100 },
  pointerDown: false,
  chapters: {},              // id -> { progress 0..1, visible bool, near bool }
  active: 'input',           // id of the chapter filling most of the viewport
  hidden: false,
  idle: false,
  snap: !!q && q.get('snap') === '1',
  nopre: !!q && q.get('nopre') === '1',
};

/** Frame-lerp factor: returns 1 when `?snap=1` so screenshots settle instantly. */
export const damp = (k) => (live.snap ? 1 : k);

export const useStore = create((set) => ({
  loaded: false,             // preloader finished
  gpuTier: 2,                // 0 none/software, 1 mid, 2 high
  touch: false,
  reducedMotion: false,
  sound: false,
  active: 'input',           // mirrors live.active, for the HUD
  setLoaded: (loaded) => set({ loaded }),
  setDevice: (d) => set(d),
  setSound: (sound) => set({ sound }),
  setActive: (active) => set({ active }),
}));
