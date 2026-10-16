'use client'

import { useEffect, useRef } from 'react';
import { playBlip, playChord } from '@/lib/audio';
import { useChapter } from '@/lib/chapter';
import { ACTS, ACT_LIST, DATA, N_POINTS, W_RANGE, B_RANGE, accuracy, dot, divergingCss, fmt, useNeuron } from './state';
import { STEPS } from './copy';

const pad = (n) => String(n).padStart(2, '0');

function Row({ id, label, value, min, max, step = 0.01, onChange, color, show = true }) {
  return (
    <label className={`nr-row ${show ? '' : 'nr-hide'}`} htmlFor={id}>
      <span className="hud w-7 shrink-0 !text-fg-68">{label}</span>
      <input
        id={id}
        className="slider nr-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        data-cursor="Drag"
        style={color ? { '--nr-c': color } : undefined}
      />
      <span className="hud w-12 shrink-0 text-right tabular-nums" style={{ color: color || 'rgb(var(--fg-rgb) / 0.8)' }}>
        {value >= 0 && min < 0 ? '+' : ''}{fmt(value)}
      </span>
    </label>
  );
}

export default function Overlay() {
  const { progress, id } = useChapter();
  const x = useNeuron((s) => s.x);
  const w = useNeuron((s) => s.w);
  const b = useNeuron((s) => s.b);
  const act = useNeuron((s) => s.act);
  const step = useNeuron((s) => s.step);
  const learning = useNeuron((s) => s.learning);
  const epoch = useNeuron((s) => s.epoch);
  const probe = useNeuron((s) => s.probe);
  const { setX, setW, setB, setAct, setLearning, learnEpoch, reset, scramble } = useNeuron.getState();
  const timer = useRef(null);

  const z = dot(w, x, b);
  const a = ACTS[act].fn(z);
  const fires = z > 0;
  const acc = accuracy(w, b);
  const S = STEPS[step];

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (step < 4 && learning) { clearTimeout(timer.current); setLearning(false); }
  }, [step, learning, setLearning]);

  const toggleLearn = () => {
    if (learning) { clearTimeout(timer.current); setLearning(false); return; }
    setLearning(true);
    const order = Array.from({ length: N_POINTS }, (_, i) => i);
    let n = 0;
    const tick = () => {
      for (let i = order.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
      const errs = learnEpoch(order);
      n++;
      playBlip(0.2 + Math.min(0.7, n / 30), 0.25);
      if (errs === 0 || n >= 80) { setLearning(false); if (errs === 0) playChord(); return; }
      timer.current = setTimeout(tick, 240);
    };
    tick();
  };

  const goStep = (i) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const span = el.offsetHeight - window.innerHeight;
    const y = top + span * ((i + 0.5) / STEPS.length);
    if (window.__lenis) window.__lenis.scrollTo(y, { duration: 1.4 });
    else window.scrollTo({ top: y, behavior: 'smooth' });
  };

  const sym = ACTS[act].sym;
  const term = (wi, xi) => `${wi < 0 ? `(${fmt(wi)})` : fmt(wi)}·${fmt(xi)}`;
  const mathLine = `${term(w[0], x[0])} + ${term(w[1], x[1])} + ${term(w[2], x[2])} ${b < 0 ? '−' : '+'} ${fmt(Math.abs(b))}`;
  const pd = probe >= 0 ? DATA[probe] : null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <style>{CSS}</style>
      <div className="nr-scrim" aria-hidden />

      {/* Title block */}
      <div className="gx ov-col right-0">
        <div className="shrink-0 max-w-[min(560px,100%)]">
        <div className="hud flex items-center gap-3">
          <span className="text-signal">L01</span>
          <span>/ The Neuron · Perceptron</span>
        </div>
        <h2 className="display mt-3 text-[clamp(32px,min(5.2vw,9svh),88px)]">The Neuron</h2>
        <p className="serif mt-2 text-[clamp(20px,min(2.3vw,4.2svh),36px)] leading-none text-fg-68">a tiny, very opinionated vote.</p>
        </div>

        <div className="fit-copy max-w-[min(560px,100%)]">

        {/* Step explainer */}
        <div key={step} className="nr-in mt-5 md:mt-7" aria-live="polite">
          <div className="hud flex items-center gap-2">
            <span className="text-fg">{pad(step + 1)}</span>
            <span>/ {pad(STEPS.length)} — {S.label}</span>
          </div>
          <h3 className="h3 mt-2">{S.title}</h3>
          <p className="body nr-body mt-2">{S.body}</p>
        </div>
        <nav className="pointer-events-auto mt-4 hidden gap-1.5 md:flex" aria-label="Neuron chapter steps">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => goStep(i)}
              className="nr-dot"
              data-active={i === step}
              aria-label={`Step ${i + 1}: ${s.label}`}
            >
              <span className="hud">{pad(i + 1)}</span>
            </button>
          ))}
        </nav>
        </div>

      <div className="nr-dock">
      {/* Readouts */}
      <div className="nr-readout" aria-live="off" data-step={step}>
        <div className="hud mb-1.5">Live · weighted sum</div>
        <div className="nr-math">
          <span className="text-fg-42">z = </span>
          {mathLine}
          <span className="text-fg-42"> = </span>
          <span className="text-fg">{fmt(z)}</span>
        </div>
        <div className="nr-math mt-1">
          <span className="text-fg-42">→ {sym}(z) = </span>
          <span className={fires ? 'text-signal' : 'text-ice'}>{fmt(a)}</span>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="nr-led" data-on={fires} />
          <span className={`hud ${fires ? '!text-signal' : ''}`}>{fires ? 'Firing · z > 0' : 'Quiet · z ≤ 0'}</span>
        </div>
        {step >= 4 && (
          <div className="mt-3 border-t border-[var(--hairline)] pt-3">
            <div className="flex items-baseline justify-end gap-3">
              <span className="hud">Accuracy</span>
              <span className="nr-acc" data-perfect={acc === N_POINTS}>{Math.round((acc / N_POINTS) * 100)}%</span>
            </div>
            <div className="hud mt-1 text-right">
              {acc}/{N_POINTS} correct · {N_POINTS - acc} mistakes{epoch > 0 ? ` · epoch ${pad(epoch)}` : ''}
            </div>
            {pd && (
              <div className="hud mt-1 text-right">
                point {String(probe).padStart(3, '0')} · label{' '}
                <span className={pd.label ? 'text-signal' : 'text-ice'}>{pd.label ? 'orange' : 'ice'}</span> · neuron{' '}
                {fires ? 'fires' : 'quiet'} {fires === !!pd.label ? '✓' : '✗'}
              </div>
            )}
          </div>
        )}
      </div>
      {/* Controls */}
      <div className="nr-controls pointer-events-auto panel" data-step={step}>
        <div className="hud mb-2 flex items-center justify-between gap-4">
          <span className="hidden md:inline">Drag orbs, rings &amp; the bias line in 3D</span>
          <span className="md:hidden">{['Inputs x', 'Weights w', 'Bias b', 'Activation', 'Weights & bias'][step]}</span>
          <span className="text-fg-22">{step >= 4 ? <><span className="hidden md:inline">hover points</span><span className="md:hidden">tap points</span></> : 'or sliders'}</span>
        </div>
        <div className="nr-grid">
          <div className="nr-col" data-group="x" data-on={step === 0}>
            {x.map((v, i) => (
              <Row key={i} id={`nr-x${i}`} label={`x${i + 1}`} value={v} min={0} max={1} onChange={(val) => setX(i, val)} />
            ))}
          </div>
          <div className="nr-col" data-group="w" data-on={step === 1 || step === 4}>
            {w.map((v, i) => (
              <Row
                key={i}
                id={`nr-w${i}`}
                label={`w${i + 1}`}
                value={v}
                min={-W_RANGE}
                max={W_RANGE}
                onChange={(val) => setW(i, val)}
                color={Math.abs(v) < 0.08 ? undefined : divergingCss(Math.sign(v) * (0.45 + Math.min(1, Math.abs(v) / 2) * 0.55))}
              />
            ))}
          </div>
        </div>
        <div className="nr-col" data-group="b" data-on={step === 2 || step === 4}>
          <Row id="nr-b" label="b" value={b} min={-B_RANGE} max={B_RANGE} onChange={setB} />
        </div>
        <div className="nr-col mt-2 flex flex-wrap gap-1.5" data-group="act" data-on={step === 3} role="radiogroup" aria-label="Activation function">
          {ACT_LIST.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={act === k} className="pill nr-pill" data-active={act === k} onClick={() => { setAct(k); playBlip(0.55, 0.3); }}>
              {ACTS[k].name}
            </button>
          ))}
        </div>
        <div className="nr-col mt-2 flex flex-wrap gap-1.5" data-group="learn" data-on={step === 4}>
          <button type="button" className="pill nr-pill" data-active={learning} onClick={toggleLearn} data-cursor="Train">
            {learning ? 'Stop' : 'Learn'}
          </button>
          <button type="button" className="pill nr-pill" onClick={() => { scramble(); playBlip(0.3, 0.3); }}>Scramble</button>
          <button type="button" className="pill nr-pill" onClick={reset}>Reset</button>
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}

const CSS = `
.nr-scrim { position: absolute; inset: 0; background: linear-gradient(90deg, rgb(5 5 6 / .82) 0%, rgb(5 5 6 / .55) 26%, rgb(5 5 6 / 0) 42%); }
.nr-in { animation: nrIn .9s cubic-bezier(.16,1,.3,1) both; }
@keyframes nrIn { from { opacity: 0; transform: translateY(14px); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
.nr-body { max-width: 44ch; }
.nr-dot { height: 26px; padding: 0 9px; border-radius: 999px; border: 1px solid var(--hairline); transition: background .5s var(--ease), border-color .5s var(--ease); }
.nr-dot:hover { border-color: rgb(var(--fg-rgb) / .4); }
.nr-dot[data-active='true'] { border-color: var(--signal); background: rgb(255 79 31 / .12); }
.nr-dot[data-active='true'] .hud { color: #fff; }
.nr-dock { flex: 0 0 auto; padding-top: 14px; display: flex; flex-direction: row-reverse; justify-content: space-between; align-items: flex-end; gap: 24px; }
.nr-controls { width: min(500px, 100%); padding: 14px 16px 14px; flex-shrink: 0; }
.nr-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 18px; }
.nr-row { display: flex; align-items: center; gap: 8px; height: 28px; }
.nr-col { transition: opacity .6s var(--ease); }
.nr-controls[data-step] .nr-col[data-on='false'] { opacity: .5; }
.nr-controls .nr-col[data-on='true'] { opacity: 1; }
.nr-pill { height: 32px; padding: 0 13px; font-size: 10.5px; }
.nr-slider { flex: 1; min-width: 0; }
.nr-slider[style]::-webkit-slider-thumb { border-color: var(--nr-c); box-shadow: 0 0 0 4px color-mix(in srgb, var(--nr-c) 18%, transparent); }
.nr-readout { text-align: right; max-width: min(560px, 46vw); pointer-events: none; }
.nr-math { font-family: var(--font-mono); font-size: 13px; letter-spacing: .02em; color: rgb(var(--fg-rgb) / .78); font-variant-numeric: tabular-nums; line-height: 1.5; }
.nr-led { width: 7px; height: 7px; border-radius: 50%; background: rgb(var(--fg-rgb) / .2); transition: background .3s, box-shadow .3s; }
.nr-led[data-on='true'] { background: var(--signal); box-shadow: 0 0 12px 2px rgb(255 79 31 / .7); }
.nr-acc { font-family: var(--font-display); font-variation-settings: 'wdth' 130; font-weight: 800; font-size: clamp(36px, 3.6vw, 60px); line-height: .9; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.nr-acc[data-perfect='true'] { color: var(--signal); }
/* short desktop windows: like mobile, show only the current step's controls so the explainer keeps its room */
@media (min-width: 769px) and (max-height: 820px) {
  .nr-controls { padding: 10px 14px; }
  .nr-controls .nr-col[data-on='false'] { display: none; }
  .nr-grid { grid-template-columns: 1fr; }
  .nr-controls > .hud:first-child { margin-bottom: 4px; }
}
@media (max-width: 768px) {
  .nr-scrim { background: linear-gradient(180deg, rgb(5 5 6 / .85) 0%, rgb(5 5 6 / .4) 30%, rgb(5 5 6 / 0) 42%, rgb(5 5 6 / 0) 62%, rgb(5 5 6 / .7) 80%); }
  .nr-body { font-size: 14px; line-height: 1.45; }
  .nr-dock { flex-direction: column; align-items: stretch; gap: 10px; }
  .nr-controls { padding: 10px 12px; width: 100%; }
  .nr-grid { grid-template-columns: 1fr; }
  .nr-controls .nr-col[data-on='false'] { display: none; }
  .nr-row { height: 30px; }
  .nr-readout { max-width: none; text-align: left; }
  .nr-readout .justify-end { justify-content: flex-start; }
  .nr-readout .text-right { text-align: left; }
  .nr-readout .nr-acc { font-size: 30px; }
  .nr-readout > .hud:first-child { display: none; }
  .nr-readout[data-step='4'] .nr-math { display: none; }
  .nr-readout[data-step='4'] > .mt-3 { margin-top: 4px; padding-top: 6px; }
  .nr-math { font-size: 11px; }
}
`;
