'use client'

import { useEffect, useMemo, useRef, useState } from 'react';
import Chapter from '@/components/core/Chapter';
import ChapterCanvas from '@/components/core/ChapterCanvas';
import { useChapter } from '@/lib/chapter';
import { useStore } from '@/lib/store';
import { playBlip } from '@/lib/audio';
import { GridWorld, DEFAULT_MAP, WALL, PIT, GOAL, FLOOR, ARROWS, ACTION_NAMES } from './rl';
import { STEPS } from './copy';
import Scene from './Scene';
import StaticGrid from './StaticGrid';

const SPEEDS = [1, 4, 16];
const TOOLS = [
  { id: WALL, label: 'Wall', hint: 'blocks movement' },
  { id: PIT, label: 'Pit', hint: 'reward −1' },
  { id: GOAL, label: 'Goal', hint: 'reward +1' },
];
const KIND = ['floor', 'wall', 'pit (−1)', 'goal (+1)'];

const sgn = (v, d = 2) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
const nd = (v) => {
  const a = Math.abs(v);
  return (v < -0.0005 ? '−' : '') + (a >= 0.995 ? a.toFixed(1) : a.toFixed(2).replace(/^0\./, '.'));
};

function createSim(reduced) {
  const world = new GridWorld(9, 9);
  world.loadMap(DEFAULT_MAP);
  return {
    world,
    tool: WALL,
    playing: !reduced,
    speed: 1,
    mode: 'train',
    hover: -1,
    edits: 0,
    scrollStep: 0,
    ffPending: false,
    resetPending: false,
    stepOnce: false,
  };
}

function Slider({ id, label, sym, value, min, max, step, onChange, hint, highlight }) {
  return (
    <label htmlFor={id} className={`rl-slider block rounded-[10px] px-2 py-1.5 transition-colors duration-700 ${highlight ? 'rl-hl' : ''}`}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="hud whitespace-nowrap">{label}</span>
        <span className="hud whitespace-nowrap text-fg"><span className="normal-case">{sym}</span> {value.toFixed(2)}</span>
      </span>
      <input id={id} type="range" className="slider" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} aria-describedby={`${id}-hint`} />
      <span id={`${id}-hint`} className="sr-only">{hint}</span>
    </label>
  );
}

function Overlay({ sim, live3d = true }) {
  const { progress } = useChapter();
  const reduced = useStore((s) => s.reducedMotion);
  const [step, setStep] = useState(0);
  const [tool, setTool] = useState(WALL);
  const [eps, setEps] = useState(sim.world.eps);
  const [alpha, setAlpha] = useState(sim.world.alpha);
  const [gamma, setGamma] = useState(sim.world.gamma);
  const [playing, setPlaying] = useState(sim.playing);
  const [speedI, setSpeedI] = useState(0);
  const [tune, setTune] = useState(false);
  const [focusI, setFocusI] = useState(sim.world.start);
  const [, force] = useState(0);
  const dom = useRef({});
  const gridRef = useRef(null);
  const r = (k) => (el) => { dom.current[k] = el; };

  useEffect(() => { sim.playing = playing; }, [sim, playing]);
  useEffect(() => { sim.playing = !reduced; setPlaying(!reduced); }, [sim, reduced]);

  // Live readouts (≈12 Hz, DOM writes through refs — no React renders)
  useEffect(() => {
    let raf;
    let last = 0;
    let lastN = -1;
    let lastStep = -1;
    let lastVer = -1;
    const W = 300;
    const H = 52;
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      const s = Math.min(STEPS.length - 1, Math.floor(progress.current * STEPS.length));
      if (s !== lastStep) { lastStep = s; setStep(s); }
      if (t - last < 80) return;
      last = t;
      const w = sim.world;
      const d = dom.current;
      const set = (k, v) => { const el = d[k]; if (el && el.textContent !== v) el.textContent = v; };
      const show = sim.mode === 'show';
      set('status', sim.mode === 'ff' ? `Training ×${sim.ffTotal} · ${sim.ffTotal - sim.ffLeft}` : show ? 'Walking the learned policy' : sim.playing ? (w.eps >= 0.5 ? 'Exploring wildly' : 'Learning') : 'Paused');
      set('status2', sim.mode === 'ff' ? 'training…' : show ? 'greedy run' : sim.playing ? 'learning' : 'paused');
      set('ep', String(w.episode + 1).padStart(4, '0'));
      set('ep2', String(w.episode + 1));
      set('steps', String(w.steps).padStart(3, '0'));
      set('rew', sgn(w.epReward));
      set('goals', String(w.goals));
      set('falls', String(w.falls));
      set('total', w.totalSteps.toLocaleString('en-US'));
      const avg = w.avgReturn(50);
      set('avg', w.nReturns ? sgn(avg) : '—');
      set('avg2', w.nReturns ? sgn(avg) : '—');
      set('epsv', w.eps.toFixed(2));
      const L = w.last;
      if (w.totalSteps > 0) {
        set('formula', `Q ← ${nd(L.q0)} + ${nd(w.alpha)}·(${nd(L.r)} + ${nd(w.gamma)}·${nd(L.maxNext)} − ${nd(L.q0)}) = ${nd(L.q1)}`);
        const lr = (L.s / w.w) | 0;
        set('fwhere', `tile c${(L.s % w.w) + 1}·r${lr + 1}, move ${ARROWS[L.a]}`);
      }
      const h = sim.hover;
      if (h >= 0) {
        const kind = w.tiles[h];
        const where = `C${(h % w.w) + 1} R${((h / w.w) | 0) + 1}`;
        set('tile', kind === FLOOR ? `${where} · V ${sgn(w.maxQ(h))} · best ${w.confidence(h) > 0.002 ? ARROWS[w.argmax(h)] : '?'}` : `${where} · ${h === w.start ? 'start' : KIND[kind]}`);
      } else set('tile', 'hover a tile');
      // chart: rolling average of episode reward
      if (w.nReturns !== lastN && d.chart) {
        lastN = w.nReturns;
        const n = Math.min(160, w.nReturns);
        const from = w.nReturns - n;
        let pts = '';
        for (let i = 0; i < n; i++) {
          const v = w.avgReturn(50, from + i + 1);
          const x = n <= 1 ? W : (i / (n - 1)) * W;
          const y = H * (1 - (Math.max(-1.6, Math.min(1, v)) + 1.6) / 2.6);
          pts += `${x.toFixed(1)},${y.toFixed(1)} `;
        }
        d.chart.setAttribute('points', pts);
        if (d.chartDot && n) {
          const v = w.avgReturn(50);
          d.chartDot.setAttribute('cy', (H * (1 - (Math.max(-1.6, Math.min(1, v)) + 1.6) / 2.6)).toFixed(1));
        }
      }
      if (w.version !== lastVer) { lastVer = w.version; force((x) => x + 1); }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim, progress]);

  const chooseTool = (t) => { sim.tool = t; setTool(t); playBlip(0.7, 0.25); };
  const onEps = (v) => { sim.world.eps = v; setEps(v); };
  const onAlpha = (v) => { sim.world.alpha = v; setAlpha(v); };
  const onGamma = (v) => { sim.world.gamma = v; setGamma(v); };
  const ff = () => { if (sim.mode === 'ff') return; sim.ffCount = 500; sim.ffShow = true; sim.ffPending = true; playBlip(0.95, 0.5); };
  const forget = () => { sim.world.resetBrain(); sim.resetPending = true; };
  const rebuild = () => { sim.world.loadMap(DEFAULT_MAP); sim.resetPending = true; };
  const cycleSpeed = () => { const i = (speedI + 1) % SPEEDS.length; setSpeedI(i); sim.speed = SPEEDS[i]; };

  // Accessible grid (roving tabindex; arrow keys move, Enter/Space edits)
  const w = sim.world;
  const onGridKey = (e) => {
    const c = focusI % w.w;
    const rr = (focusI / w.w) | 0;
    let n = focusI;
    if (e.key === 'ArrowRight') n = rr * w.w + Math.min(w.w - 1, c + 1);
    else if (e.key === 'ArrowLeft') n = rr * w.w + Math.max(0, c - 1);
    else if (e.key === 'ArrowDown') n = Math.min(w.h - 1, rr + 1) * w.w + c;
    else if (e.key === 'ArrowUp') n = Math.max(0, rr - 1) * w.w + c;
    else return;
    e.preventDefault();
    setFocusI(n);
    sim.hover = n;
    gridRef.current?.querySelector(`[data-i="${n}"]`)?.focus();
  };

  const toolPills = (
    <div role="radiogroup" aria-label="Edit tool" className="flex shrink-0 gap-1 md:gap-1.5">
      {TOOLS.map((t) => (
        <button key={t.id} type="button" role="radio" aria-checked={tool === t.id} data-active={tool === t.id}
          className="pill !h-[34px] !gap-2 !px-2.5 md:!px-3.5" onClick={() => chooseTool(t.id)} title={t.hint}>
          <span aria-hidden className={`inline-block h-2 w-2 ${t.id === WALL ? 'rounded-[2px] bg-[#c9ced8]' : t.id === PIT ? 'rounded-full bg-ice' : 'rotate-45 bg-signal'}`}
            style={tool === t.id ? { background: '#fff' } : undefined} />
          {t.label}
        </button>
      ))}
    </div>
  );

  const sliders = (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
      <Slider id="rl-eps" label="Explore" sym="ε" value={eps} min={0} max={1} step={0.01} onChange={onEps}
        hint="Probability of taking a random move instead of the best known one" highlight={step === 3} />
      <Slider id="rl-alpha" label="Learning" sym="α" value={alpha} min={0.05} max={1} step={0.01} onChange={onAlpha}
        hint="How far each guess moves toward the new estimate" highlight={false} />
      <Slider id="rl-gamma" label="Foresight" sym="γ" value={gamma} min={0.5} max={0.99} step={0.01} onChange={onGamma}
        hint="Discount: how much future reward counts compared with reward now" highlight={step === 3} />
    </div>
  );

  const playBtn = (
    <button type="button" className="pill !h-[34px] !px-3.5" onClick={() => setPlaying((p) => !p)} aria-pressed={!playing} aria-label={playing ? 'Pause the agent' : 'Play the agent'}>
      {playing ? (
        <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden><rect width="3" height="10" fill="currentColor" /><rect x="6" width="3" height="10" fill="currentColor" /></svg>
      ) : (
        <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden><path d="M0 0L9 5L0 10Z" fill="currentColor" /></svg>
      )}
      {playing ? 'Pause' : 'Play'}
    </button>
  );
  const speedBtn = (
    <button type="button" className="pill !h-[34px] !px-3.5" onClick={cycleSpeed} aria-label={`Simulation speed ${SPEEDS[speedI]}×, change`}>
      {SPEEDS[speedI]}×
    </button>
  );
  const ffBtn = (
    <button type="button" className="pill rl-ff !h-[34px] !px-3.5" onClick={ff} data-cursor="Train">
      <svg width="13" height="10" viewBox="0 0 13 10" aria-hidden><path d="M0 0L6 5L0 10Z M6.5 0L12.5 5L6.5 10Z" fill="currentColor" /></svg>
      Fast-forward ×500
    </button>
  );
  const resetBtns = (
    <>
      <button type="button" className="pill !h-[34px] !px-3.5" onClick={forget} title="Erase everything the agent has learned">Forget</button>
      <button type="button" className="pill !h-[34px] !px-3.5" onClick={rebuild} title="Restore the original world and forget">Rebuild</button>
    </>
  );

  const resetLinks = (
    <>
      <button type="button" className="hud rounded px-1.5 py-2 hover:text-fg" onClick={forget} title="Erase everything the agent has learned">Forget</button>
      <span className="hud" aria-hidden>·</span>
      <button type="button" className="hud rounded px-1.5 py-2 hover:text-fg" onClick={rebuild} title="Restore the original world and forget">Rebuild</button>
    </>
  );

  const S = STEPS[step];

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div aria-hidden className="absolute inset-y-0 left-0 hidden w-[58%] bg-gradient-to-r from-[#050506]/85 via-[#050506]/45 to-transparent md:block" />
      <div aria-hidden className="absolute inset-x-0 top-0 h-[52%] bg-gradient-to-b from-[#050506]/90 via-[#050506]/55 to-transparent md:hidden" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[24%] bg-gradient-to-t from-[#050506]/90 to-transparent md:hidden" />
      <style>{`
        .rl-fade{animation:rlfade .9s cubic-bezier(.16,1,.3,1) both}
        @keyframes rlfade{from{opacity:0;transform:translateY(10px);filter:blur(4px)}to{opacity:1;transform:none;filter:none}}
        .rl-hl{background:rgb(255 79 31 / .08);box-shadow:inset 0 0 0 1px rgb(255 79 31 / .45)}
        .rl-ff{border-color:rgb(255 79 31 / .55);color:#fff;background:rgb(255 79 31 / .14)}
        .rl-ff:hover{background:var(--signal);border-color:var(--signal)}
        .rl-dot{animation:rlpulse 1.6s ease-in-out infinite}
        @keyframes rlpulse{50%{opacity:.35}}
      `}</style>

      {/* Title + step explainer */}
      <div className="gx absolute left-0 top-[76px] w-full md:top-[92px] md:w-[44%] md:max-w-[640px]">
        <div className="hud flex items-center gap-3">
          <span>L07 / Reinforcement learning</span>
          <span className="hidden h-px w-10 bg-[var(--hairline)] md:inline-block" />
          <span className="hidden md:inline">{String(step + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}</span>
        </div>
        <h2 className="display mt-3 !text-[clamp(34px,5.4vw,92px)]">
          Trial <span className="text-fg-42">&amp;</span> reward
        </h2>
        <p className="serif mt-1 text-[clamp(22px,2.4vw,38px)] leading-none text-signal-hot">nobody told it the way.</p>

        <div key={step} className="rl-fade mt-5 md:mt-9" aria-live="polite">
          <div className="hud mb-2 md:hidden">{String(step + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}</div>
          <h3 className="h3 text-fg">{S.title}</h3>
          <p className="body mt-2 !text-[13.5px] leading-[1.5] md:mt-3 md:!text-[clamp(15px,1.1vw,17px)]">{S.body}</p>
        </div>
        {step === 0 && (
          <div className="hud rl-fade mt-4 hidden items-center gap-2 text-fg-68 md:flex">
            <span className="rl-dot inline-block h-1.5 w-1.5 rounded-full bg-signal" /> Click a tile to drop a wall · drag to paint · pick Pit or Goal below
          </div>
        )}
      </div>

      {/* Controls (desktop) */}
      <div className={`gx absolute bottom-[84px] left-0 hidden ${live3d ? "md:block" : ""}`}>
        <div className="panel pointer-events-auto w-[min(470px,40vw)] p-3.5">
          <div className="flex items-center justify-between gap-3">
            {toolPills}
            <span className="hud text-right">Click / drag<br />a tile</span>
          </div>
          <div className="mt-3">{sliders}</div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {playBtn}{speedBtn}{ffBtn}
            <span className="ml-auto flex items-center gap-1">{resetLinks}</span>
          </div>
        </div>
      </div>

      {/* Readouts (desktop) */}
      <div className={`gx absolute bottom-[84px] right-0 hidden ${live3d ? "md:block" : ""}`}>
        <div className="panel pointer-events-auto w-[330px] p-4" aria-label="Live training readout">
          <div className="hud flex items-center gap-2 text-fg-68">
            <span className="rl-dot inline-block h-1.5 w-1.5 rounded-full bg-ice" />
            <span ref={r('status')}>Learning</span>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
            <div><dt className="hud">Episode</dt><dd className="hud !text-[13px] text-fg" ref={r('ep')}>0001</dd></div>
            <div><dt className="hud">Steps</dt><dd className="hud !text-[13px] text-fg" ref={r('steps')}>000</dd></div>
            <div><dt className="hud">Reward</dt><dd className="hud !text-[13px] text-fg" ref={r('rew')}>+0.00</dd></div>
            <div><dt className="hud">Goals</dt><dd className="hud !text-[13px] text-signal" ref={r('goals')}>0</dd></div>
            <div><dt className="hud">Pits</dt><dd className="hud !text-[13px] text-ice" ref={r('falls')}>0</dd></div>
            <div><dt className="hud normal-case">ε</dt><dd className="hud !text-[13px] text-fg" ref={r('epsv')}>0.15</dd></div>
          </dl>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="hud">Avg reward · last 50 eps</span>
            <span className="hud !text-[13px] text-fg" ref={r('avg')}>—</span>
          </div>
          <svg className="mt-1.5 block w-full overflow-visible" viewBox="0 0 300 52" height="52" aria-hidden preserveAspectRatio="none">
            <line x1="0" x2="300" y1={52 * (1 - 1.6 / 2.6)} y2={52 * (1 - 1.6 / 2.6)} stroke="rgba(255,255,255,.14)" strokeDasharray="2 3" />
            <line x1="0" x2="300" y1={52 * (1 - 2.6 / 2.6)} y2={0} stroke="rgba(255,79,31,.25)" strokeDasharray="1 4" />
            <polyline ref={r('chart')} fill="none" stroke="#ff4f1f" strokeWidth="1.5" vectorEffect="non-scaling-stroke" points="" />
            <circle ref={r('chartDot')} cx="300" cy="32" r="2.5" fill="#ffb38a" />
            <text x="300" textAnchor="end" y={52 * (1 - 1.6 / 2.6) - 3} fill="rgba(255,255,255,.3)" fontSize="8" fontFamily="var(--font-mono)">0</text>
          </svg>
          <div className="mt-3 border-t border-[var(--hairline)] pt-2.5">
            <div className="hud flex justify-between"><span>Last update</span><span ref={r('fwhere')} className="normal-case tracking-[.08em]">—</span></div>
            <div className="hud mt-1 overflow-hidden text-ellipsis whitespace-nowrap !text-[10px] normal-case !tracking-[.02em] text-fg-68" ref={r('formula')}>Q ← Q + α·(r + γ·max Q′ − Q)</div>
            <div className="hud mt-1.5 text-fg-68" ref={r('tile')}>hover a tile</div>
          </div>
        </div>
      </div>

      {/* Mobile: compact readout + controls */}
      <div className={`gx absolute bottom-[78px] left-0 right-0 md:hidden ${live3d ? "" : "hidden"}`}>
        {tune && (
          <div className="panel pointer-events-auto mb-2 p-3" id="rl-tune">
            {sliders}
            <div className="mt-2 flex flex-wrap gap-1.5">{playBtn}{speedBtn}{resetBtns}</div>
          </div>
        )}
        <div className="hud mb-2 flex justify-between gap-2">
          <span>EP <span className="text-fg" ref={r('ep2')}>1</span></span>
          <span>AVG/50 <span className="text-fg" ref={r('avg2')}>—</span></span>
          <span className="truncate text-fg-68" ref={r('status2')}>tap a tile</span>
        </div>
        <div className="pointer-events-auto flex items-center gap-1.5 overflow-x-auto">
          {toolPills}
          <button type="button" className="pill rl-ff !h-[34px] !px-3" onClick={ff} aria-label="Fast-forward 500 episodes">×500</button>
          <button type="button" className="pill !h-[34px] !px-3" onClick={() => setTune((v) => !v)} aria-expanded={tune} aria-controls="rl-tune">Tune</button>
        </div>
      </div>

      {/* Accessible equivalent of the 3D grid */}
      <div ref={gridRef} role="grid" aria-label={`Grid world, ${w.w} by ${w.h}. Arrow keys move, Enter edits with the ${TOOLS.find((t) => t.id === tool).label} tool.`}
        className="sr-only" onKeyDown={onGridKey}>
        {Array.from({ length: w.h }, (_, rr) => (
          <div role="row" key={rr}>
            {Array.from({ length: w.w }, (_, c) => {
              const i = rr * w.w + c;
              const k = w.tiles[i];
              const label = `Row ${rr + 1}, column ${c + 1}: ${i === w.start ? 'start' : KIND[k]}${k === FLOOR ? `, value ${sgn(w.maxQ(i))}, best move ${ACTION_NAMES[w.argmax(i)]}` : ''}`;
              return (
                <button key={i} type="button" role="gridcell" data-i={i} tabIndex={i === focusI ? 0 : -1} aria-label={label}
                  onFocus={() => { sim.hover = i; setFocusI(i); }} onBlur={() => { sim.hover = -1; }}
                  onClick={() => { if (sim.world.edit(i, sim.tool)) { playBlip(0.55, 0.4); force((x) => x + 1); } }} />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ReinforceChapter() {
  const reduced = useStore((s) => s.reducedMotion);
  const tier = useStore((s) => s.gpuTier);
  const sim = useMemo(() => createSim(false), []);
  const wrapRef = useRef(null);
  return (
    <Chapter id="reinforce" length={6} label="L7 Reinforcement learning: an agent learning by reward in a grid world">
      <div ref={wrapRef} className="absolute inset-0">
        <ChapterCanvas
          shadows={tier >= 1}
          camera={{ fov: 30, near: 0.1, far: 220, position: [7.5, 10.5, 12.5] }}
          fallback={<StaticGrid />}
        >
          <Scene sim={sim} wrapRef={wrapRef} />
        </ChapterCanvas>
      </div>
      <Overlay sim={sim} live3d={tier > 0} />
    </Chapter>
  );
}
