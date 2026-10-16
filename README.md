# LATENT — a field guide to the inside of a machine mind

A Haloxion studio demo. One long page that teaches AI by putting the visitor inside a neural network:
scrolling is the forward pass, every chapter is a playable 3D world, and the page itself "trains" as
you read (the HUD's loss falls as you scroll). Design direction: [`docs/DESIGN.md`](docs/DESIGN.md).

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

Debug query params: `?gpu=0|1|2` forces the GPU tier (0 = no WebGL fallbacks), `?nopre=1` skips the
preloader, `?snap=1` makes frame-lerps instant (screenshot harness).

## The forward pass

| Layer | Chapter | The toy |
|---|---|---|
| L0 | Input (hero) | A Blender neuron running a real leaky integrate-and-fire model — type to stimulate it |
| L1 | The Neuron | Tune weights/bias of a perceptron; watch its decision plane split a point cloud |
| L2 | Gradient Descent | Drop balls on a 3D loss landscape; learning rate; optimizer race |
| L3 | Deep Networks | Draw a digit; a real MLP classifies it while you fly through its layers |
| L4 | Embeddings | A galaxy of word vectors; nearest neighbours and vector arithmetic |
| L5 | Attention | Type a sentence; attention beams between tokens; next-token prediction |
| L6 | Diffusion | The one "lights on" chapter — noise → image, with a denoising brush |
| L7 | Reinforcement | Q-learning agent in a 3D grid world you can edit live |
| L8 | Output | The whole network at once; the output layer decodes what you typed in L0 |

## Structure

```
src/app/                 layout (fonts, HUD, cursor), / (Journey), /lab/[chapter] (isolated sandbox)
src/components/core/     Chapter (pinned section), ChapterCanvas (lazy WebGL), Hud, Cursor,
                         Preloader, Seam (layer boundaries), Providers (Lenis, pointer, keys)
src/chapters/<id>/       each chapter is self-contained: scene, shaders, copy, overlay
src/chapters/registry.js chapter order / HUD names; loaders.js code-splits them
src/lib/                 store (zustand + per-frame `live`), chapter runtime, audio, gsap, device tier
public/models/neuron.glb the hero neuron        ← scripts/blender/make_neuron.py
public/<chapter>/        chapter data (trained weights, word vectors, n-gram model…)
public/draco, fonts      decoder and local fonts (no runtime CDN fetches)
scripts/shoot.mjs        screenshot harness (Playwright)
```

## 3D assets

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --python scripts/blender/make_neuron.py -- seed=7 preview=1
```

Generates a pyramidal neuron by sweeping tubes along noise-perturbed branching paths. Vertex colour
`COLOR_0` carries data for the shader, not colour: R = path distance from the soma, G = branch id
(inherited down each subtree), B = compartment (soma / dendrite / axon). The web shader uses it to
run action potentials along the real branches.

## Screenshots / QA

```bash
node scripts/shoot.mjs --url http://localhost:3000/ --out ../shots-latent/page --scroll 0,0.1,0.2,0.3,0.5,0.7,0.9,1 --chrome
node scripts/shoot.mjs --url http://localhost:3000/lab/descent --out ../shots-latent/descent --scroll 0.2,0.5,0.8 --chrome --mobile
```

Keyboard: `0`–`8` jump to layers (except while the hero is capturing typing).
