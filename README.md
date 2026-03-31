# three-effects

Photoshop-style **layer effects** for [Three.js](https://threejs.org/) **WebGPU**: drop shadow, outer glow, strokes, inner shadow / glow, overlays, a **layer blur** (full composite, before opacity), and layer opacity—implemented with **TSL** (Three Shading Language) and a **Jump Flooding Algorithm (JFA)** for crisp, screen-space strokes.

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

g.effects.blur.enabled = true;
g.effects.blur.sizePx = 8;

scene.add(g);

function animate() {
  preRenderEffects(renderer, scene, camera);
  renderer.render(scene, camera);
}
```

## Requirements

- **Three.js** `>= 0.160.0 < 0.200.0` (peer dependency)
- A **WebGPU** renderer (`three/webgpu`). This library targets the WebGPU + TSL stack, not WebGL `ShaderMaterial`.

## Install

```bash
npm install three-effects
```

## `Group`

**`Group`** extends **`THREE.Group`**. Add meshes (or other objects) as children; the library fits a **billboard quad** to their **screen-space bounding box**, draws them into a **cropped render target** each frame, and runs a built-in **layer-style** shader on that texture. You configure everything through **`g.effects`**: toggle blocks with **`enabled`**, set colors, blur sizes in pixels, and so on. **`effectsEnabled`** defaults to **`true`**.

Call **`preRenderEffects(renderer, scene, camera)`** (or **`GroupRaw.preRenderEffects`**) **once per frame before** **`renderer.render(scene, camera)`** so every effects group can run its offscreen pass in the right order.

Changes that require a **new shader graph** are **deferred**: assigning to **`g.effects`** or calling **`applyEffects(fn)`** only marks the material stale. The graph is rebuilt **at most once per frame** inside **`preRenderEffects`**, after the group’s render-target size for that frame is known (so blur and distance math stay correct). You do not need to batch updates by hand for performance.

If you need the material updated **before** the next **`preRenderEffects`** (e.g. a test or a screenshot), call **`g.commitEffects()`**.

Effects are composited in a fixed order (similar to a layer stack): **drop shadow → outer glow → content and color/gradient overlays → inner shadow → inner glow → stroke → blur → layer opacity**.

**Blur** (when enabled) runs a **second pass**: the full style stack (without blur and without layer opacity) is rendered into a temp target the same size as the crop, then **Gaussian blur** is applied to that texture; layer opacity multiplies the result. Use **`autoPadding`** (default) or **`paddingExtra`** so the crop has enough margin for the blur kernel.

## Layer effects

Each effect is a property on **`g.effects`**. Set **`enabled: true`** to turn it on. Field-by-field reference tables are in the **[g.effects reference](#reference-geffects-property-tables)** section.

- **[stroke](#stroke)** — outline around the silhouette; **JFA** distance field; width in screen pixels.
- **[dropShadow](#dropshadow)** — offset, blurred shadow behind the layer.
- **[outerGlow](#outerglow)** — glow outside the alpha boundary.
- **[colorOverlay](#coloroverlay)** — solid tint over the layer (masked by alpha).
- **[gradientOverlay](#gradientoverlay)** — linear or radial gradient over the layer; uses **`stops`** (`#rrggbb` + position); see also **[Gradients](#gradients)**.
- **[innerShadow](#innershadow)** — recessed shadow along the inside edge.
- **[innerGlow](#innerglow)** — glow from the inner edge or from the center.
- **[blur](#blur)** — blurs the **fully composited** result (after stroke); **before** layer opacity. Radius in screen pixels.
- **[opacity](#opacity)** — multiplies final RGBA after the other styles.

## Gradients

Build 1×N gradient **`DataTexture`** ramps for overlays:

- **`createGradientTexture(stops, width?)`** — from **`ColorStop[]`**
- **`colorStopsFromSerialized`** / **`sampleSerializedGradient`** — for UI persistence (`#rrggbb` + position)

## Advanced

- **`jfaOutsideStroke`** / **`jfaInsideStroke`** — JFA distance-field stroke nodes (used by the layer-style stroke; exposed for custom graphs).
- **`effectsMaterialCacheKey(effects, rtWidth)`** and **`RT_FALLBACK`** — stable cache keys for `Group`’s internal material LRU (rarely needed outside the library). Blur `sizePx` is driven by a uniform and is **not** part of the key.

## TypeScript

Types are published under **`dist`**. Import from **`three-effects`**; types for effect blocks live under names like **`GroupEffects`**, **`GroupEffectsBlur`**, **`DropShadowOptions`**, **`BlurOptions`**, etc.

## Low-level API: `GroupRaw` and `layerStyles`

For full control, use **`GroupRaw`**: same billboard and render-target capture as **`Group`**, but you supply **`effectsMaterial`** yourself and read the captured texture from **`mapNode`** (and **`createOffsetSample`** for offsets). You still call **`preRenderEffects`** before the main render.

**`layerStyles(group)`** returns a fluent **`LayerStylesBuilder`**: chain **`.dropShadow()`**, **`.outerGlow()`**, **`.stroke()`**, … and use **`.node`** as the **`vec4`** color node on **`MeshBasicNodeMaterial`**. **`Group`** uses this internally; with **`GroupRaw`** you compose your own stack. Omitted methods stay off. Effect order matches the high-level pipeline above.

**`.blur({ radius, sigma? })`** — blurs the **captured** layer texture **before** the rest of the stack (standalone use). **`Group`** does **not** chain **`.blur()`** on the builder: it uses **`g.effects.blur`** instead, which blurs the **full composite** after stroke via the extra pass described above.

```ts
import { GroupRaw, layerStyles, preRenderEffects } from "three-effects";
import { MeshBasicNodeMaterial } from "three/webgpu";

const group = new GroupRaw();
group.effectsEnabled = true;

const mat = new MeshBasicNodeMaterial({
  transparent: true,
  depthWrite: true,
  side: 2,
});
mat.colorNode = layerStyles(group)
  .dropShadow({ opacity: 0.5 })
  .stroke({ size: 10 }).node;
group.effectsMaterial = mat;

group.add(mesh);
scene.add(group);
```

Stroke **`size`** in **`layerStyles`** can be expressed in pixels (aligned with **`Group`’s** stroke) or in UV-style units depending on how you configure the builder; see TypeScript types on **`StrokeOptions`**.

## Reference: g.effects property tables

Access fields as **`g.effects.<name>.<field>`**. Every block has **`enabled`**. **`color`** fields are **`THREE.Color`** (e.g. **`color.set(0xffffff)`**).

### stroke

`g.effects.stroke`

| Property   | Type      | Notes                                     |
| ---------- | --------- | ----------------------------------------- |
| `enabled`  | `boolean` |                                           |
| `sizePx`   | `number`  | Stroke radius in **screen pixels** (JFA). |
| `position` | `string`  | `"outside"`, `"inside"`, or `"center"`.   |
| `opacity`  | `number`  |                                           |
| `color`    | `Color`   |                                           |

### dropShadow

`g.effects.dropShadow`

| Property     | Type      | Notes                                               |
| ------------ | --------- | --------------------------------------------------- |
| `enabled`    | `boolean` |                                                     |
| `opacity`    | `number`  |                                                     |
| `angle`      | `number`  | Lighting angle in degrees (shadow offset opposite). |
| `distancePx` | `number`  | Offset length in pixels.                            |
| `spread`     | `number`  | `0…1`, matte expansion before blur.                 |
| `sizePx`     | `number`  | Blur size in pixels.                                |
| `color`      | `Color`   |                                                     |

### outerGlow

`g.effects.outerGlow`

| Property  | Type      | Notes                |
| --------- | --------- | -------------------- |
| `enabled` | `boolean` |                      |
| `opacity` | `number`  |                      |
| `spread`  | `number`  | `0…1`.               |
| `sizePx`  | `number`  | Blur size in pixels. |
| `color`   | `Color`   |                      |

### colorOverlay

`g.effects.colorOverlay`

| Property  | Type      | Notes |
| --------- | --------- | ----- |
| `enabled` | `boolean` |       |
| `opacity` | `number`  |       |
| `color`   | `Color`   |       |

### gradientOverlay

`g.effects.gradientOverlay`

| Property  | Type      | Notes                                                            |
| --------- | --------- | ---------------------------------------------------------------- |
| `enabled` | `boolean` |                                                                  |
| `opacity` | `number`  |                                                                  |
| `style`   | `string`  | `"linear"` or `"radial"`.                                        |
| `angle`   | `number`  | Degrees.                                                         |
| `scale`   | `number`  | Repeat scale across the layer.                                   |
| `reverse` | `boolean` | Flip gradient direction.                                         |
| `stops`   | `array`   | `{ color, position }[]` — `color`: `#rrggbb`; `position`: `0…1`. |

### innerShadow

`g.effects.innerShadow`

| Property     | Type      | Notes                             |
| ------------ | --------- | --------------------------------- |
| `enabled`    | `boolean` |                                   |
| `opacity`    | `number`  |                                   |
| `angle`      | `number`  | Degrees.                          |
| `distancePx` | `number`  | Offset in pixels.                 |
| `choke`      | `number`  | `0…1`, shrinks matte before blur. |
| `sizePx`     | `number`  | Blur size in pixels.              |
| `color`      | `Color`   |                                   |

### innerGlow

`g.effects.innerGlow`

| Property  | Type      | Notes                   |
| --------- | --------- | ----------------------- |
| `enabled` | `boolean` |                         |
| `opacity` | `number`  |                         |
| `source`  | `string`  | `"edge"` or `"center"`. |
| `choke`   | `number`  | `0…1`.                  |
| `sizePx`  | `number`  | Blur size in pixels.    |
| `color`   | `Color`   |                         |

### blur

`g.effects.blur`

| Property  | Type      | Notes                                                                 |
| --------- | --------- | --------------------------------------------------------------------- |
| `enabled` | `boolean` |                                                                       |
| `sizePx`  | `number`  | Blur radius in **screen pixels** (converted for TSL `gaussianBlur`).   |

### opacity

`g.effects.opacity`

| Property  | Type      | Notes                                               |
| --------- | --------- | --------------------------------------------------- |
| `enabled` | `boolean` | Layer-wide multiply on RGBA after other styles.     |
| `value`   | `number`  | `0…1`. Updates without shader rebuild when enabled. |

## License

MIT
