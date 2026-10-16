# Chapter agent brief

You own ONE chapter of LATENT. Read `docs/DESIGN.md` first — it is the law. Then read these files to
understand the runtime (do not edit them):

- `src/components/core/Chapter.js` — pinned section wrapper (`length` in viewports, `tone`)
- `src/components/core/ChapterCanvas.js` — the lazy WebGL canvas for your stage
- `src/lib/chapter.js` — `useChapter()` → `{ id, progress (ref 0..1), near, visible }`
- `src/lib/store.js` — `live` (pointer, scroll, velocity, snap) and `useStore` (gpuTier, reducedMotion, touch)
- `src/lib/audio.js` — `playBlip(pitch, gain)`, `playChord()` (no-ops until the visitor enables sound)
- `src/lib/gsap.js` — gsap + ScrollTrigger + SplitText registered
- `src/app/globals.css` — `.mega .display .h3 .serif .hud .body .pill .slider .panel .gx`, tokens

## Ownership (hard rules)

- You may create/edit files ONLY inside `src/chapters/<your-id>/` (and `public/<your-id>/` for assets).
- `src/chapters/<your-id>/index.js` must default-export the chapter component, rendering
  `<Chapter id="<your-id>" ...>`. It is loaded client-side via `next/dynamic` (no SSR).
- Never edit shared files (core, lib, globals.css, package.json, registry, other chapters). If you
  truly need a shared change or an npm package, do without it and list the request in your report.
- Installed: three@0.170, @react-three/fiber 8, @react-three/drei 9, @react-three/postprocessing 2,
  postprocessing, maath, gsap, lenis, zustand. Nothing else.
- **No runtime CDN fetches.** drei `<Text>` must be given a local font:
  `font="/fonts/JetBrainsMono-Medium.ttf"` or `/fonts/InstrumentSerif-Italic.ttf` or
  `/fonts/Archivo-ExpandedBold.ttf`. No drei `<Environment preset>` (it fetches) — use
  `<Environment>` with your own Lightformers, or plain lights.
- Do NOT run `next build` or start another dev server, and never stop the existing one.
  The orchestrator's dev server is already running on **http://localhost:3000** with hot reload.
- **Never git commit or push anything.** Everything is local.

## Your sandbox

- `http://localhost:3000/lab/<your-id>` renders only your chapter (with 30svh before/after).
- Screenshot with the harness (Git Bash, from the project root
  `C:/Users/Subham/Downloads/SG_BTech_Civil/BTech_Civil/Codestuff/latent-ai`):
  ```bash
  node scripts/shoot.mjs --url http://localhost:3000/lab/<id> --out ../shots-latent/<id> --scroll 0.2,0.35,0.5,0.65,0.8 --chrome --wait 2200
  node scripts/shoot.mjs --url http://localhost:3000/lab/<id> --out ../shots-latent/<id> --scroll 0.5 --chrome --mobile
  ```
  It appends `?gpu=2&nopre=1&snap=1`, writes PNGs + `<name>-console.json`. `--hover x,y` sweeps the
  pointer to viewport fractions before each shot. View PNGs with the Read tool. Fix every console error.
  For richer interaction testing, write your own Playwright script in your scratch dir (copy the
  launch options from `scripts/shoot.mjs`; use `channel: 'chrome'`).
- Scroll fractions are of the whole lab page; your pinned range is roughly 0.08 → 0.92.

## Quality bar

This is a studio showcase whose goal is that people say "wow". Specifically:

1. **One irresistible toy.** The primary interaction must be discoverable in 2 seconds (a
   `data-cursor="Drag"` / `"Drop"` / `"Type"` label + a tiny hud hint) and deeply satisfying.
2. **Real math, live.** The simulation must actually compute what it teaches, and show the live
   numbers in hud readouts. Educational accuracy matters — the copy must be correct and clear for a
   curious non-expert, ≤ 3 short sentences per step, with one `.serif` phrase per chapter.
3. **Scroll tells the story** in 3–5 steps across `progress` (e.g. step = floor(progress * N)); each
   step changes the scene and the explainer text. Camera moves are smooth (damped toward targets,
   use `damp()` from store so `?snap=1` screenshots settle). The toy stays playable at every step.
4. **Cinematic rendering.** Bloom on activations only (high threshold, emissive orange), subtle noise
   + vignette, depth, careful lighting, thin-film/glass/graphite materials, fog for depth. Nothing
   looks like a default three.js demo. No default grey MeshStandardMaterial anywhere.
5. **Overlay anatomy** per DESIGN.md §4 (layer label + title + serif phrase top-left, explainer,
   readouts bottom-right, controls as `.pill` / `.slider`). Leave the HUD corners clear
   (top 64px, bottom 72px).
6. **Performance**: 60 fps on a mid GPU. Instancing, GPU shaders, no per-frame allocations, no React
   state updates per frame (update DOM readouts via refs). Respect `gpuTier` (1 = lighter) and
   `reducedMotion`. Provide a static, meaningful `fallback` for gpuTier 0.
7. **Mobile** (390px): stacked overlay, touch-friendly controls, the toy still works with touch.
8. **Accessibility**: controls are real buttons/inputs with labels; key facts exist as DOM text.

## Report (your final message)

- What you built (concept, interactions, scroll steps), files created, screenshot paths of your best
  frames, known issues, and any shared-file/package requests.
