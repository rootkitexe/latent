'use client'

import { useChapter } from '@/lib/chapter';
import { STEPS, PRESETS, RACERS, lrFromSlider, sliderFromLr } from './config';

const pad = (n) => String(n).padStart(2, '0');
const LABELS = ['Loss', 'Gradient', 'Learning rate', 'Noise', 'Optimizers'];

const CSS = `
.dc-in { animation: dcIn .9s cubic-bezier(.16,1,.3,1) both; }
@keyframes dcIn { from { opacity: 0; transform: translateY(14px); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
.dc-dot { width: 22px; height: 22px; display: grid; place-items: center; }
.dc-dot::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: rgb(var(--fg-rgb) / .22); transition: all .5s var(--ease); }
.dc-dot[data-active='true']::after { width: 18px; border-radius: 4px; background: var(--signal); }
.dc-pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--signal); box-shadow: 0 0 0 0 rgb(255 79 31 / .6); animation: dcP 1.8s ease-out infinite; }
@keyframes dcP { 0% { box-shadow: 0 0 0 0 rgb(255 79 31 / .55); } 100% { box-shadow: 0 0 0 10px rgb(255 79 31 / 0); } }
.dc-pill { height: 34px; padding: 0 13px; font-size: 10.5px; }
.dc-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.dc-val { font-family: var(--font-mono); font-size: 13px; letter-spacing: .04em; color: rgb(var(--fg-rgb)); font-variant-numeric: tabular-nums; }
@media (max-width: 768px) {
  .dc-body { font-size: 13.5px; line-height: 1.45; }
  .dc-val { font-size: 12px; }
}
`;

export default function Overlay({ step, lr, onLr, noise, onNoise, send, hud, touch }) {
  const { id } = useChapter();
  const S = STEPS[step];
  const ref = (k) => (el) => {
    hud.current[k] = el;
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

  const verb = touch ? 'Tap' : 'Click';
  const hint =
    step === 3 ? `${verb} the terrain to rain a cluster of balls` : step === 4 ? `${verb} anywhere to race from there` : `${verb} the terrain to drop a ball`;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <style>{CSS}</style>

      {/* Title block */}
      <div className="gx absolute left-0 top-[68px] max-w-[min(540px,100%)] md:top-[84px]">
        <div className="hud flex items-center gap-3">
          <span className="text-signal">L02</span>
          <span>/ Gradient descent · Loss landscape</span>
        </div>
        <h2 className="display mt-3 text-[clamp(34px,5.2vw,88px)]">Gradient Descent</h2>
        <p className="serif mt-2 text-[clamp(20px,2.3vw,36px)] leading-none text-fg-68">learning is just falling, carefully.</p>

        <div key={step} className="dc-in mt-5 md:mt-9" aria-live="polite">
          <div className="hud flex items-center gap-2">
            <span className="text-fg">{pad(step + 1)}</span>
            <span>/ {pad(STEPS.length)} — {LABELS[step]}</span>
          </div>
          <h3 className="h3 mt-2 max-md:text-[19px]">{S.lead}</h3>
          <p className="body dc-body mt-2">{S.body}</p>
        </div>
        <nav className="pointer-events-auto mt-4 hidden gap-1 md:flex" aria-label="Gradient descent steps">
          {STEPS.map((s, i) => (
            <button key={i} type="button" onClick={() => goStep(i)} className="dc-dot" data-active={i === step} aria-label={`Step ${i + 1}: ${LABELS[i]}`} />
          ))}
        </nav>
      </div>

      <div className="gx absolute inset-x-0 bottom-[74px] flex flex-col gap-3 md:bottom-[88px] md:flex-row md:items-end md:justify-between">
      {/* Controls — bottom left */}
      <div className="order-2 w-full md:order-1 md:w-auto md:max-w-[440px]">
        <div className="hud mb-3 flex items-center gap-2.5 !text-fg-68 max-md:hidden">
          <span className="dc-pulse" aria-hidden />
          {hint}
        </div>

        {step <= 2 && (
          <div className="pointer-events-auto">
            <label htmlFor="dc-lr" className="hud flex items-center justify-between">
              <span>Learning rate</span>
              <span className="dc-val !text-[12px]">{lr.toFixed(3)}</span>
            </label>
            <input
              id="dc-lr"
              type="range"
              className="slider mt-1 max-w-[360px]"
              min={0}
              max={1000}
              step={1}
              value={Math.round(sliderFromLr(lr))}
              onChange={(e) => onLr(lrFromSlider(Number(e.target.value)))}
              data-cursor="Drag"
              aria-valuetext={`learning rate ${lr.toFixed(3)}`}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {step === 2 &&
                PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="pill dc-pill"
                    data-active={Math.abs(lr - p.lr) < 1e-4}
                    onClick={() => {
                      onLr(p.lr);
                      send({ type: 'preset' });
                    }}
                  >
                    {p.label} <span className="opacity-60">{p.lr}</span>
                  </button>
                ))}
              {step < 2 && (
                <button type="button" className="pill dc-pill" onClick={() => send({ type: 'drop', random: step === 0 })}>
                  Drop a ball
                </button>
              )}
              <button type="button" className="pill dc-pill" onClick={() => send({ type: 'clear' })}>
                Clear
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="pointer-events-auto flex flex-wrap gap-1.5">
            <button type="button" className="pill dc-pill" onClick={() => send({ type: 'rain' })}>
              Rain balls
            </button>
            <button type="button" className="pill dc-pill" data-active={noise} aria-pressed={noise} onClick={() => onNoise(!noise)}>
              Noise · {noise ? 'SGD' : 'off (GD)'}
            </button>
            <button type="button" className="pill dc-pill" onClick={() => send({ type: 'clear' })}>
              Clear
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="pointer-events-auto flex flex-wrap gap-1.5">
            <button type="button" className="pill dc-pill" onClick={() => send({ type: 'race' })}>
              Race again
            </button>
            <button type="button" className="pill dc-pill" onClick={() => send({ type: 'clear' })}>
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Readouts — bottom right */}
      <div
        className="panel pointer-events-none order-1 w-full p-3 md:order-2 md:w-[300px] md:p-4"
        aria-label="Live readouts"
      >
        {step !== 4 ? (
          <>
            <div ref={ref('mode')} className="hud truncate !text-fg-68">Probe</div>
            <div className="mt-2.5 grid grid-cols-2 gap-x-5 gap-y-1.5 md:grid-cols-1 md:gap-y-1">
              {[0, 1, 2, 3].map((k) => (
                <div key={k} className="dc-row">
                  <span ref={ref(`k${k}`)} className="hud">—</span>
                  <span ref={ref(`v${k}`)} className="dc-val">—</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="hud !text-fg-68">Loss vs step · same start</div>
            <div className="hud mt-1 !text-[9.5px]">lr .05 · .03 (β .9) · .05 (Adam)</div>
            <svg viewBox="0 0 240 108" preserveAspectRatio="none" className="mt-2 h-[54px] w-full md:h-[96px]" aria-hidden>
              <line x1="0" y1="104" x2="240" y2="104" stroke="rgba(255,255,255,.18)" strokeWidth="1" />
              <line x1="0" y1="8" x2="0" y2="104" stroke="rgba(255,255,255,.18)" strokeWidth="1" />
              {RACERS.map((r, k) => (
                <polyline key={k} ref={ref(`c${k}`)} fill="none" stroke={r.color} strokeWidth={k === 0 ? 1.6 : 1.3} strokeLinejoin="round" opacity={k === 2 ? 0.9 : 1} />
              ))}
            </svg>
            <div className="mt-2 space-y-1">
              {RACERS.map((r, k) => (
                <div key={k} className="dc-row">
                  <span className="hud flex items-center gap-2">
                    <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: r.color }} />
                    <span className="text-fg">{r.name}</span>
                  </span>
                  <span ref={ref(`r${k}`)} className="dc-val">—</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div ref={ref('status')} className="hud mt-2 border-t border-hairline pt-2 !text-signal-hot md:mt-3 md:pt-2.5" aria-live="off">
          —
        </div>
      </div>
      </div>
    </div>
  );
}
