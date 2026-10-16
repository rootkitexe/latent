'use client'

import { useEffect, useRef, useState } from 'react';

/**
 * "more ↓" for explainers that don't fit. Every chapter's explainer is a `.fit-copy` area that fades
 * out when the window is too short. This layer watches those areas and, only when one is actually
 * cut off and on screen, shows a small toggle at its fade. Opening it lays the full text over the scene
 * in a soft panel (controls stay usable around it); scrolling on, Esc or clicking outside closes it.
 *
 * It lives in its own fixed layer so chapter components need no changes.
 */
function effectiveOpacity(el) {
  let o = 1;
  for (let e = el, n = 0; e && n < 8; e = e.parentElement, n++) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
    o *= parseFloat(cs.opacity);
  }
  return o;
}

export default function FitMore() {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(null); // { html, rect, tone }
  const target = useRef(null);
  const openRef = useRef(null);
  openRef.current = open;

  // find the one visible, overflowing explainer and pin the toggle to its fade
  useEffect(() => {
    let raf;
    const tick = () => {
      const btn = btnRef.current;
      let found = null;
      if (btn && !openRef.current) {
        const vh = innerHeight;
        for (const el of document.querySelectorAll('.fit-copy')) {
          const r = el.getBoundingClientRect();
          // (an explainer squeezed to zero height still counts: that is exactly when the toggle matters)
          if (el.offsetParent === null || r.bottom < 60 || r.top > vh - 60) continue;
          if (el.scrollHeight <= el.clientHeight + 6) continue; // fits: nothing to do
          if (effectiveOpacity(el) < 0.5) continue;
          found = { el, r };
          break;
        }
      }
      target.current = found?.el || null;
      if (btn) {
        if (found) {
          // sit in the gap under the faded line, clear of both the text above and the controls below
          btn.style.transform = `translate3d(${Math.round(found.r.left)}px, ${Math.round(found.r.bottom - (found.r.height > 20 ? 6 : 2))}px, 0)`;
          btn.dataset.on = '1';
          btn.dataset.tone = found.el.closest('[data-tone]')?.dataset.tone || 'dark';
        } else btn.dataset.on = '0';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // close on scroll (the step may change), Esc, or a click outside the panel
  useEffect(() => {
    if (!open) return;
    const y0 = window.scrollY;
    const onScroll = () => { if (Math.abs(window.scrollY - y0) > 40) setOpen(null); };
    const onKey = (e) => e.key === 'Escape' && setOpen(null);
    const onDown = (e) => { if (!e.target.closest?.('.fit-panel')) setOpen(null); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);

  const show = () => {
    const el = target.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setOpen({
      html: el.innerHTML,
      rect: { left: r.left, top: r.top, width: r.width },
      tone: el.closest('[data-tone]')?.dataset.tone || 'dark',
    });
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <button
        ref={btnRef}
        type="button"
        className="fit-more pointer-events-auto"
        data-on="0"
        onClick={show}
        aria-label="Read the full explanation"
        data-cursor="Read"
      >
        more <span aria-hidden>↓</span>
      </button>

      {open && (
        <div
          className="fit-panel pointer-events-auto"
          data-tone={open.tone}
          data-lenis-prevent
          role="dialog"
          aria-label="Full explanation"
          style={{
            left: open.rect.left - 16,
            top: open.rect.top - 14,
            width: open.rect.width + 32,
            maxHeight: `calc(100svh - ${Math.round(open.rect.top - 14)}px - 84px)`,
          }}
        >
          <div className="fit-panel-body" dangerouslySetInnerHTML={{ __html: open.html }} />
          <button type="button" className="fit-more fit-less" data-on="1" onClick={() => setOpen(null)} aria-label="Close the full explanation">
            less <span aria-hidden>↑</span>
          </button>
        </div>
      )}
    </div>
  );
}
