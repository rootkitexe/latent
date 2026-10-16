'use client'

import { useEffect, useRef } from 'react';
import Chapter from '@/components/core/Chapter';
import ChapterCanvas from '@/components/core/ChapterCanvas';
import { useChapter, goToChapter } from '@/lib/chapter';
import { playBlip } from '@/lib/audio';
import { sim } from '@/chapters/input/sim';
import { finale } from './state';
import StackScene from './StackScene';

const RECAP = [
  { id: 'neuron', l: 'L1', t: 'The Neuron', d: 'Weigh the inputs, add a bias, decide.' },
  { id: 'descent', l: 'L2', t: 'Gradient Descent', d: 'Measure the error, step downhill.' },
  { id: 'network', l: 'L3', t: 'Deep Networks', d: 'Layers of neurons, each asking a better question.' },
  { id: 'embeddings', l: 'L4', t: 'Embeddings', d: 'Meaning becomes position in space.' },
  { id: 'attention', l: 'L5', t: 'Attention', d: 'Every word looks at every other word.' },
  { id: 'diffusion', l: 'L6', t: 'Diffusion', d: 'Images sculpted out of noise.' },
  { id: 'reinforce', l: 'L7', t: 'Reinforcement', d: 'Learning from reward, by trial and error.' },
];

const STUDIO = {
  cal: 'https://cal.com/haloxion/30min',
  email: 'info@haloxion.com',
  site: 'https://haloxion.com',
};

function band(p, a, b, fade = 0.06) {
  const i = Math.min(1, Math.max(0, (p - a) / fade));
  const o = 1 - Math.min(1, Math.max(0, (p - b) / fade));
  return Math.min(i, o);
}

function Stage() {
  const { progress } = useChapter();
  const aRef = useRef(null);
  const bRef = useRef(null);
  const cRef = useRef(null);
  const outRef = useRef(null);
  const statsRef = useRef(null);

  useEffect(() => {
    let raf;
    const loop = () => {
      const p = progress.current;
      const set = (el, k, dy = 30) => {
        if (!el) return;
        el.style.opacity = String(k);
        el.style.transform = `translate3d(0, ${(1 - k) * dy}px, 0)`;
        el.style.pointerEvents = k > 0.5 ? 'auto' : 'none';
      };
      set(aRef.current, band(p, 0.02, 0.36));
      set(bRef.current, band(p, 0.44, 0.7));
      set(cRef.current, band(p, 0.74, 1.2));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [progress]);

  // refresh the personal stats whenever the decoded section comes into view
  useEffect(() => {
    const t = setInterval(() => {
      if (outRef.current) outRef.current.textContent = finale.outputText();
      if (statsRef.current) {
        statsRef.current.innerHTML = `
          <div><div class="text-fg-22">Keystrokes you fed in</div><div class="text-fg text-[13px]">${sim.inputs}</div></div>
          <div><div class="text-fg-22">Times the neuron fired</div><div class="text-signal text-[13px]">${sim.spikes}</div></div>
          <div><div class="text-fg-22">Final loss</div><div class="text-fg text-[13px]">0.038</div></div>`;
      }
    }, 600);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <ChapterCanvas camera={{ position: [0, -1.2, 9.5], fov: 38, near: 0.1, far: 80 }}>
        <StackScene progress={progress} />
      </ChapterCanvas>

      {/* A — the recap */}
      <div ref={aRef} className="absolute left-[var(--gx)] top-[13svh] w-[min(520px,88vw)] opacity-0">
        <div className="hud mb-5 flex items-center gap-3"><span className="h-1.5 w-1.5 rounded-full bg-signal" />L8 / Output</div>
        <h2 className="display" style={{ fontSize: 'clamp(36px, 4.4vw, 72px)' }}>
          Everything you passed through is <span className="serif text-signal">one network.</span>
        </h2>
        <ol className="mt-9 border-t border-[var(--hairline)]">
          {RECAP.map((r, i) => (
            <li key={r.id} className="border-b border-[var(--hairline)]">
              <button
                className="group flex w-full items-baseline gap-5 py-3 text-left"
                data-cursor="Revisit"
                onPointerEnter={() => { finale.hover = i + 1; playBlip((i + 1) / 8, 0.3); }}
                onPointerLeave={() => (finale.hover = -1)}
                onFocus={() => (finale.hover = i + 1)}
                onBlur={() => (finale.hover = -1)}
                onClick={() => goToChapter(r.id)}
              >
                <span className="hud w-6 shrink-0 transition-colors duration-500 group-hover:text-signal">{r.l}</span>
                <span className="h3 shrink-0 text-[18px] transition-transform duration-700 ease-expo group-hover:translate-x-2" style={{ fontSize: 'clamp(16px, 1.25vw, 20px)' }}>{r.t}</span>
                <span className="ml-auto hidden text-right text-[13px] text-fg-42 sm:block">{r.d}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      {/* B — the decoded output */}
      <div ref={bRef} className="absolute inset-x-0 bottom-[96px] flex flex-col items-center px-[var(--gx)] text-center opacity-0">
        <div className="hud mb-4">The output layer decodes</div>
        <p className="h3 max-w-[22ch]">
          What went in at <span className="serif text-signal">the very start</span> comes out the other side.
        </p>
        <div className="hud mt-5 text-fg-68">→ <span ref={outRef} className="text-fg">HELLO, WORLD</span></div>
        <div ref={statsRef} className="hud mt-8 grid grid-cols-3 gap-10 text-left" />
      </div>

      {/* C — the studio */}
      <div ref={cRef} className="absolute inset-0 flex flex-col justify-end px-[var(--gx)] pb-[96px] opacity-0">
        <div className="absolute inset-0 -z-0" style={{ background: 'linear-gradient(180deg, transparent 20%, rgba(5,5,6,.82) 70%)' }} />
        <div className="relative">
          <div className="hud mb-6">Training complete · loss 0.038 · 240 epochs</div>
          <h2 className="display max-w-[16ch]" style={{ fontSize: 'clamp(42px, 6.6vw, 112px)' }}>
            That&apos;s the whole trick, repeated <span className="serif text-signal">a few billion times.</span>
          </h2>
          <div className="mt-10 flex flex-col gap-8 border-t border-[var(--hairline)] pt-8 md:flex-row md:items-end md:justify-between">
            <p className="body">
              LATENT is a demo by <span className="text-fg">Haloxion</span>, an AI-first design studio. We build
              interfaces like this one — where the interaction is the explanation.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href={STUDIO.cal} target="_blank" rel="noreferrer" className="pill !h-12 !bg-signal !border-signal !px-6 !text-white" data-cursor="Book">
                Start a project ↗
              </a>
              <button className="pill !h-12 !px-6" onClick={() => goToChapter('input')} data-cursor="Again">
                Run it again ↑
              </button>
            </div>
          </div>
          <div className="hud mt-10 flex flex-wrap justify-between gap-4 text-fg-22">
            <span>© 2026 Haloxion</span>
            <a href={`mailto:${STUDIO.email}`} className="hover:text-fg">{STUDIO.email}</a>
            <a href={STUDIO.site} target="_blank" rel="noreferrer" className="hover:text-fg">haloxion.com</a>
            <span>Made with three.js, a neuron from Blender, and a lot of gradients</span>
          </div>
        </div>
      </div>
    </>
  );
}

export default function OutputChapter() {
  return (
    <Chapter id="output" length={4} label="Output — the whole network">
      <Stage />
    </Chapter>
  );
}
