'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';

const RES = 280; // internal pad resolution (10× MNIST)
const BRUSH = 19;

/**
 * The drawing pad (mouse / pen / touch). Emits the ink as a Float32 grey image on every change,
 * throttled to animation frames: onInput(gray, w, h, phase) with phase 'start' | 'move' | 'end'.
 */
const Pad = forwardRef(function Pad({ onInput, disabled }, ref) {
  const canvas = useRef(null);
  const gray = useRef(new Float32Array(RES * RES));
  const drawing = useRef(false);
  const last = useRef(null);
  const raf = useRef(0);
  const pendingPhase = useRef(null);
  const hasInk = useRef(false);
  const hint = useRef(null);

  const ctx = () => canvas.current.getContext('2d', { willReadFrequently: true });

  const emit = useCallback(
    (phase) => {
      // 'start' and 'end' always win over a queued 'move'
      if (!pendingPhase.current || phase !== 'move') pendingPhase.current = phase;
      if (raf.current) return;
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        const ph = pendingPhase.current;
        pendingPhase.current = null;
        if (!hasInk.current) return onInput(null, RES, RES, ph);
        const d = ctx().getImageData(0, 0, RES, RES).data;
        const g = gray.current;
        for (let i = 0; i < RES * RES; i++) g[i] = d[i * 4 + 3] / 255;
        onInput(g, RES, RES, ph);
      });
    },
    [onInput]
  );

  const setHint = (on) => { if (hint.current) hint.current.style.opacity = on ? '1' : '0'; };

  useImperativeHandle(ref, () => ({
    clear() {
      ctx().clearRect(0, 0, RES, RES);
      hasInk.current = false;
      setHint(true);
      emit('end');
    },
    /** Paint a 28×28 MNIST digit (0..1 floats) onto the pad, then run it like a drawing. */
    drawSample(x) {
      const c = ctx();
      c.clearRect(0, 0, RES, RES);
      const off = document.createElement('canvas');
      off.width = off.height = 28;
      const o = off.getContext('2d');
      const img = o.createImageData(28, 28);
      for (let i = 0; i < 784; i++) {
        img.data[i * 4] = 255; img.data[i * 4 + 1] = 106; img.data[i * 4 + 2] = 61;
        img.data[i * 4 + 3] = Math.round(x[i] * 255);
      }
      o.putImageData(img, 0, 0);
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(off, 0, 0, RES, RES);
      hasInk.current = true;
      setHint(false);
      emit('start');
      setTimeout(() => emit('end'), 30);
    },
  }));

  const point = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * RES, ((e.clientY - r.top) / r.height) * RES];
  };

  const stroke = (a, b) => {
    const c = ctx();
    c.strokeStyle = '#FF6A3D';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = BRUSH;
    c.beginPath();
    c.moveTo(a[0], a[1]);
    c.lineTo(b[0], b[1]);
    c.stroke();
  };

  const down = (e) => {
    if (disabled) return;
    e.preventDefault();
    canvas.current.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const p = point(e);
    last.current = p;
    stroke(p, [p[0] + 0.01, p[1]]);
    hasInk.current = true;
    setHint(false);
    emit('start');
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) {
      const p = point(ev);
      stroke(last.current, p);
      last.current = p;
    }
    emit('move');
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    emit('end');
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-[10px] border border-hairline" style={{ background: 'radial-gradient(120% 120% at 50% 40%, rgb(168 240 255 / 0.05), rgb(5 5 6 / 0.6))' }}>
      {/* 28×28 guide grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'linear-gradient(rgb(255 255 255 / 0.045) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.045) 1px, transparent 1px)',
          backgroundSize: `${100 / 14}% ${100 / 14}%`,
        }}
      />
      <canvas
        ref={canvas}
        width={RES}
        height={RES}
        data-cursor="Draw"
        data-lenis-prevent
        role="img"
        aria-label="Drawing pad: draw a digit from 0 to 9 with your mouse, pen or finger"
        className="relative block h-full w-full"
        style={{ touchAction: 'none', filter: 'drop-shadow(0 0 6px rgb(255 79 31 / 0.55))' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
      />
      <div ref={hint} className="hud pointer-events-none absolute inset-0 grid place-items-center text-fg-42 transition-opacity duration-500" style={{ opacity: 0 }}>
        draw here
      </div>
    </div>
  );
});

export default Pad;
