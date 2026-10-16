'use client'

import { useEffect, useRef, useState } from 'react';
import { live, useStore } from '@/lib/store';

/**
 * "Initializing weights". A grid of random numbers that settle into zeros row by row while a counter
 * runs 000 → 100, then the grid collapses into a single orange point (the first activation) and the
 * page is revealed. Once per session.
 */
const COLS = 12;
const ROWS = 8;

export default function Preloader() {
  const setLoaded = useStore((s) => s.setLoaded);
  const [gone, setGone] = useState(false);
  const [exiting, setExiting] = useState(false);
  const grid = useRef(null);
  const count = useRef(null);

  useEffect(() => {
    if (live.nopre || sessionStorage.getItem('latent-pre') === '1') {
      setLoaded(true);
      setGone(true);
      return;
    }
    const cells = grid.current.children;
    const start = performance.now();
    const DUR = 2300;
    let raf;
    const loop = (t) => {
      const p = Math.min(1, (t - start) / DUR);
      const e = 1 - Math.pow(1 - p, 3);
      count.current.textContent = String(Math.round(e * 100)).padStart(3, '0');
      for (let i = 0; i < cells.length; i++) {
        const settle = Math.min(1, Math.max(0, e * 1.6 - (i / cells.length) * 0.6));
        const v = (Math.random() * 2 - 1) * (1 - settle);
        cells[i].textContent = (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
        cells[i].style.color = settle >= 1 ? 'rgba(255,255,255,.18)' : v >= 0 ? 'rgba(255,79,31,.9)' : 'rgba(168,240,255,.75)';
      }
      if (p < 1) raf = requestAnimationFrame(loop);
      else {
        setExiting(true);
        setTimeout(() => {
          setLoaded(true);
          try { sessionStorage.setItem('latent-pre', '1'); } catch {}
        }, 650);
        setTimeout(() => setGone(true), 1500);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [setLoaded]);

  if (gone) return null;
  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-void transition-[clip-path] duration-[900ms] ease-expo"
      style={{ clipPath: exiting ? 'circle(0% at 50% 50%)' : 'circle(150% at 50% 50%)', transitionDelay: exiting ? '350ms' : '0ms' }}
    >
      <div className="flex flex-col items-center">
        <div
          ref={grid}
          className="hud grid gap-x-4 gap-y-1 transition-all duration-500 ease-expo"
          style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, opacity: exiting ? 0 : 1, transform: exiting ? 'scale(.92)' : 'none' }}
          aria-hidden
        >
          {Array.from({ length: COLS * ROWS }, (_, i) => <span key={i} className="text-right">+0.00</span>)}
        </div>
        <div className="mt-10 flex items-center gap-4 hud">
          <span className="h-1.5 w-1.5 rounded-full bg-signal" style={{ boxShadow: '0 0 12px var(--signal)' }} />
          <span>Initializing weights</span>
          <span ref={count} className="text-fg">000</span>
        </div>
      </div>
    </div>
  );
}
