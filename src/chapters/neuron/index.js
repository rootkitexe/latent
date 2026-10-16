'use client'

import { useEffect } from 'react';
import Chapter from '@/components/core/Chapter';
import ChapterCanvas from '@/components/core/ChapterCanvas';
import { useChapter } from '@/lib/chapter';
import { useNeuron } from './state';
import { STEPS } from './copy';
import Scene from './Scene';
import Overlay from './Overlay';

/** L1 — The Neuron. A single perceptron as a glass machine: inputs → weights → sum + bias → activation → fire. */
export default function NeuronChapter() {
  return (
    <Chapter id="neuron" length={6} label="L1 The Neuron: weights, bias and activation">
      <Stage />
    </Chapter>
  );
}

function Stage() {
  const { progress } = useChapter();
  useEffect(() => {
    let raf;
    const loop = () => {
      const s = Math.min(STEPS.length - 1, Math.floor(progress.current * STEPS.length));
      if (s !== useNeuron.getState().step) useNeuron.getState().setStep(s);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [progress]);

  return (
    <>
      <ChapterCanvas camera={{ position: [-2.1, 0.9, 8.6], fov: 34, near: 0.1, far: 90 }} fallback={<Fallback />}>
        <Scene />
      </ChapterCanvas>
      <Overlay />
    </>
  );
}

/** gpuTier 0: a static diagram of the same machine. */
function Fallback() {
  const ys = [90, 180, 270];
  return (
    <div className="absolute inset-0 grid place-items-center md:pl-[30vw]" aria-hidden>
      <svg viewBox="0 0 640 360" className="w-[min(92vw,820px)] opacity-90">
        <defs>
          <radialGradient id="nr-soma" cx="50%" cy="60%" r="60%">
            <stop offset="0" stopColor="#FF4F1F" stopOpacity=".9" />
            <stop offset="1" stopColor="#1A1B20" stopOpacity=".2" />
          </radialGradient>
        </defs>
        {ys.map((y, i) => (
          <g key={y}>
            <path d={`M70 ${y} C 180 ${y}, 220 ${180 + (y - 180) * 0.3}, 300 ${180 + (y - 180) * 0.2}`} stroke="#A8F0FF" strokeOpacity=".5" strokeWidth="3" fill="none" />
            <circle cx="70" cy={y} r="16" fill="#A8F0FF" fillOpacity={[0.9, 0.3, 0.6][i]} />
            <circle cx="190" cy={y + (180 - y) * 0.25} r={[9, 6, 12][i]} fill="none" stroke={['#FF4F1F', '#5C7CFA', '#FF4F1F'][i]} strokeWidth={[4, 3, 6][i]} />
          </g>
        ))}
        <circle cx="340" cy="180" r="56" fill="url(#nr-soma)" stroke="#fff" strokeOpacity=".25" />
        <path d="M396 190 C 460 210, 540 230, 640 250" stroke="#FF4F1F" strokeWidth="3" fill="none" />
        <text x="340" y="275" textAnchor="middle" fill="#fff" fillOpacity=".6" fontFamily="monospace" fontSize="12">z = w·x + b → σ(z)</text>
      </svg>
    </div>
  );
}
