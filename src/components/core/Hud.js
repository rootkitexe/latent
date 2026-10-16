'use client'

import { useEffect, useRef } from 'react';
import { live, useStore } from '@/lib/store';
import { CHAPTERS, chapterIndex } from '@/chapters/registry';
import { goToChapter } from '@/lib/chapter';
import { setSoundEnabled, setDepth } from '@/lib/audio';

/**
 * The instrument frame. The page *trains as you read*: epoch, loss and tokens are derived from global
 * scroll progress (loss follows a noisy exponential decay, like a real curve).
 */
export default function Hud() {
  const active = useStore((s) => s.active);
  const sound = useStore((s) => s.sound);
  const setSound = useStore((s) => s.setSound);
  const loaded = useStore((s) => s.loaded);
  const epochRef = useRef(null);
  const lossRef = useRef(null);
  const tokRef = useRef(null);
  const barRef = useRef(null);
  const sparkRef = useRef(null);
  const tone = useRef('dark');
  const rootRef = useRef(null);

  useEffect(() => {
    let raf;
    let shown = 0;
    const hist = [];
    const loop = () => {
      shown += (live.scroll - shown) * (live.snap ? 1 : 0.08);
      const s = shown;
      const epoch = Math.round(s * 240);
      const wiggle = Math.sin(s * 140) * 0.035 * (1 - s) + Math.sin(s * 37) * 0.02 * (1 - s);
      const loss = Math.max(0.038, 2.31 * Math.exp(-s * 4.1) + 0.035 + wiggle);
      if (epochRef.current) epochRef.current.textContent = String(epoch).padStart(3, '0');
      if (lossRef.current) lossRef.current.textContent = loss.toFixed(3);
      if (tokRef.current) tokRef.current.textContent = (s * 1.3e9 / 1e6).toFixed(1) + 'M';
      if (barRef.current) barRef.current.style.transform = `scaleX(${s})`;
      // tiny live loss sparkline
      if (sparkRef.current && Math.abs((hist[hist.length - 1] ?? -1) - loss) > 0.0005) {
        hist.push(loss);
        if (hist.length > 48) hist.shift();
        const max = 2.4;
        sparkRef.current.setAttribute('points', hist.map((v, i) => `${(i / 47) * 64},${16 - (v / max) * 15}`).join(' '));
      }
      setDepth(s);
      // tone: invert HUD colours over paper chapters
      const sec = document.querySelector(`[data-chapter="${live.active}"]`);
      const t = sec?.dataset.tone === 'paper' ? 'paper' : 'dark';
      if (t !== tone.current && rootRef.current) {
        tone.current = t;
        rootRef.current.dataset.tone = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggleSound = () => {
    const on = !sound;
    setSound(on);
    setSoundEnabled(on);
  };

  const ai = chapterIndex(active);

  return (
    <div
      ref={rootRef}
      data-tone="dark"
      className={`pointer-events-none fixed inset-0 z-50 transition-opacity duration-1000 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      style={{ background: 'transparent' }}
    >
      {/* progress hairline */}
      <div className="absolute left-0 right-0 top-0 h-px bg-[var(--hairline)]">
        <div ref={barRef} className="h-full origin-left bg-signal" style={{ transform: 'scaleX(0)' }} />
      </div>

      {/* TL */}
      <div className="absolute left-[var(--gx)] top-5 hud flex items-center gap-3">
        <a href="#input" className="pointer-events-auto text-fg" data-cursor="Top">LATENT</a>
        <span className="hidden sm:inline">— Field guide to machine minds</span>
      </div>

      {/* TR: layer index */}
      <nav aria-label="Layers" className="absolute right-[var(--gx)] top-4 hidden md:flex gap-1 pointer-events-auto">
        {CHAPTERS.map((c, i) => (
          <button
            key={c.id}
            onClick={() => goToChapter(c.id)}
            data-cursor={c.title}
            aria-label={`${c.layer} ${c.title}`}
            aria-current={active === c.id ? 'step' : undefined}
            className="group relative grid h-7 w-9 place-items-center hud transition-colors duration-500"
            style={{ color: active === c.id ? 'var(--signal)' : i < ai ? 'rgb(var(--fg-rgb) / .7)' : undefined }}
          >
            {c.layer}
            <span
              className="absolute bottom-0 left-2 right-2 h-px origin-left transition-transform duration-700 ease-expo"
              style={{ background: 'var(--signal)', transform: `scaleX(${active === c.id ? 1 : 0})` }}
            />
          </button>
        ))}
      </nav>

      {/* BL: training readout */}
      <div className="absolute bottom-5 left-[var(--gx)] hud flex items-end gap-5">
        <div>
          <div className="text-fg-22">Training</div>
          <div>
            EPOCH <span ref={epochRef} className="text-fg">000</span>
            <span className="mx-2 text-fg-22">·</span>
            LOSS <span ref={lossRef} className="text-signal">2.310</span>
          </div>
        </div>
        <svg width="64" height="18" className="hidden sm:block overflow-visible" aria-hidden>
          <polyline ref={sparkRef} fill="none" stroke="var(--signal)" strokeWidth="1" points="" />
        </svg>
        <div className="hidden lg:block">
          <div className="text-fg-22">Tokens seen</div>
          <div ref={tokRef} className="text-fg">0.0M</div>
        </div>
      </div>

      {/* BR */}
      <div className="absolute bottom-5 right-[var(--gx)] hud flex items-center gap-5">
        <button
          onClick={toggleSound}
          className="pointer-events-auto flex items-center gap-2 uppercase tracking-[inherit]"
          data-cursor={sound ? 'Mute' : 'Listen'}
          aria-pressed={sound}
          aria-label="Toggle sound"
        >
          <span className="flex h-3 items-end gap-[2px]" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="w-[2px] bg-current"
                style={{
                  height: sound ? undefined : '2px',
                  animation: sound ? `eq 0.${7 + i}s ${i * 0.1}s ease-in-out infinite alternate` : 'none',
                }}
              />
            ))}
          </span>
          Sound {sound ? 'on' : 'off'}
        </button>
        <span className="hidden sm:inline text-fg-22">A Haloxion demo</span>
      </div>
    </div>
  );
}
