'use client'

import { useEffect, useRef } from 'react';
import { live } from '@/lib/store';

/**
 * 5px dot + 30px ring on a spring. Over [data-cursor] / links / buttons the ring grows and shows the
 * label. Click = an activation ripple. Hidden on touch.
 */
export default function Cursor() {
  const dot = useRef(null);
  const ring = useRef(null);
  const label = useRef(null);
  const ripples = useRef(null);

  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    document.documentElement.classList.add('has-cursor');
    let rx = -100, ry = -100, vx = 0, vy = 0, scale = 1, target = 1, raf;
    let current = '';

    const over = (e) => {
      const el = e.target.closest?.('[data-cursor], a, button, input, [role="button"], label');
      const text = el ? el.getAttribute('data-cursor') ?? '' : null;
      target = el ? (text ? 2.6 : 1.7) : 1;
      if (text !== current) {
        current = text;
        label.current.textContent = text || '';
        ring.current.dataset.on = el ? 'true' : 'false';
      }
    };
    const click = (e) => {
      const r = document.createElement('span');
      r.className = 'cursor-ripple';
      r.style.left = e.clientX + 'px';
      r.style.top = e.clientY + 'px';
      ripples.current.appendChild(r);
      setTimeout(() => r.remove(), 900);
    };
    const loop = () => {
      const { x, y } = live.pointerPx;
      // critically-damped-ish spring
      vx = (vx + (x - rx) * 0.22) * 0.62;
      vy = (vy + (y - ry) * 0.22) * 0.62;
      rx += vx; ry += vy;
      scale += (target - scale) * 0.18;
      dot.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      ring.current.style.transform = `translate3d(${rx}px, ${ry}px, 0) scale(${scale})`;
      label.current.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener('pointerover', over);
    window.addEventListener('pointerdown', click);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerover', over);
      window.removeEventListener('pointerdown', click);
      document.documentElement.classList.remove('has-cursor');
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[100] hidden [@media(hover:hover)_and_(pointer:fine)]:block">
      <div ref={ripples} />
      <div ref={ring} className="cursor-ring" />
      <div ref={dot} className="cursor-dot" />
      <div ref={label} className="cursor-label" style={{ translate: '-50% -50%' }} />
    </div>
  );
}
