'use client'

import { useEffect, useRef, useState } from 'react';
import Chapter from '@/components/core/Chapter';
import ChapterCanvas from '@/components/core/ChapterCanvas';
import { useChapter } from '@/lib/chapter';
import { live, useStore } from '@/lib/store';
import { playBlip, playChord } from '@/lib/audio';
import { sim, stimulate, THRESHOLD } from './sim';
import NeuronScene from './NeuronScene';

const WORD = 'LATENT';
const GHOST = 'hello, world';

function Stage() {
  const { progress, visible } = useChapter();
  const touch = useStore((s) => s.touch);
  const loaded = useStore((s) => s.loaded);
  const lettersRef = useRef(null);
  const megaRef = useRef(null);
  const copyRef = useRef(null);
  const copy2Ref = useRef(null);
  const vBar = useRef(null);
  const vNum = useRef(null);
  const spikesRef = useRef(null);
  const traceRef = useRef(null);
  const flashRef = useRef(null);
  const hintRef = useRef(null);
  const inputRef = useRef(null);
  const typedRef = useRef(null);
  const [touched, setTouched] = useState(false);
  const lastInput = useRef(0);

  // fire a letter into the network
  const fire = (ch, ghost = false) => {
    if (!ch || !lettersRef.current) return;
    lastInput.current = performance.now();
    const branch = Math.random();
    const target = sim.project?.(branch);
    const span = document.createElement('span');
    span.textContent = ch === ' ' ? '·' : ch;
    span.className = 'absolute left-0 top-0 font-display text-signal pointer-events-none';
    span.style.cssText += `font-size:${36 + Math.random() * 28}px;font-weight:800;font-variation-settings:'wdth' 140;text-shadow:0 0 24px rgba(255,79,31,.8);will-change:transform,opacity`;
    lettersRef.current.appendChild(span);
    const W = window.innerWidth, H = window.innerHeight;
    const sx = W * (0.08 + Math.random() * 0.3);
    const sy = H * (0.62 + Math.random() * 0.12);
    const tx = target?.x ?? W * 0.7, ty = target?.y ?? H * 0.4;
    const anim = span.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) scale(1)`, opacity: 0, filter: 'blur(6px)' },
        { transform: `translate(${sx + 10}px, ${sy - 20}px) scale(1)`, opacity: 1, filter: 'blur(0px)', offset: 0.18 },
        { transform: `translate(${tx}px, ${ty}px) scale(.15)`, opacity: 0.2, filter: 'blur(1px)' },
      ],
      { duration: 650, easing: 'cubic-bezier(.55,0,.2,1)' }
    );
    anim.onfinish = () => {
      span.remove();
      stimulate(branch);
      playBlip(0.3 + Math.random() * 0.5, 0.5);
    };
    if (!ghost) { sim.typed = (sim.typed + ch).slice(-40); sim.inputs += 1; }
    if (typedRef.current) {
      const t = (typedRef.current.textContent + ch).slice(-28);
      typedRef.current.textContent = t;
    }
  };

  // keyboard: printable keys go into the network while the hero is on screen
  useEffect(() => {
    if (!visible) {
      delete document.body.dataset.typing;
      return;
    }
    document.body.dataset.typing = '1';
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if ((tag === 'input' && e.target !== inputRef.current) || tag === 'textarea') return;
      if (e.key.length === 1) {
        if (e.target === inputRef.current) return; // handled by onInput
        fire(e.key);
        setTouched(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      delete document.body.dataset.typing;
    };
  }, [visible]);

  // ghost typing demo until the visitor does something
  useEffect(() => {
    if (!loaded || touched) return;
    let i = 0;
    let timer;
    const start = setTimeout(function tick() {
      if (performance.now() - lastInput.current < 2500 && i === 0) { timer = setTimeout(tick, 1000); return; }
      fire(GHOST[i % GHOST.length], true);
      i++;
      timer = setTimeout(tick, i % GHOST.length === 0 ? 4200 : 150 + Math.random() * 120);
    }, 1400);
    return () => { clearTimeout(start); clearTimeout(timer); };
  }, [loaded, touched]);

  // spike → flash + chord
  useEffect(() => {
    const on = () => {
      playChord();
      const f = flashRef.current;
      if (f) f.animate([{ opacity: 0.22 }, { opacity: 0 }], { duration: 700, easing: 'cubic-bezier(.16,1,.3,1)' });
    };
    sim.listeners.add(on);
    return () => sim.listeners.delete(on);
  }, []);

  // per-frame DOM: readouts, trace, mega type, scroll choreography
  useEffect(() => {
    let raf;
    const spans = megaRef.current ? Array.from(megaRef.current.children) : [];
    const widths = spans.map(() => 100);
    const ctx = traceRef.current?.getContext('2d');
    const loop = () => {
      const p = progress.current;
      const V = sim.V;
      if (vBar.current) vBar.current.style.transform = `scaleX(${Math.min(1, V / THRESHOLD)})`;
      if (vNum.current) vNum.current.textContent = V.toFixed(2);
      if (spikesRef.current) spikesRef.current.textContent = String(sim.spikes).padStart(3, '0');
      // oscilloscope
      if (ctx) {
        const c = traceRef.current, w = c.width, h = c.height, n = sim.trace.length;
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,.12)';
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(0, h - (THRESHOLD / 1.7) * h); ctx.lineTo(w, h - (THRESHOLD / 1.7) * h); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#ff4f1f';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const v = sim.trace[(sim.traceHead + i) % n];
          const x = (i / (n - 1)) * w, y = h - 2 - (v / 1.7) * (h - 4);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      // mega type: width axis follows the cursor and the membrane potential
      const spikeK = Math.max(0, 1 - (sim.time - sim.lastSpike) * 1.5);
      spans.forEach((s, i) => {
        const r = s.getBoundingClientRect();
        const dx = (r.left + r.width / 2 - live.pointerPx.x) / window.innerWidth;
        const dy = (r.top + r.height / 2 - live.pointerPx.y) / window.innerHeight;
        const near = Math.exp(-(dx * dx * 9 + dy * dy * 3));
        const target = 62 + near * 88 + V * 25 + spikeK * 40;
        widths[i] += (Math.min(150, target) - widths[i]) * (live.snap ? 1 : 0.12);
        s.style.fontVariationSettings = `'wdth' ${widths[i].toFixed(1)}`;
        s.style.color = spikeK > 0.05 ? `rgba(255,${Math.round(79 + (1 - spikeK) * 176)},${Math.round(31 + (1 - spikeK) * 224)},1)` : '';
      });
      // scroll choreography
      if (copyRef.current) {
        const k = Math.min(1, p / 0.32);
        copyRef.current.style.opacity = String(1 - k);
        copyRef.current.style.transform = `translate3d(0, ${-k * 60}px, 0)`;
      }
      if (copy2Ref.current) {
        const k = Math.min(1, Math.max(0, (p - 0.3) / 0.2)) * (1 - Math.min(1, Math.max(0, (p - 0.82) / 0.15)));
        copy2Ref.current.style.opacity = String(k);
        copy2Ref.current.style.transform = `translate3d(0, ${(1 - k) * 40}px, 0)`;
      }
      if (megaRef.current) {
        megaRef.current.style.transform = `translate3d(0, ${-p * 12}vh, 0) scale(${1 + p * 0.25})`;
        megaRef.current.style.opacity = String(1 - Math.min(1, p * 5)); // gone before it reaches the HUD
      }
      if (hintRef.current) hintRef.current.style.opacity = String(Math.max(0, 1 - p * 5));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [progress]);

  const onCanvasPointer = (e) => {
    setTouched(true);
    lastInput.current = performance.now();
    const b = stimulate();
    stimulate((b + 0.03) % 1);
    playBlip(0.6, 0.4);
  };

  return (
    <>
      <div className="absolute inset-0" onPointerDown={onCanvasPointer} data-cursor="Stimulate">
        <ChapterCanvas camera={{ position: [-1.2, 0.35, 7.2], fov: 34, near: 0.1, far: 60 }} fallback={<StaticFallback />}>
          <NeuronScene progress={progress} />
        </ChapterCanvas>
      </div>

      {/* activation flash */}
      <div ref={flashRef} className="pointer-events-none absolute inset-0 opacity-0" style={{ background: 'radial-gradient(60% 60% at 62% 45%, rgba(255,79,31,.55), transparent 70%)' }} />

      {/* mega wordmark — in front of the canvas, difference-blended so branches invert through it */}
      <div className="pointer-events-none absolute inset-x-0 top-[9svh] flex justify-center mix-blend-difference" aria-hidden>
        <div ref={megaRef} className="mega flex whitespace-nowrap text-white will-change-transform" style={{ fontSize: 'clamp(72px, min(19.5vw, 34svh), 340px)' }}>
          {WORD.split('').map((c, i) => (
            <span key={i} style={{ fontVariationSettings: "'wdth' 100", transition: 'color .6s' }}>{c}</span>
          ))}
        </div>
      </div>

      {/* flying letters */}
      <div ref={lettersRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />

      {/* copy */}
      <div ref={copyRef} className="pointer-events-none absolute bottom-[96px] left-[var(--gx)] max-w-[min(560px,88vw)] will-change-transform">
        <div className="hud mb-6 flex items-center gap-3">
          <span className="h-1.5 w-1.5 rounded-full bg-signal shadow-[0_0_10px_var(--signal)]" />
          L0 / Input
        </div>
        <h1 className="display" style={{ fontSize: 'clamp(32px, min(4.6vw, 8svh), 76px)' }}>
          Learn AI<br />from the <span className="serif text-signal" style={{ fontSize: '1.08em', letterSpacing: '-0.02em' }}>inside.</span>
        </h1>
        <p className="body mt-7">
          Every model you have heard of is built from one tiny idea: a unit that adds up its inputs and
          decides whether to fire. <span className="text-fg">Type anything</span> — your keystrokes are its input.
        </p>
        <div ref={hintRef} className="mt-8 flex flex-wrap items-center gap-3 pointer-events-auto">
          <span className="hud flex items-center gap-2 text-fg-68">
            <kbd className="rounded border border-[var(--hairline)] px-1.5 py-0.5 font-mono text-[10px] text-fg">A–Z</kbd>
            type to stimulate
          </span>
          <span className="hud text-fg-22">/</span>
          <span className="hud">click the neuron</span>
          {touch && (
            <button className="pill" onClick={() => inputRef.current?.focus()}>Tap to type</button>
          )}
          <input
            ref={inputRef}
            aria-label="Type to stimulate the neuron"
            className="sr-only-focusable absolute opacity-0"
            onInput={(e) => {
              const v = e.currentTarget.value;
              if (v) fire(v.slice(-1));
              e.currentTarget.value = '';
              setTouched(true);
            }}
          />
        </div>
      </div>

      <div ref={copy2Ref} className="pointer-events-none absolute bottom-[96px] left-[var(--gx)] max-w-[min(560px,88vw)] opacity-0">
        <div className="hud mb-5">What you just watched</div>
        <h2 className="h3 text-fg">
          Signals arrive. They add up. Past a threshold, it <span className="serif text-signal">fires.</span>
        </h2>
        <p className="body mt-5">
          A biological neuron leaks its charge over time, so only inputs that arrive together can push it over
          the edge. Artificial neural networks keep the essence — weighted sums and a decision — and stack
          billions of them. Scroll on: you are the signal now.
        </p>
      </div>

      {/* readouts */}
      <div className="pointer-events-none absolute bottom-[86px] right-[var(--gx)] w-[230px] hud hidden lg:block">
        <div className="flex justify-between"><span>Membrane potential</span><span ref={vNum} className="text-fg">0.00</span></div>
        <div className="mt-2 h-px bg-[var(--hairline)]"><div ref={vBar} className="h-px origin-left bg-signal" style={{ transform: 'scaleX(0)' }} /></div>
        <canvas ref={traceRef} width={460} height={90} className="mt-3 h-[45px] w-full" />
        <div className="mt-2 flex justify-between"><span>Threshold θ</span><span className="text-fg-68">{THRESHOLD.toFixed(2)}</span></div>
        <div className="flex justify-between"><span>Spikes</span><span ref={spikesRef} className="text-signal">000</span></div>
        <div className="mt-2 flex justify-between text-fg-22"><span>Input</span><span ref={typedRef} className="normal-case tracking-normal text-fg-42" /></div>
      </div>

      <div className="short-hide pointer-events-none absolute bottom-[86px] left-1/2 -translate-x-1/2 hud hidden xl:flex flex-col items-center gap-2 text-fg-22">
        <span>Scroll — become the signal</span>
        <span className="h-8 w-px overflow-hidden bg-[var(--hairline)]"><span className="block h-3 w-px animate-[drip_1.8s_cubic-bezier(.16,1,.3,1)_infinite] bg-signal" /></span>
      </div>
    </>
  );
}

function StaticFallback() {
  return (
    <div className="absolute inset-0" style={{ background: 'radial-gradient(40% 50% at 65% 45%, rgba(168,240,255,.08), transparent 70%)' }} />
  );
}

export default function InputChapter() {
  return (
    <Chapter id="input" length={2.6} label="Input — learn AI from the inside">
      <Stage />
    </Chapter>
  );
}
