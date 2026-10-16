'use client'

import { sim } from '@/chapters/input/sim';

/** Shared, mutable finale state (hovered layer for the 3D stack) and what the network "outputs". */
export const finale = {
  hover: -1,
  outputText() {
    const t = (sim.typed || '').replace(/\s+/g, ' ').trim();
    if (t.length >= 2) return t.slice(-14).toUpperCase();
    return 'HELLO, WORLD';
  },
};
