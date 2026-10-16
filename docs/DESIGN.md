# LATENT — Design Direction

*A field guide to the inside of a machine mind.* A Haloxion studio demo: one long page that teaches
AI by putting the visitor **inside a neural network**. This file is the single source of truth.

## 0. The idea

You don't read about a model. You travel through one. Scrolling *is* the forward pass: the page is
a stack of layers (chapters), and the visitor is the signal moving through them.

**The page trains while you read.** The HUD shows a live training run that is driven by scroll:
`EPOCH` climbs, `LOSS` falls (2.31 → 0.04), `TOKENS SEEN` counts up. By the end the model —
and the reader — has learned.

Reaction we want: "wow" in the first 2 seconds, then curiosity — *people play with every chapter.*
Each chapter teaches ONE concept through ONE physical, playable 3D metaphor. Interaction first,
text second. If a concept can be understood by touching it, do not explain it in a paragraph.

## 1. Principles

1. **Activation = light.** The only warm light in the world is `--signal` orange. It appears when
   something *fires*: a neuron activating, a gradient step, an attention link, a reward. Everything
   else is cold: graphite, glass, ice, chrome, thin-film iridescence. Orange is earned, never decor.
2. **Every concept is a toy.** Each chapter has one primary interaction the visitor can't resist
   (drag, drop, type, draw, scrub). The interaction *is* the explanation.
3. **Type is a material.** Display type is the variable font *Anybody* — its width axis (`wdth`
   50–150) reacts to the system: cursor proximity, scroll velocity, activation. Type breathes.
4. **Precise, not noisy.** Motion is physical: `expo.out`, `power4.out`, custom `[0.16,1,0.3,1]`.
   No bouncy cuteness. Quiet idle states, decisive responses.
5. **Lab-instrument honesty.** Tiny mono HUD labels annotate everything like a scientific
   instrument: axis ticks, live readouts of the real numbers in the simulation (weights, loss,
   learning rate, attention scores). Real math, really computed, shown live.
6. **One "lights on".** Exactly one chapter flips to `--paper` (Diffusion: noise → clarity).

## 2. Tokens (`src/app/globals.css`, mirrored in `tailwind.config.js`)

| Token        | Value     | Use |
|--------------|-----------|-----|
| `--void`     | `#050506` | page background |
| `--graphite` | `#0E0F12` | raised dark surfaces, panels |
| `--paper`    | `#ECE9E2` | the one lights-on chapter |
| `--ink`      | `#0B0B0D` | text on paper |
| `--signal`   | `#FF4F1F` | activation / firing / reward. The only warm colour. |
| `--signal-hot` | `#FFB38A` | core of a bright activation (bloom centre) |
| `--ice`      | `#A8F0FF` | learning, gradients, "cold" data, selection |
| `--frost`    | `#5C7CFA` | deep shadow side of iridescence, negative values |

Text on dark: white at 100 / 68 / 42 / 22 % (`text-fg`, `text-fg-68`, `text-fg-42`, `text-fg-22`).
Hairlines: `rgba(255,255,255,0.09)` on dark, `rgba(11,11,13,0.12)` on paper.
Diverging scale for values (negative → zero → positive): `--frost` → `#1A1B20` → `--signal`.
3D materials: graphite (#121318, rough .45), smoked glass (transmission), chrome, **thin-film
iridescence** (view-angle hue shift ice → frost → violet → faint signal at grazing angle).

## 3. Type (loaded with `next/font/google` in `src/app/layout.js`)

- **Display — Anybody** (variable, `wdth` 50–150, `wght` 100–900). CSS var `--font-display`.
  - Mega / chapter word: `.mega` → `font-variation-settings: 'wdth' 150; font-weight: 900;`
    `letter-spacing: -0.04em; line-height: .78; text-transform: uppercase`. Allowed to bleed off
    the viewport edge (cropped type is part of the look).
  - Titles: `.display` → `wdth 120, wght 700, letter-spacing -0.03em, line-height .9`.
- **Body — Inter Tight** 400/500, 16–18px, line-height 1.55, `text-fg-68`. Max 52ch.
- **Accent — Instrument Serif Italic** (`.serif`) for ONE phrase per chapter. Never paragraphs.
- **HUD — JetBrains Mono** (`.hud`) 500, 10.5px, uppercase, `letter-spacing: .16em`, `text-fg-42`.
  Numbers use `tabular-nums`.

Scale: mega `clamp(80px, 17vw, 300px)`; h2 `clamp(40px, 6.2vw, 104px)`; h3 `clamp(22px, 2.2vw, 34px)`.

## 4. Layout

- **HUD frame** (global, fixed): TL `LATENT — FIELD GUIDE TO MACHINE MINDS`; TR layer index
  `L0 … L8` (clickable); BL training readout `EPOCH 012 · LOSS 0.412`; BR sound toggle + `A HALOXION DEMO`.
- Chapters are full-bleed `<section>`s. A chapter is **pinned**: a tall section (e.g. `400vh`) with a
  sticky 100svh stage inside; scroll progress 0→1 drives the scene. The stage holds one WebGL canvas
  (`<ChapterCanvas>`) plus DOM overlay (title, explainer, controls).
- Chapter overlay anatomy (consistent across chapters so it reads as one instrument):
  - top-left under HUD: `L02 / GRADIENT DESCENT` (hud) and the chapter title (`.display`) +
    one serif phrase;
  - a short explainer (≤ 3 sentences, body) that can change with progress (steps);
  - bottom-right: live readouts (hud, tabular numbers) of the simulation;
  - controls are minimal pills/sliders in the house style (`.pill`, `.slider` in globals.css).
- Gutter `--gx: clamp(20px, 4vw, 64px)`. Mobile (≤ 768px): overlay stacks; 3D stays full-bleed.
- z-layers: canvas `z-0` → overlay `z-10` → HUD `z-50` → cursor `z-[100]` → preloader `z-[110]`.

## 5. Chapters (the forward pass)

| L | id | Concept | Toy |
|---|----|---------|-----|
| L0 | `input` | Hero — "your words enter the network" | Blender neuron, typing fires it |
| L1 | `neuron` | the perceptron: weights, bias, activation | tune weights, watch one neuron decide |
| L2 | `descent` | loss & gradient descent, learning rate | drop balls on a 3D loss landscape |
| L3 | `network` | deep networks, forward pass, backprop | fly through layers; fire signals |
| L4 | `embeddings` | meaning as geometry; king − man + woman | a navigable galaxy of words |
| L5 | `attention` | transformers, tokens, attention | type a sentence; see attention beams |
| L6 | `diffusion` | generative models: noise → image (LIGHTS ON) | scrub/brush to denoise |
| L7 | `reinforce` | reinforcement learning: reward & policy | an agent learning live in a 3D maze |
| L8 | `output` | finale — the whole network, what you learned | zoom out over every layer |

## 6. Global interactions

- **Cursor**: 5px dot + 30px ring (spring). On interactive things the ring fills `--signal` at 15 %
  and shows a label from `data-cursor`. Click = a tiny activation ripple.
- **Scroll**: Lenis (`duration 1.15`), GSAP ticker synced. `window.__lenis` exposed.
- **Training HUD**: loss/epoch derived from global scroll (`live.scroll`).
- **Sound** (opt-in): a generative drone that thickens with depth; chapters may emit soft clicks
  via `playBlip(pitch)` from `src/lib/audio.js`.
- **Keyboard**: `1`–`8` jump to layers (when not typing), arrows where a chapter supports it.
- **Reduced motion**: no scroll-scrubbed camera flights, simulations step on interaction only.

## 7. Performance

One WebGL context alive per visible chapter (`<ChapterCanvas>` mounts only near the viewport and
unmounts when far). `dpr [1, 1.5]`. Postprocessing per chapter: Bloom (mipmapBlur) + light Noise +
Vignette max. Target 60 fps on mid GPUs; respect `gpuTier` (0 = no WebGL → static fallback).
No runtime CDN fetches; assets live in `public/`.

## 8. Code conventions

Next.js 14 App Router, **plain JavaScript**, `'use client'` where needed, alias `@/`.
Shared state: `src/lib/store.js` (`useStore` reactive, `live` mutable per-frame).
GSAP from `src/lib/gsap.js`. Each chapter lives entirely in `src/chapters/<id>/` (its scene,
shaders, copy, overlay). Every interactive 3D thing has an accessible DOM equivalent.
