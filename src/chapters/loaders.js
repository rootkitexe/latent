'use client'

import dynamic from 'next/dynamic';

/** Client-only, code-split chapter components keyed by id (see registry.js for order). */
const Hold = () => <div className="h-[100svh] bg-void" />;

export const LOADERS = {
  input: dynamic(() => import('./input'), { ssr: false, loading: Hold }),
  neuron: dynamic(() => import('./neuron'), { ssr: false, loading: Hold }),
  descent: dynamic(() => import('./descent'), { ssr: false, loading: Hold }),
  network: dynamic(() => import('./network'), { ssr: false, loading: Hold }),
  embeddings: dynamic(() => import('./embeddings'), { ssr: false, loading: Hold }),
  attention: dynamic(() => import('./attention'), { ssr: false, loading: Hold }),
  diffusion: dynamic(() => import('./diffusion'), { ssr: false, loading: Hold }),
  reinforce: dynamic(() => import('./reinforce'), { ssr: false, loading: Hold }),
  output: dynamic(() => import('./output'), { ssr: false, loading: Hold }),
};
