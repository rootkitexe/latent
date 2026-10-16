'use client'

import { useMemo } from 'react';
import { tokenize, attention } from './model';

/** Static (no-WebGL) version: the sentence as chips with the coreference head's arcs from "it", in SVG. */
export default function Fallback() {
  const { toks, row, q } = useMemo(() => {
    const toks = tokenize(null, "The animal didn't cross the street because it was too tired");
    const att = attention(toks);
    const q = toks.findIndex((t) => t.text === 'it');
    return { toks, row: att.coref.weights[q], q };
  }, []);
  const W = 1000;
  const step = W / toks.length;
  const x = (i) => step * i + step / 2;
  return (
    <div className="absolute inset-0 grid place-items-center px-6">
      <svg viewBox={`0 0 ${W} 300`} className="w-full max-w-[1100px]" role="img" aria-label="The word it attends mostly to animal">
        {row.map((w, j) =>
          j === q || w < 0.02 ? null : (
            <path key={j} d={`M${x(q)} 200 C ${x(q)} ${200 - 60 - Math.abs(j - q) * 18}, ${x(j)} ${200 - 60 - Math.abs(j - q) * 18}, ${x(j)} 200`}
              fill="none" stroke="#FF4F1F" strokeOpacity={0.25 + w * 0.75} strokeWidth={1 + w * 8} />
          )
        )}
        {toks.map((t, i) => (
          <g key={i}>
            <rect x={x(i) - step / 2 + 4} y={204} width={step - 8} height={48} rx={6} fill="#0E0F12" stroke={i === q ? '#FF4F1F' : 'rgba(168,240,255,0.25)'} />
            <text x={x(i)} y={234} textAnchor="middle" fill="#E6EBF2" fontSize="15" fontFamily="var(--font-mono)">{t.text}</text>
            {i !== q && row[i] > 0.05 && <text x={x(i)} y={272} textAnchor="middle" fill="#FFB38A" fontSize="12" fontFamily="var(--font-mono)">{row[i].toFixed(2)}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}
