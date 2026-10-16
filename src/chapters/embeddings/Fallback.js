'use client'

/** Static fallback for devices without WebGL: the famous analogy, as a diagram. */
export default function Fallback() {
  const pts = [
    { w: 'man', x: 22, y: 70 },
    { w: 'woman', x: 52, y: 78 },
    { w: 'king', x: 30, y: 32 },
    { w: 'queen', x: 60, y: 40, hot: true },
  ];
  return (
    <div className="absolute inset-0 grid place-items-center bg-void">
      <svg viewBox="0 0 100 100" className="h-[min(70vh,90vw)] w-[min(70vh,90vw)] opacity-90" role="img" aria-label="King minus man plus woman lands on queen: the step from man to woman matches the step from king to queen.">
        <defs>
          <marker id="emb-ah" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#a8f0ff" /></marker>
        </defs>
        <line x1="22" y1="70" x2="52" y2="78" stroke="#a8f0ff" strokeWidth="0.5" markerEnd="url(#emb-ah)" />
        <line x1="30" y1="32" x2="60" y2="40" stroke="#a8f0ff" strokeWidth="0.5" markerEnd="url(#emb-ah)" />
        <line x1="22" y1="70" x2="30" y2="32" stroke="#5c7cfa" strokeWidth="0.3" strokeDasharray="1 1" />
        <line x1="52" y1="78" x2="60" y2="40" stroke="#5c7cfa" strokeWidth="0.3" strokeDasharray="1 1" />
        {pts.map((p) => (
          <g key={p.w}>
            <circle cx={p.x} cy={p.y} r={p.hot ? 1.6 : 1.1} fill={p.hot ? '#ff4f1f' : '#e8f4ff'} />
            <text x={p.x + 2.5} y={p.y + 1} fill="#fff" fontSize="3.2" fontFamily="monospace">{p.w}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
