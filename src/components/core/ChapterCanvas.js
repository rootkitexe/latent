'use client'

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { useChapter } from '@/lib/chapter';
import { useStore } from '@/lib/store';

/**
 * The WebGL canvas for one chapter. Mounted only while the chapter is near the viewport, rendering
 * only while visible — so at most ~2 GL contexts exist at once.
 *
 * Props are passed through to R3F <Canvas> (camera, gl, …). `fallback` renders when WebGL is
 * unavailable (gpuTier 0) — always provide a meaningful static fallback.
 */
export default function ChapterCanvas({ children, fallback = null, className = '', eventSource, ...props }) {
  const { near, visible } = useChapter();
  const gpuTier = useStore((s) => s.gpuTier);
  if (gpuTier === 0) return fallback;
  if (!near) return null;
  return (
    <div className={`absolute inset-0 ${className}`}>
      <Canvas
        dpr={[1, gpuTier >= 2 ? 1.5 : 1.25]}
        frameloop={visible ? 'always' : 'never'}
        gl={{ antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false }}
        eventSource={eventSource}
        {...props}
      >
        <Suspense fallback={null}>{children}</Suspense>
      </Canvas>
    </div>
  );
}
