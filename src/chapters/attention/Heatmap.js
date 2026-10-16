'use client'

import { useEffect, useRef } from 'react';
import { HEADS } from './model';

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** One attention matrix drawn on a 2D canvas. Rows = query (the token asking), cols = key. */
function Matrix({ weights, color, q, mask, size, onRow, label, tokens }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !weights) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const n = weights.length;
    const cell = size / Math.max(1, n);
    const [r, g, b] = rgb(color);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const w = weights[i][j];
        if (mask && j > i) {
          ctx.fillStyle = 'rgba(255,255,255,0.025)';
          ctx.fillRect(j * cell + 0.5, i * cell + 0.5, cell - 1, cell - 1);
          continue;
        }
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.max(0.035, Math.pow(w, 0.6))})`;
        ctx.fillRect(j * cell + 0.5, i * cell + 0.5, cell - 1, cell - 1);
      }
    }
    if (q != null && q < n) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, q * cell + 0.5, size - 1, cell - 1);
    }
  }, [weights, color, q, mask, size]);
  const move = (e) => {
    if (!onRow || !weights) return;
    const rct = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientY - rct.top) / rct.height) * weights.length);
    if (i >= 0 && i < weights.length) onRow(i);
  };
  return (
    <div>
      <canvas
        ref={ref}
        style={{ width: size, height: size }}
        className="block rounded-[4px] bg-[#0a0b0e]"
        onPointerMove={move}
        onPointerLeave={() => onRow && onRow(null)}
        role="img"
        aria-label={`${label} attention matrix for ${tokens.length} tokens`}
        data-cursor="Row"
      />
      {label && <div className="hud mt-1.5 !text-[9px]" style={{ color }}>{label}</div>}
    </div>
  );
}

export default function Heatmap({ att, head, q, mask, tokens, onRow, size = 196 }) {
  if (!att) return null;
  if (head === 'all') {
    const s = Math.floor((size - 10) / 2);
    return (
      <div className="grid grid-cols-2 gap-2.5">
        {HEADS.map((h) => (
          <Matrix key={h.id} weights={att[h.id].weights} color={h.color} q={q} mask={mask} size={s} onRow={onRow} label={h.name} tokens={tokens} />
        ))}
      </div>
    );
  }
  const h = HEADS.find((x) => x.id === head);
  return <Matrix weights={att[head].weights} color={h.color} q={q} mask={mask} size={size} onRow={onRow} tokens={tokens} />;
}
