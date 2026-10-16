'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { live } from '@/lib/store';

/**
 * Chapter runtime. <Chapter> (src/components/core/Chapter.js) registers its section here; one rAF loop
 * measures every registered section and writes progress/visibility into `live.chapters[id]`.
 *
 * Inside a chapter, use:
 *   const { id, progress, near, visible } = useChapter();
 *   progress.current  -> 0..1 scroll progress through the pinned section (read in useFrame / rAF)
 *   near, visible     -> React state booleans (near = within ~1 viewport; visible = on screen)
 */
export const ChapterContext = createContext(null);

export function useChapter() {
  const ctx = useContext(ChapterContext);
  if (!ctx) throw new Error('useChapter() must be used inside <Chapter>');
  return ctx;
}

const registry = new Map(); // id -> { el, progress: {current}, setNear, setVisible, near, visible }
let running = false;

function measure() {
  const vh = window.innerHeight;
  let best = null;
  let bestCover = 0;
  for (const [id, c] of registry) {
    const r = c.el.getBoundingClientRect();
    const span = Math.max(1, r.height - vh);
    const p = Math.min(1, Math.max(0, -r.top / span));
    c.progress.current = p;
    const visible = r.top < vh && r.bottom > 0;
    const near = r.top < vh * 2 && r.bottom > -vh;
    if (visible !== c.visible) { c.visible = visible; c.setVisible(visible); }
    if (near !== c.near) { c.near = near; c.setNear(near); }
    live.chapters[id] = { progress: p, visible, near };
    const cover = Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top));
    if (cover > bestCover) { bestCover = cover; best = id; }
  }
  if (best && best !== live.active) {
    live.active = best;
    window.dispatchEvent(new CustomEvent('latent:active', { detail: best }));
  }
}

function loop() {
  if (!running) return;
  if (registry.size) measure();
  requestAnimationFrame(loop);
}

export function useChapterRegistration(id, ref) {
  const progress = useRef(0);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    registry.set(id, { el, progress, setNear, setVisible, near: false, visible: false });
    if (!running) { running = true; requestAnimationFrame(loop); }
    measure();
    return () => {
      registry.delete(id);
      delete live.chapters[id];
      if (!registry.size) running = false;
    };
  }, [id, ref]);
  return { id, progress, near, visible };
}

/** Smooth-scroll to a chapter by id (uses Lenis when present). */
export function goToChapter(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (window.__lenis) window.__lenis.scrollTo(el, { duration: 2.2 });
  else el.scrollIntoView({ behavior: 'smooth' });
}
