# three-effects

Photoshop-style **layer effects** for [Three.js](https://threejs.org/) **WebGPU**: drop shadow, outer glow, strokes, inner shadow / glow, overlays, and layer opacity—implemented with **TSL** (Three Shading Language) and a **Jump Flooding Algorithm (JFA)** for crisp, screen-space strokes.

## Quick start (`Group`)

```ts
import { Group, preRenderEffects } from "three-effects";
// … WebGPURenderer, scene, camera …

const g = new Group();
g.add(yourMesh);

g.effects.dropShadow.enabled = true;
g.effects.dropShadow.distancePx = 12;
g.effects.dropShadow.sizePx = 20;

g.effects.stroke.enabled = true;
g.effects.stroke.sizePx = 4;
g.effects.stroke.color.set(0xffffff);

scene.add(g);

function animate() {
  preRenderEffects(renderer, scene, camera);
  renderer.render(scene, camera);
}
```

Effect changes that require a new shader graph are **deferred**: assigning to **`g.effects`** (or calling **`applyEffects`**, which writes the raw state in one go) only marks the material stale. The graph is rebuilt **once per frame** inside **`preRenderEffects`**, after the group’s render-target size for that frame is known (so blur/distance conversions stay correct). No need to batch manually for performance.

If you need the material updated **before** the next `preRenderEffects` (e.g. a unit test or a screenshot), call **`g.commitEffects()`**.

## Requirements

- **Three.js** `>= 0.160.0 < 0.200.0` (peer dependency)
- A **WebGPU** renderer (`three/webgpu`). This library targets the WebGPU + TSL stack, not WebGL `ShaderMaterial`.

## Install

```bash
npm install three-effects
```

## Concepts

### `Group` and `GroupRaw`

- **`GroupRaw`** extends `THREE.Group`. It fits a **billboard quad** to the **screen-space bounding box** of its children, captures them into a **render target** when `effectsEnabled` is on, and exposes the result to a node material as **`mapNode`**. Use it when you build your own `effectsMaterial` from scratch.
- **`Group`** extends `GroupRaw` and adds a reactive **`effects`** config (drop shadow, stroke, etc.) that wires into the built-in layer-style pipeline. **`effectsEnabled`** defaults to `true`.

You must call **`preRenderEffects(renderer, scene, camera)`** (or `GroupRaw.preRenderEffects`) **before** `renderer.render(scene, camera)` so offscreen effect passes run in the right order.

### `layerStyles`

**`layerStyles(group)`** returns a fluent **`LayerStylesBuilder`**: chain `.dropShadow()`, `.outerGlow()`, `.stroke()`, … and read **`.node`** as the `vec4` color node for `MeshBasicNodeMaterial.colorNode`. The **`Group`** class uses this internally; you can also use it manually with **`GroupRaw`**.

Effect order matches a typical layer stack: drop shadow → outer glow → content and overlays → inner shadow → inner glow → stroke → optional layer opacity.

## Manual `GroupRaw` + `layerStyles`

```ts
import { GroupRaw, layerStyles, preRenderEffects } from "three-effects";
import { MeshBasicNodeMaterial } from "three/webgpu";

const group = new GroupRaw();
group.effectsEnabled = true;

const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: true, side: 2 });
mat.colorNode = layerStyles(group).dropShadow({ opacity: 0.5 }).stroke({ size: 10 }).node;
group.effectsMaterial = mat;

group.add(mesh);
scene.add(group);
```

Stroke **`size`** in `layerStyles` can be a pixel count (aligned with `Group`’s stroke) or a UV-scale number depending on how you configure the builder; see TypeScript types on **`StrokeOptions`**.

## Gradients

Build 1×N gradient **`DataTexture`** ramps for overlays and glows:

- **`createGradientTexture(stops, width?)`** — from **`ColorStop[]`**
- **`colorStopsFromSerialized`** / **`sampleSerializedGradient`** — for UI persistence (`#rrggbb` + position)

## Advanced

- **`jfaOutsideStroke`** / **`jfaInsideStroke`** — JFA distance-field stroke nodes (used by the layer-style stroke; exposed for custom graphs).
- **`effectsMaterialCacheKey(effects, rtWidth)`** and **`RT_FALLBACK`** — stable cache keys for `Group`’s internal material LRU (rarely needed outside the library).

## TypeScript

Types are published under **`dist`**. Import from **`three-effects`**; types for effect blocks live under names like **`GroupEffects`**, **`DropShadowOptions`**, etc.

## License

MIT
