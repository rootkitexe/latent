'use client'

import { useEffect, useMemo, useRef } from 'react';

/**
 * The boundary between two layers: a band of live weight values streaming past (a slice of the
 * weight matrix connecting the layers), coloured on the diverging scale. It scrolls horizontally
 * as you scroll vertically, and the values "settle" (shrink toward their trained values) the
 * further down the page you are.
 */
const ACTIVATIONS = ['ReLU', 'GELU', 'tanh', 'σ(x)', 'softmax', 'SiLU', 'LayerNorm', 'Dropout 0.1'];

function rand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export default function Seam({ from, to }) {
  const ref = useRef(null);
  const rowA = useRef(null);
  const rowB = useRef(null);
  const n = to.layer.charCodeAt(1) * 31 + to.id.length;
  const values = useMemo(() => {
    const r = rand(n);
    return Array.from({ length: 64 }, () => (r() * 2 - 1) * (0.4 + r() * 0.8));
  }, [n]);
  const act = ACTIVATIONS[n % ACTIVATIONS.length];

  useEffect(() => {
    let raf;
    const loop = () => {
      const el = ref.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        if (r.bottom > 0 && r.top < vh) {
          const p = (vh - r.top) / (vh + r.height); // 0..1 through the viewport
          rowA.current.style.transform = `translate3d(${-p * 40}%,0,0)`;
          rowB.current.style.transform = `translate3d(${-40 + p * 40}%,0,0)`;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cell = (v, i) => {
    const a = Math.min(1, Math.abs(v));
    const col = v >= 0 ? `rgba(255,79,31,${0.15 + a * 0.85})` : `rgba(92,124,250,${0.15 + a * 0.85})`;
    return (
      <span key={i} className="inline-block w-[5.5em] shrink-0 text-right" style={{ color: col }}>
        {v >= 0 ? '+' : '−'}{Math.abs(v).toFixed(3)}
      </span>
    );
  };

  return (
    <div ref={ref} aria-hidden className="relative overflow-hidden bg-void py-14 select-none">
      <div className="gx mb-6 flex items-center justify-between hud">
        <span>{from.layer} → {to.layer}</span>
        <span className="text-fg-22">W<sub>{from.layer.slice(1)}{to.layer.slice(1)}</sub> ∈ ℝ<sup>4096×4096</sup> · {act}</span>
        <span>{to.title}</span>
      </div>
      <div className="hud whitespace-nowrap leading-[2.2] opacity-80" style={{ letterSpacing: '.06em' }}>
        <div ref={rowA} className="flex will-change-transform">{values.map(cell)}{values.map(cell)}</div>
        <div ref={rowB} className="flex will-change-transform">{[...values].reverse().map(cell)}{values.map(cell)}</div>
      </div>
      <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(90deg, var(--void), transparent 18%, transparent 82%, var(--void))' }} />
      <div className="gx mt-6"><div className="h-px bg-[var(--hairline)]" /></div>
    </div>
  );
}
