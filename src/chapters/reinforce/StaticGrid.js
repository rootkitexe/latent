'use client'

import { useMemo } from 'react';
import { GridWorld, DEFAULT_MAP, mulberry, FLOOR, WALL, PIT, GOAL } from './rl';

/** gpuTier 0 fallback: the same Q-learning, trained once, drawn as a flat value map with policy arrows. */
export default function StaticGrid() {
  const cells = useMemo(() => {
    const w = new GridWorld(9, 9, mulberry(3));
    w.loadMap(DEFAULT_MAP);
    w.train(600);
    const out = [];
    for (let i = 0; i < w.n; i++) out.push({ i, k: w.tiles[i], v: w.maxQ(i), a: w.argmax(i), start: i === w.start });
    return out;
  }, []);
  const col = (v) => {
    const a = Math.min(1, Math.abs(v)) ** 0.75;
    const base = [26, 27, 32];
    const to = v >= 0 ? [255, 79, 31] : [92, 124, 250];
    return `rgb(${base.map((b, j) => Math.round(b + (to[j] - b) * a)).join(',')})`;
  };
  return (
    <div className="absolute inset-0 grid place-items-center md:justify-end md:pr-[24vw]">
      <svg viewBox="-2 -2 184 184" className="mt-24 w-[min(78vw,46vh)]" role="img" aria-label="A grid world after 600 episodes of Q-learning: tiles near the goal glow orange with high value, and arrows show the learned route.">
        {cells.map(({ i, k, v, a, start }) => {
          const x = (i % 9) * 20;
          const y = ((i / 9) | 0) * 20;
          const fill = k === WALL ? '#121318' : k === PIT ? '#06121a' : k === GOAL ? '#ff4f1f' : col(v);
          return (
            <g key={i} transform={`translate(${x} ${y})`}>
              <rect x="1" y="1" width="18" height="18" rx="2" fill={fill} stroke={k === PIT ? '#a8f0ff' : 'rgba(255,255,255,.08)'} strokeWidth={k === PIT ? 1 : 0.5} />
              {k === FLOOR && !start && v > 0.01 && (
                <path d="M10 5 L13.5 11 L6.5 11 Z" fill="rgba(255,255,255,.8)" transform={`rotate(${a * 90} 10 10)`} />
              )}
              {start && <circle cx="10" cy="10" r="3.5" fill="#dff9ff" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
