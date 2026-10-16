'use client'

import { useEffect } from 'react';
import Lenis from 'lenis';
import { gsap, ScrollTrigger } from '@/lib/gsap';
import { live, useStore } from '@/lib/store';
import { detectDevice } from '@/lib/device';
import { goToChapter } from '@/lib/chapter';
import { CHAPTERS } from '@/chapters/registry';

/** Global wiring: device tier, Lenis ↔ GSAP, pointer tracking, idle, keyboard layer jumps. */
export default function Providers({ children }) {
  const setDevice = useStore((s) => s.setDevice);
  const setActive = useStore((s) => s.setActive);

  useEffect(() => {
    setDevice(detectDevice());
  }, [setDevice]);

  // Lenis + GSAP ticker
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const onNative = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      live.scrollY = window.scrollY;
      live.scroll = max > 0 ? window.scrollY / max : 0;
    };
    if (reduce) {
      window.addEventListener('scroll', onNative, { passive: true });
      onNative();
      return () => window.removeEventListener('scroll', onNative);
    }
    const lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.5,
    });
    window.__lenis = lenis;
    lenis.on('scroll', ({ scroll, limit, velocity }) => {
      live.scrollY = scroll;
      live.scroll = limit > 0 ? scroll / limit : 0;
      live.velocity = velocity;
      ScrollTrigger.update();
    });
    const tick = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      delete window.__lenis;
    };
  }, []);

  // Pointer + idle
  useEffect(() => {
    let idleT;
    const wake = () => {
      live.idle = false;
      clearTimeout(idleT);
      idleT = setTimeout(() => (live.idle = true), 6000);
    };
    const move = (e) => {
      live.pointerPx.x = e.clientX;
      live.pointerPx.y = e.clientY;
      live.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      live.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
      wake();
    };
    const down = () => { live.pointerDown = true; wake(); };
    const up = () => (live.pointerDown = false);
    const vis = () => (live.hidden = document.hidden);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', wake);
    document.addEventListener('visibilitychange', vis);
    wake();
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', wake);
      document.removeEventListener('visibilitychange', vis);
      clearTimeout(idleT);
    };
  }, []);

  // Active chapter → store (for the HUD)
  useEffect(() => {
    const on = (e) => setActive(e.detail);
    window.addEventListener('latent:active', on);
    return () => window.removeEventListener('latent:active', on);
  }, [setActive]);

  // Keyboard: 0–8 jump to layers when not typing
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const tag = (t?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
      if (/^[0-8]$/.test(e.key) && document.body.dataset.typing !== '1') {
        const c = CHAPTERS[Number(e.key)];
        if (c) goToChapter(c.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return children;
}
