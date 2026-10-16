'use client'

import { useCallback, useEffect, useRef, useState } from 'react';
import Chapter from '@/components/core/Chapter';
import ChapterCanvas from '@/components/core/ChapterCanvas';
import { useChapter } from '@/lib/chapter';
import { useStore } from '@/lib/store';
import { N_STEPS, LR_DEFAULT, DEMO } from './config';
import { loss, lossGrad, PLAY } from './landscape';
import World from './Scene';
import Overlay from './Overlay';

/**
 * L2 — Gradient Descent. A cinematic loss landscape you can drop chrome balls onto; each ball runs
 * real gradient descent (or SGD / Momentum / Adam) on an analytic two-weight loss function.
 */
export default function DescentChapter() {
  return (
    <Chapter id="descent" length={6} label="L2 Gradient descent: loss, gradients, learning rate and optimizers">
      <Stage />
    </Chapter>
  );
}

function Stage() {
  const { progress } = useChapter();
  const gpuTier = useStore((s) => s.gpuTier);
  const reducedMotion = useStore((s) => s.reducedMotion);
  const touch = useStore((s) => s.touch);
  const [step, setStep] = useState(0);
  const [lr, setLrState] = useState(LR_DEFAULT);
  const [noise, setNoiseState] = useState(true);
  const hud = useRef({});
  const ctlRef = useRef(null);
  if (!ctlRef.current) ctlRef.current = { lr: LR_DEFAULT, noise: true, lrTouched: false, queue: [], step: 0 };
  const ctl = ctlRef.current;

  // the scene may set the learning rate for a demo (without counting as the visitor touching it)
  ctl.setLr = useCallback((v) => {
    ctl.lr = v;
    setLrState(v);
  }, [ctl]);

  useEffect(() => {
    let raf;
    let cur = -1;
    const loop = () => {
      const s = Math.min(N_STEPS - 1, Math.max(0, Math.floor(progress.current * N_STEPS)));
      if (s !== cur) {
        cur = s;
        setStep(s);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [progress]);

  const onLr = (v) => {
    ctl.lrTouched = true;
    ctl.setLr(v);
  };
  const onNoise = (v) => {
    ctl.noise = v;
    setNoiseState(v);
    ctl.queue.push({ type: 'rain' });
  };
  const send = (c) => ctl.queue.push(c);

  return (
    <>
      <div className="absolute inset-0" data-cursor={step === 4 ? 'Race' : step === 3 ? 'Rain' : 'Drop'}>
        <ChapterCanvas camera={{ fov: 38, near: 0.1, far: 900, position: [0, 24, 21] }} fallback={<Fallback />}>
          <World progress={progress} ctl={ctl} hud={hud} gpuTier={gpuTier} reducedMotion={reducedMotion} touch={touch} />
        </ChapterCanvas>
      </div>
      <Overlay step={step} lr={lr} onLr={onLr} noise={noise} onNoise={onNoise} send={send} hud={hud} touch={touch} />
    </>
  );
}

/** gpuTier 0: a static top-down contour map of the same landscape with one descent path. */
function Fallback() {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = 520, Hh = 520;
    c.width = W; c.height = Hh;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, Hh);
    const toU = (x) => ((x / W) * 2 - 1) * PLAY;
    const toV = (y) => (1 - (y / Hh) * 2) * PLAY;
    for (let y = 0; y < Hh; y++) {
      for (let x = 0; x < W; x++) {
        const L = loss(toU(x), toV(y));
        const f = Math.abs(((L * 5) % 1) - 0.5);
        const line = f > 0.44 ? 1 : 0;
        const base = 10 + Math.min(L, 4) * 4;
        const k = (y * W + x) * 4;
        img.data[k] = base + line * 90;
        img.data[k + 1] = base + 2 + line * 170;
        img.data[k + 2] = base + 6 + line * 190;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // one gradient-descent path from the demo start
    const o = [0, 0, 0];
    let u = DEMO.u, v = DEMO.v;
    ctx.strokeStyle = '#ff4f1f';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < 160; i++) {
      const x = ((u / PLAY + 1) / 2) * W, y = ((1 - v / PLAY) / 2) * Hh;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      lossGrad(u, v, o);
      u -= 0.06 * o[1];
      v -= 0.06 * o[2];
    }
    ctx.stroke();
  }, []);
  return (
    <div className="absolute inset-0 grid place-items-center md:pl-[34vw]" aria-hidden>
      <canvas ref={ref} className="h-auto w-[min(86vw,560px)] rounded-[14px] opacity-90" />
    </div>
  );
}
