'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chapter from '@/components/core/Chapter';
import ChapterCanvas from '@/components/core/ChapterCanvas';
import { useChapter } from '@/lib/chapter';
import { useStore } from '@/lib/store';
import Scene from './Scene';
import Fallback from './Fallback';
import { PROMPTS } from './targets';
import { STEPS, stepOf, lightOf } from './story';
import { alphaBar, T } from './schedule';

export default function DiffusionChapter() {
  return (
    <Chapter id="diffusion" length={6} tone="paper" label="L6 Diffusion — from noise to image">
      <Stage />
    </Chapter>
  );
}

const CURVE = (() => {
  let d = '';
  for (let t = 0; t <= T; t += 20) d += `${t ? 'L' : 'M'}${((t / T) * 100).toFixed(2)},${(4 + (1 - alphaBar(t)) * 40).toFixed(2)}`;
  return d;
})();

function Stage() {
  const { progress } = useChapter();
  const gpuTier = useStore((s) => s.gpuTier);
  const touch = useStore((s) => s.touch);
  const reduced = useStore((s) => s.reducedMotion);

  const [step, setStep] = useState(0);
  const [prompt, setPrompt] = useState('hand');
  const [mode, setMode] = useState('denoise');
  const [busy, setBusy] = useState(false);
  const [brushOn, setBrushOn] = useState(false); // touch only: canvas captures touches

  // Shared mutable state between DOM and the WebGL scene (never triggers renders).
  const sim = useMemo(() => ({
    prompt: 'hand', seed: 1, req: 0, reqPrompt: 'hand', autoDone: false, hold: null, mode: 'denoise',
    brush: { x: -999, y: -999, r: 86, down: false, inside: false },
  }), []);
  sim.mode = mode;

  const root = useRef(null);
  const ring = useRef(null);
  const ui = {
    t: useRef(null), ab: useRef(null), snr: useRef(null), steps: useRef(null), dot: useRef(null),
    slider: useRef(null), phase: useRef(null), setMode, setBusy, setPrompt,
  };
  const uiRef = useRef(ui);
  uiRef.current.setMode = setMode;

  // Step + "lights on" colour inversion for the DOM overlay.
  useEffect(() => {
    let raf, last = -1, lastStep = -1;
    const loop = () => {
      const p = progress.current;
      const s = stepOf(p);
      if (s !== lastStep) { lastStep = s; setStep(s); }
      const l = Math.round(lightOf(p) * 200) / 200;
      if (l !== last && root.current) {
        last = l;
        const v = Math.round(255 + (11 - 255) * l);
        root.current.style.setProperty('--fg-rgb', `${v} ${v} ${v}`);
        root.current.style.setProperty('--hairline', `rgb(${v} ${v} ${v} / ${0.09 + 0.03 * l})`);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [progress]);

  const generate = useCallback((id) => {
    const next = id || sim.prompt;
    setPrompt(next);
    sim.reqPrompt = next;
    sim.req++;
    sim.autoDone = true;
  }, [sim]);

  // ── brush pointer handling ──
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    sim.brush.x = e.clientX - r.left;
    sim.brush.y = e.clientY - r.top;
    sim.brush.inside = true;
    sim.brush.r = r.width < 700 ? 64 : 86;
    if (ring.current) {
      ring.current.style.opacity = '1';
      ring.current.style.transform = `translate3d(${e.clientX - r.left}px, ${e.clientY - r.top}px, 0) translate(-50%, -50%) scale(${sim.brush.down ? 0.92 : 1})`;
      ring.current.style.width = ring.current.style.height = `${sim.brush.r * 2}px`;
    }
  };
  const onDown = (e) => {
    if (e.pointerType === 'touch' && !brushOn) return;
    sim.brush.down = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    onMove(e);
  };
  const onUp = () => { sim.brush.down = false; };
  const onLeave = () => {
    sim.brush.inside = false; sim.brush.down = false;
    if (ring.current) ring.current.style.opacity = '0';
  };

  const onSlider = (e) => {
    sim.hold = { t: Number(e.target.value), p: progress.current, slider: true };
  };

  const S = STEPS[step];
  const showTouchBrush = touch;
  const captures = !touch || brushOn;

  return (
    <div className="relative h-full w-full">
      <div
        className="absolute inset-0"
        data-cursor={mode === 'denoise' ? 'Brush · Denoise' : 'Brush · Noise'}
        style={{ touchAction: captures ? 'none' : 'pan-y' }}
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onLeave}
      >
        <ChapterCanvas
          flat
          camera={{ fov: 35, position: [0, 0, 8.6], near: 0.1, far: 60 }}
          fallback={<Fallback />}
        >
          <Scene sim={sim} ui={uiRef.current} progress={progress} tier={gpuTier} reduced={reduced} />
        </ChapterCanvas>
        <div
          ref={ring}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 rounded-full opacity-0 transition-opacity duration-300"
          style={{
            width: 172, height: 172,
            border: `1px ${mode === 'denoise' ? 'solid' : 'dashed'} rgb(var(--fg-rgb) / 0.55)`,
            boxShadow: mode === 'denoise' ? 'inset 0 0 0 6px rgb(255 79 31 / 0.08)' : 'none',
          }}
        >
          <span className="hud absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap" style={{ color: 'var(--signal)' }}>
            {mode === 'denoise' ? '− noise' : '+ noise'}
          </span>
        </div>
      </div>

      {/* ── overlay ── */}
      <div ref={root} className="pointer-events-none absolute inset-0 z-10 text-fg">
        {/* title block */}
        <div className="gx absolute left-0 top-[76px] w-full md:top-[84px] md:max-w-[min(560px,46vw)]">
          <div className="hud mb-3">L06 / Diffusion · generative models</div>
          <h2 className="display">Diffusion</h2>
          <p className="serif mt-1 text-[clamp(22px,2.4vw,36px)] leading-none" style={{ color: 'var(--signal)' }}>
            sculpting with static.
          </p>

          <div key={step} className="mt-5 md:mt-8" style={{ animation: 'dfIn .9s cubic-bezier(.16,1,.3,1) both' }}>
            <div className="hud mb-2 flex items-center gap-3">
              <span>{String(step + 1).padStart(2, '0')} / 05</span>
              <span className="h-px w-8 bg-[rgb(var(--fg-rgb)/0.3)]" />
              <span>{S.kicker}</span>
            </div>
            <h3 className="h3 mb-2 md:mb-3">{S.title}</h3>
            <p className="body hidden md:block">{S.body.join(' ')}</p>
            <p className="body text-[14px] md:hidden">{S.body.slice(0, 2).join(' ')}</p>
            {S.formula ? <div className="hud mt-3 normal-case tracking-[0.06em] text-fg-68">{S.formula}</div> : null}
          </div>
        </div>

        {/* step progress ticks (right edge) */}
        <div className={`absolute right-[var(--gx)] top-1/2 hidden -translate-y-1/2 flex-col items-end gap-3 ${gpuTier === 0 ? "" : "md:flex"}`} aria-hidden>
          {STEPS.map((s, i) => (
            <div key={i} className="hud flex items-center gap-2" style={{ opacity: i === step ? 1 : 0.45 }}>
              <span className={i === step ? 'text-fg' : ''}>{s.kicker}</span>
              <span className="block h-px transition-all duration-700" style={{ width: i === step ? 28 : 12, background: i === step ? 'var(--signal)' : 'rgb(var(--fg-rgb) / 0.4)' }} />
            </div>
          ))}
        </div>

        {/* controls: prompt chips + generate + brush mode */}
        <div className={`gx absolute bottom-[86px] left-0 w-full md:bottom-[92px] md:w-auto md:max-w-[56vw] ${gpuTier === 0 ? 'hidden' : ''}`}>
          <div className="hud mb-2 flex items-center gap-2">
            <span>Prompt</span>
            <span className="text-fg-22">·</span>
            <span className="hidden md:inline">{touch ? 'tap brush, then drag the cloud' : 'drag across the cloud to ' + (mode === 'denoise' ? 'denoise' : 'add noise')}</span>
          </div>
          <div className="pointer-events-auto -mx-[var(--gx)] flex gap-2 overflow-x-auto px-[var(--gx)] pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0" role="group" aria-label="Prompt">
            {PROMPTS.map((pr) => (
              <button
                key={pr.id}
                type="button"
                className="pill shrink-0 normal-case tracking-[0.04em]"
                data-active={prompt === pr.id && step >= 3 ? 'true' : 'false'}
                aria-pressed={prompt === pr.id}
                onClick={() => generate(pr.id)}
                style={prompt === pr.id && step < 3 ? { borderColor: 'rgb(var(--fg-rgb) / 0.5)', color: 'rgb(var(--fg-rgb))' } : undefined}
              >
                “{pr.label}”
              </button>
            ))}
          </div>
          <div className="pointer-events-auto mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => generate()}
              className="pill !h-[46px] !px-6 !text-[12px]"
              data-active="true"
              style={{ boxShadow: '0 10px 40px -12px rgb(255 79 31 / 0.65)' }}
              aria-label="Generate: re-noise and run the reverse process"
            >
              <span aria-hidden className={busy ? 'inline-block animate-spin' : 'inline-block'}>✺</span>
              {busy ? 'Denoising…' : 'Generate'}
            </button>
            <div className="flex rounded-full border border-[var(--hairline)] p-[3px]" role="group" aria-label="Brush mode">
              {[['denoise', '− Denoise'], ['noise', '+ Noise']].map(([m, l]) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className="hud h-[32px] rounded-full px-3 transition-colors duration-500"
                  style={mode === m ? { background: 'rgb(var(--fg-rgb))', color: 'var(--paper)' } : undefined}
                >
                  {l}
                </button>
              ))}
            </div>
            {showTouchBrush ? (
              <button type="button" className="pill" data-active={brushOn ? 'true' : 'false'} aria-pressed={brushOn} onClick={() => setBrushOn((v) => !v)}>
                {brushOn ? 'Brush on' : 'Brush'}
              </button>
            ) : null}
          </div>
        </div>

        {/* readouts */}
        <div className={`absolute bottom-[86px] right-[var(--gx)] hidden w-[300px] ${gpuTier === 0 ? '' : 'md:block'}`}>
          <div className="panel pointer-events-auto p-4">
            <div className="hud mb-2 flex justify-between gap-3">
              <span>Cosine schedule</span>
              <span ref={ui.phase} className="normal-case tracking-[0.04em]" style={{ color: 'var(--signal)' }}>x_T ~ N(0, I)</span>
            </div>
            <svg viewBox="0 0 100 48" preserveAspectRatio="none" className="h-[56px] w-full overflow-visible" aria-hidden>
              <path d="M0,44 L100,44" stroke="rgb(var(--fg-rgb) / 0.18)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
              <path d={CURVE} fill="none" stroke="rgb(var(--fg-rgb) / 0.6)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
              <circle ref={ui.dot} cx="100" cy="44" r="2.2" fill="var(--signal)" />
            </svg>
            <div className="hud mb-3 flex justify-between text-fg-22"><span>t = 0 · ᾱ = 1</span><span>t = 1000 · ᾱ = 0</span></div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <Readout label="t" refEl={ui.t} init="1000" />
              <Readout label="ᾱₜ" refEl={ui.ab} init="0.0000" />
              <Readout label="SNR" refEl={ui.snr} init="−∞ dB" />
              <Readout label="steps" refEl={ui.steps} init="—/50" />
            </dl>
            <label className="hud mt-3 block">
              <span className="flex justify-between"><span>scrub timestep</span><span className="text-fg-22">denoiser: oracle</span></span>
              <input ref={ui.slider} type="range" min="0" max="1000" step="1" defaultValue="1000" className="slider" onInput={onSlider} aria-label="Timestep t" />
            </label>
          </div>
        </div>

        {/* mobile compact readout */}
        <div className="hud absolute right-[var(--gx)] top-[76px] text-right md:hidden" aria-hidden>
          <MobileReadout ui={ui} />
        </div>
      </div>

      <style>{`@keyframes dfIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

function Readout({ label, refEl, init }) {
  return (
    <div className="flex items-baseline justify-between border-t border-[var(--hairline)] pt-1.5">
      <dt className="hud">{label}</dt>
      <dd ref={refEl} className="hud text-fg" style={{ fontSize: 12 }}>{init}</dd>
    </div>
  );
}

/** Mirrors t / ᾱ from the desktop readouts on small screens (no extra per-frame work). */
function MobileReadout({ ui }) {
  const t = useRef(null);
  const ab = useRef(null);
  useEffect(() => {
    let raf;
    const loop = () => {
      if (t.current && ui.t.current) t.current.textContent = ui.t.current.textContent;
      if (ab.current && ui.ab.current) ab.current.textContent = ui.ab.current.textContent;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ui]);
  return (
    <>
      <div>t <span ref={t} className="text-fg">1000</span></div>
      <div>ᾱ <span ref={ab} className="text-fg">0.0000</span></div>
    </>
  );
}
