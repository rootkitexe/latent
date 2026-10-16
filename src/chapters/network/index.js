'use client'

import { useCallback, useEffect, useRef, useState } from 'react';
import Chapter from '@/components/core/Chapter';
import ChapterCanvas from '@/components/core/ChapterCanvas';
import { useChapter } from '@/lib/chapter';
import { useStore } from '@/lib/store';
import { playBlip, playChord } from '@/lib/audio';
import { loadModel, createState, forward, backward, preprocess, featureMap, resetWeights, N_PARAMS } from './model';
import { STEPS } from './copy';
import Scene from './Scene';
import Pad from './Pad';

export default function NetworkChapter() {
  return (
    <Chapter id="network" length={5} label="L3 — Deep networks: draw a digit and watch a real neural network read it">
      <Stage />
    </Chapter>
  );
}

const fmt = (n) => n.toLocaleString('en-US');
const LR = 0.0012;

function Stage() {
  const { progress, visible } = useChapter();
  const reduced = useStore((s) => s.reducedMotion);
  const [model, setModel] = useState(null);
  const [step, setStep] = useState(0);
  const ctlRef = useRef(null);
  const padRef = useRef(null);
  const ui = useRef({});

  if (!ctlRef.current) {
    ctlRef.current = {
      model: null,
      state: createState(),
      version: 0,
      weightsVersion: 0,
      featureVersion: 0,
      feature: new Float32Array(784),
      sel: { layer: 1, idx: 0 },
      userSel: false,
      step: 0,
      drawing: false,
      fwdStart: -1,
      bwdStart: -1,
      fwdKick: false,
      bwdKick: false,
      target: -1,
      taught: 0,
      select: null,
    };
  }
  const ctl = ctlRef.current;

  // ---------- DOM readouts (refs, never per-frame React state)
  const sync = useCallback(() => {
    const s = ctl.state;
    const u = ui.current;
    const empty = s.empty;
    if (u.pred) u.pred.textContent = empty ? '–' : String(s.pred);
    if (u.conf) u.conf.textContent = empty ? '—' : `${(s.conf * 100).toFixed(1)}%`;
    if (u.active) u.active.textContent = `${String(empty ? 0 : s.active).padStart(2, '0')}/96`;
    if (u.loss) u.loss.textContent = empty || ctl.target < 0 ? '—' : s.loss.toFixed(3);
    if (u.taught) u.taught.textContent = String(ctl.taught).padStart(2, '0');
    if (u.target) u.target.textContent = ctl.target < 0 ? 'its own guess' : `“${ctl.target}”`;
    for (let k = 0; k < 10; k++) {
      const b = u.bars?.[k];
      if (!b) continue;
      const pk = empty ? 0 : s.p[k];
      b.fill.style.transform = `scaleY(${Math.max(0.02, pk)})`;
      const win = !empty && k === s.pred;
      b.fill.style.background = win ? 'var(--signal)' : 'rgb(168 240 255 / 0.55)';
      b.fill.style.boxShadow = win ? '0 0 18px rgb(255 79 31 / 0.65)' : 'none';
      b.label.style.color = win ? 'var(--signal)' : '';
      b.btn.setAttribute('aria-label', `Teach: this is a ${k}. Current probability ${(pk * 100).toFixed(1)}%`);
      b.btn.dataset.target = ctl.target === k ? 'true' : 'false';
    }
  }, [ctl]);

  const drawFeature = useCallback(() => {
    const c = ui.current.feat;
    if (!c) return;
    const g = c.getContext('2d');
    const img = g.createImageData(28, 28);
    for (let i = 0; i < 784; i++) {
      const v = ctl.feature[i];
      const a = Math.min(1, Math.abs(v) * 1.15);
      const [r1, g1, b1] = v > 0 ? [255, 79, 31] : [92, 124, 250];
      img.data[i * 4] = 18 + (r1 - 18) * a;
      img.data[i * 4 + 1] = 19 + (g1 - 19) * a;
      img.data[i * 4 + 2] = 24 + (b1 - 24) * a;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    if (ui.current.featName) ui.current.featName.textContent = `${ctl.sel.layer === 1 ? 'Hidden 1' : 'Hidden 2'} · neuron ${String(ctl.sel.idx).padStart(2, '0')}`;
  }, [ctl]);

  ctl.select = (layer, idx, user) => {
    if (!ctl.model) return;
    if (user) ctl.userSel = true;
    if (ctl.sel.layer === layer && ctl.sel.idx === idx && ctl.featureVersion > 0) return;
    ctl.sel = { layer, idx };
    featureMap(ctl.model, layer, idx, ctl.feature);
    ctl.featureVersion++;
    drawFeature();
    if (user) playBlip(0.3 + (idx % 8) / 16, 0.4);
  };

  // ---------- run the network on a new 28×28 input
  const run = useCallback(() => {
    const m = ctl.model;
    if (!m) return;
    const s = ctl.state;
    forward(m, s);
    backward(m, s, ctl.target >= 0 ? ctl.target : s.pred, 0);
    if (!ctl.userSel && !s.empty) {
      let best = 0;
      for (let i = 1; i < 64; i++) if (s.a1[i] > s.a1[best]) best = i;
      ctl.select(1, best, false);
    }
    ctl.version++;
    sync();
  }, [ctl, sync]);

  const onInput = useCallback(
    (gray, w, h, phase) => {
      const s = ctl.state;
      if (phase === 'start') {
        ctl.drawing = true;
        ctl.target = -1;
      }
      if (gray) {
        if (!preprocess(gray, w, h, s.x)) s.x.fill(0);
      } else s.x.fill(0);
      run();
      if (phase === 'end') {
        ctl.drawing = false;
        ctl.fwdKick = true;
        if (!s.empty) {
          playBlip(0.2 + s.pred / 12, 0.6);
          if (ui.current.live) ui.current.live.textContent = `The network reads your drawing as ${s.pred}, ${(s.conf * 100).toFixed(0)}% confident.`;
        }
      }
    },
    [ctl, run]
  );

  const teach = useCallback(
    (k) => {
      const m = ctl.model;
      const s = ctl.state;
      if (!m || s.empty) return;
      ctl.target = k;
      // one real SGD step on this example: forward, backprop the error, nudge all 52,650 numbers
      forward(m, s);
      backward(m, s, k, LR);
      ctl.taught++;
      ctl.weightsVersion++;
      run();
      ctl.bwdKick = true;
      playChord();
      if (ui.current.live) ui.current.live.textContent = `One training step toward ${k}. Probability of ${k} is now ${(s.p[k] * 100).toFixed(0)}%.`;
    },
    [ctl, run]
  );

  const reset = useCallback(() => {
    if (!ctl.model) return;
    resetWeights(ctl.model);
    ctl.taught = 0;
    ctl.target = -1;
    ctl.weightsVersion++;
    run();
  }, [ctl, run]);

  const stepNeuron = (dir) => {
    const { layer, idx } = ctl.sel;
    let g = (layer === 1 ? idx : 64 + idx) + dir;
    g = (g + 96) % 96;
    ctl.select(g < 64 ? 1 : 2, g < 64 ? g : g - 64, true);
  };

  // ---------- load the trained weights
  useEffect(() => {
    let alive = true;
    loadModel().then((m) => {
      if (!alive) return;
      ctl.model = m;
      setModel(m);
    });
    return () => { alive = false; };
  }, [ctl]);

  // start with a real test digit on the pad
  useEffect(() => {
    if (!model || !padRef.current) return;
    const smp = model.samples.find((x) => x.y === 3) || model.samples[0];
    padRef.current.drawSample(smp.x);
  }, [model]);

  // replay the forward wave the first time the chapter scrolls into view
  const kicked = useRef(false);
  useEffect(() => {
    if (visible && model && !kicked.current) { kicked.current = true; ctl.fwdKick = true; }
  }, [visible, model, ctl]);

  // step from scroll (React state only on change)
  useEffect(() => {
    let raf;
    let last = -1;
    const loop = () => {
      const st = Math.min(4, Math.floor(progress.current * 5));
      if (st !== last) { last = st; setStep(st); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [progress]);

  useEffect(() => { if (model) drawFeature(); }, [model, drawFeature, step]);

  const sample = () => {
    const m = ctl.model;
    if (!m || !padRef.current) return;
    const smp = m.samples[Math.floor(Math.random() * m.samples.length)];
    padRef.current.drawSample(smp.x);
  };

  const S = STEPS[step];
  const teachMode = step === 3;

  return (
    <>
      <ChapterCanvas camera={{ position: [5.5, 3.2, 21], fov: 48, near: 0.1, far: 200 }} fallback={<Fallback />}>
        {model && <Scene ctl={ctl} />}
      </ChapterCanvas>

      {/* readability scrims */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-[55%] md:hidden" style={{ background: 'linear-gradient(0deg, rgb(5 5 6 / 0.9) 30%, transparent)' }} />
      <div className="pointer-events-none absolute inset-0 z-[5]" style={{ background: 'linear-gradient(90deg, rgb(5 5 6 / 0.72) 0%, rgb(5 5 6 / 0.15) 38%, transparent 60%, rgb(5 5 6 / 0.35) 100%)' }} />

      <div className="pointer-events-none absolute inset-0 z-10">
        {/* ---- top-left: label, title, serif, step explainer */}
        <div className="gx ov-col w-full max-w-[640px] md:max-w-[min(640px,calc(100vw-330px-2*var(--gx)))]">
          <div className="shrink-0">
          <div className="hud">L03 / Deep Networks</div>
          <h2 className="display mt-3 text-fg" style={{ fontSize: 'clamp(32px, min(5vw, 9svh), 84px)' }}>
            Deep Networks
          </h2>
          <p className="serif mt-2 text-[22px] text-ice md:text-[clamp(20px,min(2.2vw,4.2svh),30px)]">every layer asks a better question.</p>
          </div>

          <div className="fit-copy mt-6 hidden md:mt-[clamp(16px,4svh,40px)] md:block" key={step} style={{ animation: 'netIn .9s cubic-bezier(.16,1,.3,1) both' }}>
            <div className="hud flex items-center gap-3">
              <span className="text-signal">0{step + 1}</span>
              <span className="h-px w-8 bg-fg-22" />
              <span>{S.k}</span>
            </div>
            <h3 className="h3 mt-3 text-fg">{S.title}</h3>
            <p className="body mt-3">{S.body}</p>
          </div>

          {/* feature inspector (step 3) */}
          <div
            className={`ov-controls pointer-events-auto hidden items-center gap-4 ${step === 2 ? 'md:flex' : ''}`}
            style={{ animation: 'netIn .9s cubic-bezier(.16,1,.3,1) both' }}
          >
            <canvas ref={(el) => (ui.current.feat = el)} width={28} height={28} className="h-[96px] w-[96px] rounded-[6px] border border-hairline" style={{ imageRendering: 'pixelated' }} aria-label="Heatmap of the selected neuron's input weights" />
            <div>
              <div className="hud text-fg-68" ref={(el) => (ui.current.featName = el)}>Hidden 1 · neuron 00</div>
              <div className="hud mt-2 flex items-center gap-2">
                <span className="inline-block h-2 w-6 rounded-sm" style={{ background: 'linear-gradient(90deg,#5C7CFA,#121318,#FF4F1F)' }} />
                inhibit · excite
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" className="pill !h-8 !px-3" onClick={() => stepNeuron(-1)} aria-label="Previous neuron">‹</button>
                <button type="button" className="pill !h-8 !px-3" onClick={() => stepNeuron(1)} aria-label="Next neuron">›</button>
              </div>
            </div>
          </div>
        </div>

        {/* ---- bottom-right: the toy (draw pad) + output + readouts */}
        <div className="gx absolute bottom-[78px] right-0 w-full md:bottom-[84px] md:w-auto">
          {/* mobile explainer (compact) */}
          <div className="mb-3 md:hidden" key={`m${step}`} style={{ animation: 'netIn .9s cubic-bezier(.16,1,.3,1) both' }}>
            <div className="hud"><span className="text-signal">0{step + 1}</span> · {S.k}</div>
            <p className="mt-1 text-[13.5px] leading-[1.45] text-fg-68">{S.body}</p>
          </div>

          <div className="net-panel panel pointer-events-auto flex gap-4 p-3 md:w-[330px] md:flex-col md:gap-0 md:p-4">
            <div className="net-pad w-[132px] shrink-0 md:w-full">
              <div className="hud mb-2 hidden items-center justify-between md:flex">
                <span>Draw a digit 0–9</span>
                <span className="text-fg-22">28×28 → input</span>
              </div>
              <Pad ref={padRef} onInput={onInput} disabled={!model} />
              <div className="mt-2 flex gap-2">
                <button type="button" className="pill !h-8 flex-1 justify-center !px-2" onClick={() => padRef.current?.clear()}>Clear</button>
                <button type="button" className="pill !h-8 flex-1 justify-center !px-2" onClick={sample}>Sample</button>
              </div>
            </div>

            <div className="net-out min-w-0 flex-1 md:mt-4">
              <div className="flex items-end justify-between">
                <div>
                  <div className="hud">Prediction</div>
                  <div className="flex items-baseline gap-3">
                    <span ref={(el) => (ui.current.pred = el)} className="display text-signal" style={{ fontSize: 'clamp(44px,4.4vw,64px)', lineHeight: 1 }}>–</span>
                    <span ref={(el) => (ui.current.conf = el)} className="hud text-fg-68">—</span>
                  </div>
                </div>
                <div className="hud text-right" style={{ opacity: teachMode ? 1 : 0.0, transition: 'opacity .6s' }} aria-hidden={!teachMode}>
                  <span className="text-ice">Tap the right answer</span>
                  <br />to teach it
                </div>
              </div>
              {/* softmax bars — each is a button: "teach: this is a k" (one real SGD step) */}
              <div className="mt-2 grid grid-cols-10 gap-[3px]" role="group" aria-label="Output probabilities. Press a digit to teach the network that answer.">
                {Array.from({ length: 10 }, (_, k) => (
                  <button
                    key={k}
                    type="button"
                    data-cursor="Teach"
                    ref={(el) => {
                      if (!el) return;
                      ui.current.bars = ui.current.bars || [];
                      ui.current.bars[k] = { btn: el, fill: el.querySelector('[data-fill]'), label: el.querySelector('[data-label]') };
                    }}
                    onClick={() => teach(k)}
                    className="net-bar group flex flex-col items-stretch"
                  >
                    <span className="relative block h-[44px] overflow-hidden rounded-[3px] md:h-[56px]" style={{ background: 'rgb(255 255 255 / 0.04)', outline: teachMode ? '1px solid rgb(168 240 255 / 0.25)' : 'none' }}>
                      <span data-fill className="absolute inset-x-0 bottom-0 block h-full origin-bottom" style={{ transform: 'scaleY(0.02)', transition: 'transform .5s cubic-bezier(.16,1,.3,1), background .3s' }} />
                    </span>
                    <span data-label className="hud mt-1 text-center text-fg-68 group-hover:text-ice">{k}</span>
                  </button>
                ))}
              </div>

              <dl className="hud mt-3 grid grid-cols-2 gap-x-3 gap-y-1 whitespace-nowrap max-md:!text-[9px] max-md:!tracking-[0.1em]">
                <div className="flex justify-between"><dt>Active</dt><dd ref={(el) => (ui.current.active = el)} className="text-fg-68">00/96</dd></div>
                <div className="flex justify-between"><dt>Params</dt><dd className="text-fg-68">{fmt(N_PARAMS)}</dd></div>
                <div className="flex justify-between"><dt><span className="max-md:hidden">Test acc</span><span className="md:hidden">Acc</span></dt><dd className="text-fg-68">{model ? `${model.acc.toFixed(1)}%` : '—'}</dd></div>
                <div className="flex justify-between"><dt>Loss</dt><dd ref={(el) => (ui.current.loss = el)} className="text-fg-68">—</dd></div>
                <div className="hidden justify-between md:flex"><dt>Steps taught</dt><dd ref={(el) => (ui.current.taught = el)} className="text-fg-68">00</dd></div>
                <div className="hidden justify-end md:flex">
                  <button type="button" className="hud underline decoration-fg-22 underline-offset-4 hover:text-ice" onClick={reset}>Reset weights</button>
                </div>
              </dl>
            </div>
          </div>
        </div>

        <div className="sr-only" aria-live="polite" ref={(el) => (ui.current.live = el)} />
      </div>

      <style>{`
        @keyframes netIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        /* short desktop windows: pad beside the results instead of above them (about half the height) */
        @media (min-width: 768px) and (max-height: 820px) {
          .net-panel { flex-direction: row !important; width: min(520px, 46vw) !important; gap: 16px !important; padding: 14px !important; }
          .net-panel .net-pad { width: clamp(150px, 26svh, 210px) !important; }
          .net-panel .net-out { margin-top: 0 !important; }
        }
        .net-bar[data-target='true'] [data-label] { color: var(--ice); }
        .net-bar[data-target='true'] > span:first-child { box-shadow: inset 0 0 0 1px var(--ice); }
      `}</style>
    </>
  );
}

/** gpuTier 0: a static drawing of the stack (the pad + real forward pass in the DOM still work). */
function Fallback() {
  const cols = [28, 8, 8, 10];
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-[6vw] opacity-60" aria-hidden>
      {cols.map((n, l) => (
        <div key={l} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${l === 0 ? 14 : l === 3 ? 1 : 4}, 6px)` }}>
          {Array.from({ length: l === 0 ? 98 : l === 3 ? 10 : 16 }, (_, i) => (
            <span key={i} className="block h-[6px] w-[6px] rounded-full" style={{ background: (i * 7 + l) % 5 === 0 ? 'var(--signal)' : 'rgb(168 240 255 / 0.25)' }} />
          ))}
        </div>
      ))}
    </div>
  );
}
