'use client'

import { Fragment, useEffect } from 'react';
import { CHAPTERS } from '@/chapters/registry';
import { LOADERS } from '@/chapters/loaders';
import { useStore, live } from '@/lib/store';
import Seam from '@/components/core/Seam';
import Preloader from '@/components/core/Preloader';

/** The whole forward pass: every chapter in order, joined by layer seams. */
export default function Journey() {
  const setLoaded = useStore((s) => s.setLoaded);
  useEffect(() => {
    if (live.nopre) setLoaded(true);
  }, [setLoaded]);
  return (
    <>
      <Preloader />
      {CHAPTERS.map((c, i) => {
        const C = LOADERS[c.id];
        return (
          <Fragment key={c.id}>
            {i > 0 && <Seam from={CHAPTERS[i - 1]} to={c} />}
            <C />
          </Fragment>
        );
      })}
    </>
  );
}
