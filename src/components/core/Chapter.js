'use client'

import { useRef } from 'react';
import { ChapterContext, useChapterRegistration } from '@/lib/chapter';

/**
 * A pinned chapter: a tall <section> (length × 100svh) with a sticky full-viewport stage inside.
 * Scroll progress through the section (0..1) is available via useChapter().progress.current.
 *
 * Props:
 *  id        chapter id (also the DOM id / anchor)
 *  length    section height in viewports (default 4). 1 = not pinned, just a full-screen panel.
 *  tone      'dark' | 'paper'
 *  label     accessible name for the section
 */
export default function Chapter({ id, length = 4, tone = 'dark', label, className = '', children }) {
  const ref = useRef(null);
  const ctx = useChapterRegistration(id, ref);
  return (
    <ChapterContext.Provider value={ctx}>
      <section
        ref={ref}
        id={id}
        data-chapter={id}
        data-tone={tone}
        aria-label={label || id}
        className={`relative ${tone === 'paper' ? 'bg-paper' : 'bg-void'} ${className}`}
        style={{ height: `${length * 100}svh` }}
      >
        <div className="sticky top-0 h-[100svh] w-full overflow-hidden">{children}</div>
      </section>
    </ChapterContext.Provider>
  );
}
