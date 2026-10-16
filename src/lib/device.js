'use client'

/** Rough GPU tier: 0 low, 1 mid, 2 high. Runs once on the client. */
export function detectDevice() {
  if (typeof window === 'undefined') return { gpuTier: 2, touch: false, reducedMotion: false };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let gpuTier = 2;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) gpuTier = 0;
    else {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const r = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
      const s = String(r).toLowerCase();
      if (/swiftshader|llvmpipe|software/.test(s)) gpuTier = 0;
      else if (/intel|mali|adreno|apple gpu|mx\d{3}/.test(s)) gpuTier = 1;
      if (touch && gpuTier > 1) gpuTier = 1;
      if ((navigator.hardwareConcurrency || 4) <= 4 && gpuTier > 1) gpuTier = 1;
    }
  } catch {
    gpuTier = 1;
  }
  // Debug overrides: ?gpu=0|1|2 forces the tier, ?snap=1 makes all frame lerps instant.
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has('gpu')) gpuTier = Math.max(0, Math.min(2, Number(q.get('gpu'))));
  } catch {}
  return { gpuTier, touch, reducedMotion };
}
