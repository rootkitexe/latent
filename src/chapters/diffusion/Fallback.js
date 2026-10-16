'use client'

import { useEffect, useRef } from 'react';
import { alphaBar, rng } from './schedule';
import { buildTarget } from './targets';

/** No-WebGL fallback: the same forward process, drawn once as a 2D strip x₀ → x_T. */
export default function Fallback() {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let alive = true;
    const N = 9000;
    buildTarget('hand', N, 1).then(({ pos }) => {
      if (!alive) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth, H = c.clientHeight;
      c.width = W * dpr; c.height = H * dpr;
      const g = c.getContext('2d');
      g.scale(dpr, dpr);
      const ts = [0, 250, 500, 750, 1000];
      const cw = W / ts.length;
      const R = rng(9);
      const eps = new Float32Array(N * 2).map(() => R.normal());
      ts.forEach((t, k) => {
        const ab = alphaBar(t), sa = Math.sqrt(ab), sb = Math.sqrt(1 - ab);
        const cx = cw * (k + 0.5), cy = H * 0.45, sc = Math.min(cw, H) * 0.26;
        g.fillStyle = 'rgba(11,11,13,0.55)';
        for (let i = 0; i < N; i++) {
          const x = (sa * pos[i * 3] * 1.8 + sb * eps[i * 2]) / 1.8, y = (sa * pos[i * 3 + 1] * 1.8 + sb * eps[i * 2 + 1]) / 1.8;
          g.fillRect(cx + x * sc, cy - y * sc, 1.2, 1.2);
        }
        g.fillStyle = 'rgba(11,11,13,0.5)';
        g.font = '500 10px ui-monospace, monospace';
        g.textAlign = 'center';
        g.fillText(`t = ${t} · ᾱ = ${ab.toFixed(3)}`, cx, H - 8);
      });
    });
    return () => { alive = false; };
  }, []);
  return <canvas ref={ref} className="absolute left-0 top-[52%] h-[26%] w-full md:left-auto md:right-0 md:top-[30%] md:h-[38%] md:w-[58%]" aria-label="A hand dissolving into noise across five timesteps" role="img" />;
}
