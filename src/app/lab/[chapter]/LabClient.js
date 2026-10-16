'use client'

import { useEffect } from 'react';
import { LOADERS } from '@/chapters/loaders';
import { CHAPTERS } from '@/chapters/registry';
import { useStore } from '@/lib/store';

/**
 * Isolated chapter sandbox for development: /lab/<id>. Renders one chapter with a short lead-in and
 * tail so its pinned scroll range can be screenshotted at any progress.
 */
export default function LabClient({ chapter }) {
  const setLoaded = useStore((s) => s.setLoaded);
  useEffect(() => setLoaded(true), [setLoaded]);
  const C = LOADERS[chapter];
  if (!C) {
    return (
      <div className="gx py-32">
        <div className="hud mb-6">Lab — choose a chapter</div>
        {CHAPTERS.map((c) => (
          <a key={c.id} href={`/lab/${c.id}`} className="display block hover:text-signal">{c.layer} {c.title}</a>
        ))}
      </div>
    );
  }
  return (
    <>
      <div className="h-[30svh] bg-void" />
      <C />
      <div className="h-[30svh] bg-void" />
    </>
  );
}
