'use client'

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);
  gsap.defaults({ ease: 'expo.out', duration: 1 });
  ScrollTrigger.config({ ignoreMobileResize: true });
}

export const EASE = [0.16, 1, 0.3, 1];
export const EASE_CSS = 'cubic-bezier(0.16, 1, 0.3, 1)';

export { gsap, ScrollTrigger, SplitText, useGSAP };
