import { Color, Texture, Vector2 } from "three/webgpu";
import {
  PI,
  clamp,
  cos,
  dot,
  float,
  length,
  max,
  mix,
  mul,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import { kawaseBlur } from "./kawaseBlurNode.js";
import {
  jfaOutsideStroke,
  jfaInsideStroke,
  type JfaQuality,
} from "./jfaStroke.js";
import { GroupRaw } from "./GroupRaw.js";

/**
 * Applies separable Gaussian blur with premultiplied alpha so RGB does not bleed
 * across transparent edges (same idea as the playground halo / drop shadow).
 *
 * @param resolutionScale — `GaussianBlurNode` internal resolution factor (`1` = full texture; `0.5` = half, fewer pixels per pass).
 */
function blurPremult(
  src: ReturnType<typeof texture>,
  /** Blur radius / direction node (uniform scalar is accepted at runtime). */
  radius: ReturnType<typeof uniform<number>>,
  sigma: number,
  resolutionScale = 1,
) {
  const b = gaussianBlur(src, radius as never, sigma);
  b.premultipliedAlpha = true;
  if (resolutionScale < 1 && resolutionScale > 0) {
    const gn = b as unknown as { resolution: Vector2 };
    gn.resolution.set(resolutionScale, resolutionScale);
  }
  return b;
}

/**
 * Kawase multi-pass blur (premultiplied) for layer styles that need soft alpha
 * (drop shadow, outer glow, inner shadow, inner glow). Same node shape as `gaussianBlur`.
 */
function blurKawasePremult(
  src: ReturnType<typeof texture>,
  radius: ReturnType<typeof uniform<number>>,
  passes: number,
  resolutionScale = 1,
): ReturnType<typeof gaussianBlur> {
  const b = kawaseBlur(src, radius as never, passes) as ReturnType<
    typeof gaussianBlur
  > & { resolution: Vector2 };
  b.premultipliedAlpha = true;
  if (resolutionScale < 1 && resolutionScale > 0) {
    b.resolution.set(resolutionScale, resolutionScale);
  }
  return b;
}

/**
 * Maps to Photoshop **Drop Shadow**: shadow color, global opacity, lighting angle,
 * offset distance, spread (matte expansion before blur), blur size.
 *
 * Blur is implemented with a **Kawase** multi-pass filter (not separable Gaussian).
 *
 * - **Angle** — Lighting direction in degrees (0° = +X, 90° = +Y in UV space).
 *   The shadow is offset opposite to the light (shadow falls away from the light).
 * - **Distance** — Offset length in **UV space** (0–1 relative to the layer quad).
 * - **Spread** — `0…1`; expands the shadow matte before blur (Photoshop 0–100%).
 * - **Blur radius** — Direction scale for each Kawase pass (wider blur).
 * - **kawasePasses** — Number of Kawase iterations (each pass = 5 taps). Kept even internally.
 */
export interface DropShadowOptions {
  /** Shadow RGB (sRGB). @default `#000000` */
  color?: Color;
  /** Effect opacity `0…1`. @default `0.75` */
  opacity?: number;
  /**
   * Lighting angle in degrees (Photoshop “Angle”). Shadow offset is opposite to light.
   * @default `120`
   */
  angle?: number;
  /** Offset magnitude in UV space. @default `0.02` */
  distance?: number;
  /** Matte expansion before blur, `0…1`. @default `0` */
  spread?: number;
  /** Blur strength (direction scale per Kawase pass). @default `2` */
  blurRadius?: number;
  /** Kawase iterations (even). @default `4` */
  kawasePasses?: number;
  /**
   * Scale for internal blur render target dimensions.
   * `1` = full resolution; `0.5` = half (faster).
   * @default `1`
   */
  blurResolutionScale?: number;
}

/**
 * Maps to Photoshop **Outer Glow**: color or 1D gradient texture, opacity, spread,
 * blur size (**Kawase**). Gradient is sampled at `u = clamp(2 * ring, 0, 1)`.
 */
export interface OuterGlowOptions {
  /** Solid glow color when `gradientTexture` is omitted. @default `#ffff00` */
  color?: Color;
  /** 1×N gradient ramp (e.g. from {@link createGradientTexture}). */
  gradientTexture?: Texture;
  /** `0…1`. @default `0.8` */
  opacity?: number;
  /** Matte expansion before blur, `0…1`. @default `0` */
  spread?: number;
  /** Blur strength (direction scale per Kawase pass). @default `4` */
  blurRadius?: number;
  /** Kawase iterations (even). @default `4` */
  kawasePasses?: number;
  /** Internal blur RT scale. @default `1` */
  blurResolutionScale?: number;
  /**
   * @deprecated Gaussian path removed; use Kawase fields. Ignored.
   */
  sigma?: number;
}

/**
 * Maps to Photoshop **Color Overlay**: solid fill tint over the layer RGB (masked by
 * layer alpha). Blend modes are not supported — only normal alpha blend at `opacity`.
 */
export interface ColorOverlayOptions {
  /** Fill color. @default `#ff0000` */
  color?: Color;
  /** `0…1`. @default `0.3` */
  opacity?: number;
}

/**
 * Maps to Photoshop **Gradient Overlay**: gradient as a texture, opacity, style
 * (linear / radial), angle, scale, and reverse. Samples the 1D texture at computed `u`.
 */
export interface GradientOverlayOptions {
  /** 1×N ramp from {@link createGradientTexture}. */
  texture: Texture;
  /** `0…1`. @default `0.9` */
  opacity?: number;
  /** @default `'linear'` */
  style?: "linear" | "radial";
  /**
   * Rotation in degrees; for linear, gradient along the rotated axis through center.
   * @default `90`
   */
  angle?: number;
  /** Repeat scale; higher = more cycles across the layer. @default `1` */
  scale?: number;
  /** Flip gradient direction. @default `false` */
  reverse?: boolean;
}

/**
 * Maps to Photoshop **Inner Shadow**: recessed shadow inside the layer edge — color,
 * opacity, angle, distance, choke, blur (**Kawase**).
 */
export interface InnerShadowOptions {
  /** Shadow color. @default `#000000` */
  color?: Color;
  /** `0…1`. @default `0.6` */
  opacity?: number;
  /** Light direction (shadow falls opposite). @default `120` */
  angle?: number;
  /** Offset in UV space. @default `0.01` */
  distance?: number;
  /** Shrinks the matte before blur, `0…1`. @default `0` */
  choke?: number;
  /** Blur strength (direction scale per Kawase pass). @default `1` */
  blurRadius?: number;
  /** Kawase iterations (even). @default `4` */
  kawasePasses?: number;
  /** Internal blur RT scale. @default `1` */
  blurResolutionScale?: number;
  /** @deprecated Ignored. */
  sigma?: number;
}

/**
 * Maps to Photoshop **Inner Glow** — **Edge** vs **Center** source, color or gradient,
 * opacity, choke, blur (**Kawase**).
 */
export interface InnerGlowOptions {
  /** Solid color when no gradient. @default `#ffffff` */
  color?: Color;
  gradientTexture?: Texture;
  /** `0…1`. @default `0.5` */
  opacity?: number;
  /**
   * **Edge** — glow emanates from inner boundaries; **Center** — glow from the center outward.
   * @default `'edge'`
   */
  source?: "edge" | "center";
  /** Inner matte shrink, `0…1`. @default `0` */
  choke?: number;
  /** Blur strength (direction scale per Kawase pass). @default `2` */
  blurRadius?: number;
  /** Kawase iterations (even). @default `4` */
  kawasePasses?: number;
  /** Internal blur RT scale. @default `1` */
  blurResolutionScale?: number;
  /** @deprecated Ignored. */
  sigma?: number;
}

/**
 * Maps to Photoshop **Stroke** — size (pixels), position (outside / inside / center),
 * color, opacity.  Implemented via the Jump Flooding Algorithm (JFA) which builds a
 * true Euclidean distance field, yielding clean stroke edges and circular arcs at
 * convex corners (matching Photoshop's stroke rendering).
 */
/**
 * Layer-wide opacity: multiplies final RGB and alpha after all other styles (Photoshop layer opacity).
 */
export interface OpacityOptions {
  /**
   * `0…1` CPU scalar, or a pre-made `uniform(…)` node (e.g. `Group`'s layer-opacity uniform)
   * so opacity can animate every frame without rebuilding the shader graph.
   */
  value: number | ReturnType<typeof uniform<number>>;
}

/**
 * Layer-wide Gaussian blur on the captured layer texture (premultiplied).
 * Direction scale matches {@link gaussianBlur} / other layer blurs: `sizePx / (2 + 2 * sigma)`.
 *
 * **Standalone `layerStyles`:** blurs the source before other effects are composited.
 * **`Group` with blur enabled:** uses a two-pass path; do not chain `.blur()` on the builder.
 */
export interface BlurOptions {
  /**
   * Blur direction scale (same units as `blurRadius` on drop shadow / outer glow), or a
   * pre-made `uniform(…)` for live updates without graph rebuild.
   */
  radius: number | ReturnType<typeof uniform<number>>;
  /** Gaussian sigma (kernel quality). @default `8` */
  sigma?: number;
}

export interface StrokeOptions {
  /** Stroke color. @default `#000000` */
  color?: Color;
  /** `0…1`. @default `1` */
  opacity?: number;
  /**
   * Stroke width in **screen pixels** — the distance from the alpha boundary to
   * the outer (or inner) edge of the stroke.
   *
   * Accepts either a plain number or a pre-created `uniform()` node.  A uniform
   * lets you update the value reactively (e.g. from a UI slider) without
   * rebuilding the full node graph:
   *
   * ```ts
   * const sizeU = uniform(12); // 12 px stroke
   * mat.colorNode = layerStyles(group).stroke({ size: sizeU }).node;
   * // Later:
   * sizeU.value = newSizePx;
   * ```
   * @default `10`
   */
  size?: number | ReturnType<typeof uniform<number>>;
  /** @default `'outside'` */
  position?: "outside" | "inside" | "center";
  /**
   * @deprecated No longer used by the JFA implementation.
   * Kept for backwards compatibility; will be ignored.
   */
  threshold?: number;
  /**
   * @deprecated No longer used by the JFA implementation.
   * Kept for backwards compatibility; will be ignored.
   */
  sigma?: number;
  /**
   * JFA refinement: **`fast`** caps passes at 8; **`high`** at 10, with both
   * scaling down on small effect textures. Default **`high`** when omitted
   * ({@link Group} passes {@link GroupEffects.quality}).
   */
  jfaQuality?: JfaQuality;
}

/**
 * Fluent builder for Photoshop-inspired layer styles as a single TSL `vec4` color node.
 * Effects are composited in **fixed** order (Photoshop stack): drop shadow → outer glow
 * → content + overlays → inner shadow → inner glow → stroke → optional blur → optional layer opacity.
 * Omitted methods stay off.
 *
 * @example
 * ```ts
 * const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: true, side: 2 });
 * mat.colorNode = layerStyles(group).dropShadow({ opacity: 0.5 }).stroke({ size: 0.008 }).node;
 * group.effectsMaterial = mat;
 * ```
 */
export class LayerStylesBuilder {
  private readonly _group: GroupRaw;

  private _dropShadow?: DropShadowOptions;
  private _outerGlow?: OuterGlowOptions;
  private _colorOverlay?: ColorOverlayOptions;
  private _gradientOverlay?: GradientOverlayOptions;
  private _innerShadow?: InnerShadowOptions;
  private _innerGlow?: InnerGlowOptions;
  private _stroke?: StrokeOptions;
  private _blur?: BlurOptions;
  private _opacity?: OpacityOptions;

  private _cachedNode: ReturnType<typeof vec4> | null = null;

  constructor(group: GroupRaw) {
    this._group = group;
  }

  /** Drop shadow behind the layer (offset + blurred alpha × color × opacity). */
  dropShadow(opts: DropShadowOptions): this {
    this._dropShadow = opts;
    this._cachedNode = null;
    return this;
  }

  /** Outer glow outside the layer silhouette (ring from blurred alpha minus source alpha). */
  outerGlow(opts: OuterGlowOptions): this {
    this._outerGlow = opts;
    this._cachedNode = null;
    return this;
  }

  /** Solid color tint over the layer contents (masked by source alpha). */
  colorOverlay(opts: ColorOverlayOptions): this {
    this._colorOverlay = opts;
    this._cachedNode = null;
    return this;
  }

  /** Gradient fill over the layer (texture ramp, linear or radial UV). */
  gradientOverlay(opts: GradientOverlayOptions): this {
    this._gradientOverlay = opts;
    this._cachedNode = null;
    return this;
  }

  /** Inner shadow along the inside edge (offset sample blurred vs source alpha). */
  innerShadow(opts: InnerShadowOptions): this {
    this._innerShadow = opts;
    this._cachedNode = null;
    return this;
  }

  /** Inner glow from edge or center (blurred-alpha edge band). */
  innerGlow(opts: InnerGlowOptions): this {
    this._innerGlow = opts;
    this._cachedNode = null;
    return this;
  }

  /** Stroke around the alpha boundary (outside / inside / center approximations). */
  stroke(opts: StrokeOptions): this {
    this._stroke = opts;
    this._cachedNode = null;
    return this;
  }

  /**
   * Blur the layer source texture (standalone). For full-stack blur after stroke, use
   * {@link Group} `effects.blur` (two-pass).
   */
  blur(opts: BlurOptions): this {
    this._blur = opts;
    this._cachedNode = null;
    return this;
  }

  /** Multiply final RGB and alpha by a single factor (layer opacity). */
  opacity(opts: OpacityOptions): this {
    this._opacity = opts;
    this._cachedNode = null;
    return this;
  }

  /**
   * Final `vec4` node: `rgb` = composited color, `a` = union of relevant alphas.
   * Assign to `MeshBasicNodeMaterial.colorNode`.
   */
  get node(): ReturnType<typeof vec4> {
    if (this._cachedNode === null) {
      this._cachedNode = this._build();
    }
    return this._cachedNode;
  }

  private _build(): ReturnType<typeof vec4> {
    const src = this._group.mapNode;
    const srcTex = src as ReturnType<typeof texture>;

    const bl = this._blur;
    let srcRgb: ReturnType<typeof vec3>;
    let srcA: ReturnType<typeof float>;
    if (bl) {
      const sigma = bl.sigma ?? 8;
      const r = bl.radius;
      const blurR: ReturnType<typeof uniform<number>> =
        typeof r === "number" ? uniform(r) : r;
      const blurred = blurPremult(srcTex, blurR, sigma);
      srcRgb = vec3(blurred.r, blurred.g, blurred.b);
      srcA = blurred.a;
    } else {
      srcRgb = vec3(src.r, src.g, src.b);
      srcA = src.a;
    }

    const ds = this._dropShadow;
    const og = this._outerGlow;
    const co = this._colorOverlay;
    const gOver = this._gradientOverlay;
    const ins = this._innerShadow;
    const ig = this._innerGlow;
    const st = this._stroke;
    const op = this._opacity;

    // ── Drop shadow (only allocate when enabled) ──────────────────────────
    let shadowMask = float(0);
    let bgRgb = vec3(0, 0, 0);
    if (ds) {
      const dsColor = uniform(new Color(ds.color ?? 0x000000));
      const dsOpacity = uniform(ds.opacity ?? 0.75);
      const dsAngle = uniform(ds.angle ?? 120);
      const dsDistance = uniform(ds.distance ?? 0.02);
      const dsSpread = uniform(ds.spread ?? 0);
      const dsBlurR = uniform(ds.blurRadius ?? 2);
      const dsPasses = ds.kawasePasses ?? 4;
      const dsBlurRes = ds.blurResolutionScale ?? 1;
      const dsRad = dsAngle.mul(PI).div(180);
      const dsOff = vec2(cos(dsRad), sin(dsRad)).mul(dsDistance).negate();
      const shadowSrc = this._group.createOffsetSample(dsOff);
      const shadowBlur = blurKawasePremult(
        shadowSrc as ReturnType<typeof texture>,
        dsBlurR,
        dsPasses,
        dsBlurRes,
      );
      const shadowRawA = shadowBlur.a;
      const shadowSpreadA = smoothstep(
        float(0),
        max(float(0.001), float(1).sub(dsSpread)),
        shadowRawA,
      );
      shadowMask = shadowSpreadA.mul(dsOpacity).clamp(0, 1);
      bgRgb = mix(bgRgb, vec3(dsColor), shadowMask);
    }

    // ── Outer glow (only allocate when enabled) ───────────────────────────
    let ogMask = float(0);
    if (og) {
      const ogColorU = uniform(new Color(og.color ?? 0xffff00));
      const ogOpacity = uniform(og.opacity ?? 0.8);
      const ogSpread = uniform(og.spread ?? 0);
      const ogBlurR = uniform(og.blurRadius ?? 4);
      const ogPasses = og.kawasePasses ?? 4;
      const ogBlurRes = og.blurResolutionScale ?? 1;
      const ogBlur = blurKawasePremult(srcTex, ogBlurR, ogPasses, ogBlurRes);
      const ogRingRaw = max(float(0), ogBlur.a.sub(srcA));
      const ogRing = smoothstep(
        float(0),
        max(float(0.001), float(1).sub(ogSpread)),
        ogRingRaw,
      );
      ogMask = ogRing.mul(ogOpacity).clamp(0, 1);

      const ogGradTex = og.gradientTexture;
      const ogSolid = vec3(ogColorU);
      const ogSampleU = clamp(ogRing.mul(2), 0, 1);
      const ogTexSample = ogGradTex
        ? texture(ogGradTex, vec2(ogSampleU, 0.5))
        : null;
      const ogRgb = ogTexSample
        ? vec3(ogTexSample.r, ogTexSample.g, ogTexSample.b)
        : ogSolid;
      bgRgb = mix(bgRgb, ogRgb, ogMask);
    }

    // ── Content + overlays ────────────────────────────────────────────────
    let layerRgb = srcRgb;
    if (co) {
      const c = uniform(new Color(co.color ?? 0xff0000));
      const o = uniform(co.opacity ?? 0.3);
      layerRgb = mix(layerRgb, vec3(c), o.mul(srcA));
    }
    if (gOver) {
      const gTex = gOver.texture;
      const gOp = uniform(gOver.opacity ?? 0.9);
      const gAng = uniform((gOver.angle ?? 90) * (Math.PI / 180));
      const gScale = uniform(gOver.scale ?? 1);
      const gRev = gOver.reverse ?? false;
      const u = uv();
      const c = vec2(0.5, 0.5);
      const dir = vec2(cos(gAng), sin(gAng));
      const linearT = dot(u.sub(c), dir).mul(gScale).add(0.5);
      const radialT = length(u.sub(c)).mul(2).mul(gScale);
      const tRaw = gOver.style === "radial" ? radialT : linearT;
      const tClamped = clamp(tRaw, 0, 1);
      const t = gRev ? float(1).sub(tClamped) : tClamped;
      const gSamp = texture(gTex, vec2(t, 0.5));
      const gCol = vec3(gSamp.r, gSamp.g, gSamp.b);
      layerRgb = mix(layerRgb, gCol, gOp.mul(srcA));
    }

    let rgb = mix(bgRgb, layerRgb, srcA);

    // ── Inner shadow (single graph, reused for alpha) ─────────────────────
    let innerShadowMask = float(0);
    if (ins) {
      const isColor = uniform(new Color(ins.color ?? 0x000000));
      const isOp = uniform(ins.opacity ?? 0.6);
      const isAngle = uniform(ins.angle ?? 120);
      const isDist = uniform(ins.distance ?? 0.01);
      const isChoke = uniform(ins.choke ?? 0);
      const isBlurR = uniform(ins.blurRadius ?? 1);
      const isPasses = ins.kawasePasses ?? 4;
      const isBlurRes = ins.blurResolutionScale ?? 1;
      const isRad = isAngle.mul(PI).div(180);
      const isOff = vec2(cos(isRad), sin(isRad)).mul(isDist);
      const innerSrc = this._group.createOffsetSample(isOff);
      const innerBlur = blurKawasePremult(
        innerSrc as ReturnType<typeof texture>,
        isBlurR,
        isPasses,
        isBlurRes,
      );
      const raw = srcA.mul(float(1).sub(innerBlur.a).clamp(0, 1));
      innerShadowMask = smoothstep(isChoke, float(1), raw).mul(isOp).mul(srcA);
      rgb = mix(rgb, vec3(isColor), innerShadowMask);
    }

    // ── Inner glow ────────────────────────────────────────────────────────
    let innerGlowMask = float(0);
    if (ig) {
      const igOp = uniform(ig.opacity ?? 0.5);
      const igChoke = uniform(ig.choke ?? 0);
      const igBlurR = uniform(ig.blurRadius ?? 2);
      const igPasses = ig.kawasePasses ?? 4;
      const igBlurRes = ig.blurResolutionScale ?? 1;
      const igBlur = blurKawasePremult(srcTex, igBlurR, igPasses, igBlurRes);
      const edgeBand = max(
        float(0),
        srcA.sub(smoothstep(igChoke, float(1), igBlur.a)),
      );
      const centerBand = srcA.mul(smoothstep(float(0), float(1).sub(igChoke), igBlur.a));
      const band = ig.source === "center" ? centerBand : edgeBand;
      innerGlowMask = band.mul(igOp);

      const igColU = uniform(new Color(ig.color ?? 0xffffff));
      const igSolid = vec3(igColU);
      const igT = clamp(band.mul(2), 0, 1);
      const igSamp = ig.gradientTexture
        ? texture(ig.gradientTexture, vec2(igT, 0.5))
        : null;
      const igRgb = igSamp
        ? vec3(igSamp.r, igSamp.g, igSamp.b)
        : igSolid;
      rgb = mix(rgb, igRgb, innerGlowMask);
    }

    // ── Stroke (Jump Flooding Algorithm — Euclidean distance field) ──────
    // JFA propagates nearest-seed UVs in O(log N) passes, yielding a true
    // Euclidean distance field.  This gives circular arcs at convex corners
    // and perfectly sharp joins at concave corners (matches Photoshop).
    let strokeMask = float(0);
    if (st) {
      const stColor = uniform(new Color(st.color ?? 0x000000));
      const stOp = uniform(st.opacity ?? 1);
      // Accept either a plain number or a pre-made uniform node.
      const stSize: ReturnType<typeof uniform<number>> =
        typeof st.size === "number" || st.size === undefined
          ? uniform(st.size ?? 10)
          : st.size;
      const pos = st.position ?? "outside";
      const jfq: JfaQuality = st.jfaQuality ?? "high";

      if (pos === "outside") {
        // jfaOutsideStroke returns an *expanded fill* mask: all pixels within `stSize`
        // pixels of the alpha boundary, on both sides.  We composite the content back on
        // top so the stroke only shows where srcA < 1.
        //
        //   pixel at srcA=0   → pure strokeColor  (outer stroke band)
        //   pixel at srcA=0.6 → mix(strokeColor, content, 0.6)  (smooth edge, no gap)
        //   pixel at srcA=1   → pure content  (interior, unchanged)
        //
        // This eliminates the transparent gap that appears at anti-aliased edges when the
        // stroke is naively limited to srcA < 0.5.
        const jfa = jfaOutsideStroke(srcTex, stSize, jfq);
        const expanded = jfa.r.mul(stOp);
        rgb = mix(rgb, mix(vec3(stColor), rgb, srcA), expanded);
        strokeMask = expanded;
      } else if (pos === "inside") {
        // Stroke extends inward — seeds are alpha < 0.5 pixels.
        const jfa = jfaInsideStroke(srcTex, stSize, jfq);
        strokeMask = jfa.r.mul(stOp);
        rgb = mix(rgb, vec3(stColor), strokeMask);
      } else {
        // Center: half the radius extends outward, half inward.
        // Outside half uses expanded-fill compositing; inside half uses standard mixing.
        const halfSize = stSize.div(float(2));
        const jfaOut = jfaOutsideStroke(srcTex, halfSize, jfq);
        const jfaIn = jfaInsideStroke(srcTex, halfSize, jfq);
        const expandedOut = jfaOut.r.mul(stOp);
        const maskIn = jfaIn.r.mul(stOp);
        // Apply outside (expanded fill) first, then inside on top.
        rgb = mix(rgb, mix(vec3(stColor), rgb, srcA), expandedOut);
        rgb = mix(rgb, vec3(stColor), maskIn);
        strokeMask = expandedOut.add(maskIn).min(float(1));
      }
    }

    // ── Output alpha (union) ──────────────────────────────────────────────
    let outA = shadowMask;
    outA = max(outA, ogMask);
    outA = max(outA, srcA);
    outA = max(outA, innerShadowMask);
    outA = max(outA, innerGlowMask);
    outA = max(outA, strokeMask);

    // ── Layer opacity (after full stack) ──────────────────────────────────
    if (op) {
      const v = op.value;
      const opU =
        typeof v === "number"
          ? uniform(Math.min(1, Math.max(0, v ?? 1)))
          : v;
      return vec4(mul(rgb, opU), mul(outA, opU));
    }

    return vec4(rgb, outA);
  }
}

/**
 * Entry point: returns a {@link LayerStylesBuilder} bound to the given effects `GroupRaw`.
 */
export function layerStyles(group: GroupRaw): LayerStylesBuilder {
  return new LayerStylesBuilder(group);
}
