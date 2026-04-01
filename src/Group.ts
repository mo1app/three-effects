import {
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  Color,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  Texture,
  Vector4,
} from "three/webgpu";
import { float, mul, texture, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import {
  GroupRaw,
  type GroupEffectsQuality,
  type RendererLike,
} from "./GroupRaw.js";
import { layerStyles, type LayerStylesBuilder } from "./layerStyles.js";
import {
  colorStopsFromSerialized,
  createGradientTexture,
  type SerializedGradientStop,
} from "./gradientTexture.js";
import {
  effectsMaterialCacheKey,
  RT_FALLBACK,
} from "./effectsMaterialCacheKey.js";

// ─── sigma defaults (match layerStyles / playground) ─────────────────────────

/**
 * Kawase blur preset for drop shadow, outer glow, inner shadow, inner glow
 * (`blurRadius = sizePx / blurDenom`).
 */
const LAYER_KAWASE_QUALITY = {
  fast: { kawasePasses: 4, blurResolutionScale: 0.5, blurDenom: 14 },
  high: { kawasePasses: 6, blurResolutionScale: 1, blurDenom: 26 },
} as const;
/** Layer-wide `effects.blur` Gaussian sigma (`kernelSize = 3 + 2*sigma`) by {@link GroupEffects.quality}. */
const BLUR_LAYER_SIGMA = {
  fast: 5,
  high: 8,
} as const;

const EFFECTS_MAT_CACHE_MAX = 8;

const _blurOrthoCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** LRU value: material + gradient texture owned by that graph (if any). */
type CachedEffectsMaterial = {
  mat: MeshBasicNodeMaterial;
  gradientTex: DataTexture | null;
};

// ─── public effect block types ───────────────────────────────────────────────

export type GroupEffectsStroke = {
  enabled: boolean;
  /** Stroke radius in screen pixels (JFA). */
  sizePx: number;
  position: "outside" | "inside" | "center";
  opacity: number;
  color: Color;
};

export type GroupEffectsDropShadow = {
  enabled: boolean;
  opacity: number;
  angle: number;
  distancePx: number;
  spread: number;
  sizePx: number;
  color: Color;
};

export type GroupEffectsOuterGlow = {
  enabled: boolean;
  opacity: number;
  spread: number;
  sizePx: number;
  color: Color;
};

export type GroupEffectsColorOverlay = {
  enabled: boolean;
  opacity: number;
  color: Color;
};

export type GroupEffectsGradientOverlay = {
  enabled: boolean;
  opacity: number;
  style: "linear" | "radial";
  angle: number;
  scale: number;
  reverse: boolean;
  stops: SerializedGradientStop[];
};

export type GroupEffectsInnerShadow = {
  enabled: boolean;
  opacity: number;
  angle: number;
  distancePx: number;
  choke: number;
  sizePx: number;
  color: Color;
};

export type GroupEffectsInnerGlow = {
  enabled: boolean;
  opacity: number;
  source: "edge" | "center";
  choke: number;
  sizePx: number;
  color: Color;
};

/** Layer-wide opacity after all other styles (multiplies RGB and alpha). */
export type GroupEffectsOpacity = {
  enabled: boolean;
  /** `0…1` */
  value: number;
};

/** Full-stack Gaussian blur after stroke, before layer opacity (two-pass in {@link Group}). */
export type GroupEffectsBlur = {
  enabled: boolean;
  /** Blur radius in screen pixels (converted to `gaussianBlur` direction scale). */
  sizePx: number;
};

/**
 * Reactive layer-style configuration for {@link Group}. Each block has an
 * `enabled` flag and parameters aligned with {@link layerStyles}.
 */
export type GroupEffects = {
  /**
   * When omitted or `undefined`, {@link GroupRaw.defaultQuality} is used (also exposed as {@link Group.defaultQuality}).
   */
  quality?: GroupEffectsQuality;
  stroke: GroupEffectsStroke;
  dropShadow: GroupEffectsDropShadow;
  outerGlow: GroupEffectsOuterGlow;
  colorOverlay: GroupEffectsColorOverlay;
  gradientOverlay: GroupEffectsGradientOverlay;
  innerShadow: GroupEffectsInnerShadow;
  innerGlow: GroupEffectsInnerGlow;
  blur: GroupEffectsBlur;
  opacity: GroupEffectsOpacity;
};

function createDefaultEffects(): GroupEffects {
  return {
    stroke: {
      enabled: false,
      sizePx: 10,
      position: "outside",
      opacity: 1,
      color: new Color(0x000000),
    },
    dropShadow: {
      enabled: false,
      opacity: 0.75,
      angle: 120,
      distancePx: 8,
      spread: 0,
      sizePx: 24,
      color: new Color(0x000000),
    },
    outerGlow: {
      enabled: false,
      opacity: 0.8,
      spread: 0,
      sizePx: 16,
      color: new Color(0xffff00),
    },
    colorOverlay: {
      enabled: false,
      opacity: 0.3,
      color: new Color(0xff0000),
    },
    gradientOverlay: {
      enabled: false,
      opacity: 0.9,
      style: "linear",
      angle: 90,
      scale: 1,
      reverse: false,
      stops: [
        { color: "#ff0000", position: 0 },
        { color: "#0000ff", position: 1 },
      ],
    },
    innerShadow: {
      enabled: false,
      opacity: 0.6,
      angle: 120,
      distancePx: 4,
      choke: 0,
      sizePx: 8,
      color: new Color(0x000000),
    },
    innerGlow: {
      enabled: false,
      opacity: 0.5,
      source: "edge",
      choke: 0,
      sizePx: 8,
      color: new Color(0xffffff),
    },
    blur: {
      enabled: false,
      sizePx: 10,
    },
    opacity: {
      enabled: true,
      value: 1,
    },
  };
}

// ─── deep proxy (cached per object) ───────────────────────────────────────────

function createDeepProxy<T extends object>(
  target: T,
  onPath: (path: string[]) => void,
): T {
  const cache = new WeakMap<object, object>();

  function wrap(obj: object, path: string[]): any {
    if (cache.has(obj)) return cache.get(obj)!;
    const pxy = new Proxy(obj, {
      get(o, k) {
        const v = Reflect.get(o, k);
        if (v !== null && typeof v === "object") {
          if (v instanceof Color) return v;
          if (Array.isArray(v)) return wrapArray(v, [...path, String(k)]);
          return wrap(v as object, [...path, String(k)]);
        }
        return v;
      },
      set(o, k, v, r) {
        Reflect.set(o, k, v, r);
        onPath([...path, String(k)]);
        return true;
      },
    });
    cache.set(obj, pxy);
    return pxy;
  }

  function wrapArray(arr: unknown[], path: string[]): unknown[] {
    if (cache.has(arr as object)) return cache.get(arr as object)! as unknown[];
    const pxy = new Proxy(arr, {
      set(a, i, v) {
        Reflect.set(a, i, v);
        onPath([...path, String(i)]);
        return true;
      },
      get(a, i) {
        const v = Reflect.get(a, i);
        if (v !== null && typeof v === "object" && !(v instanceof Color)) {
          return wrap(v as object, [...path, String(i)]);
        }
        return v;
      },
    });
    cache.set(arr as object, pxy);
    return pxy as unknown[];
  }

  return wrap(target, []) as T;
}

// ─── Group ───────────────────────────────────────────────────────────────────

/**
 * High-level {@link GroupRaw} with a reactive {@link GroupEffects | effects}
 * object (deep `Proxy`) that drives `layerStyles()` and optional automatic
 * render-target padding for outward effects.
 *
 * Defaults: `effectsEnabled` is `true`. Prefer {@link GroupRaw} for fully
 * manual `effectsMaterial` pipelines.
 */
export class Group extends GroupRaw {
  /**
   * Alias for {@link GroupRaw.defaultQuality}. Unset {@link Group.effects.quality} resolves against this.
   */
  static get defaultQuality(): GroupEffectsQuality {
    return GroupRaw.defaultQuality;
  }
  static set defaultQuality(v: GroupEffectsQuality) {
    GroupRaw.defaultQuality = v;
  }

  /**
   * When `true`, {@link padding} is set each frame from enabled outward effects
   * plus {@link paddingExtra}. When `false`, only `padding` / `paddingExtra`
   * you set are used.
   * @default true
   */
  autoPadding = true;

  /**
   * Extra NDC-Y padding added on top of {@link autoPadding} margin (same units
   * as {@link GroupRaw.padding}).
   * @default 0
   */
  paddingExtra = 0;

  private readonly _effectsTarget: GroupEffects;
  readonly effects: GroupEffects;

  private readonly _strokeSizeUniform = uniform(10);
  /** Drives `layerStyles().opacity()` when `effects.opacity.enabled` — updated without graph rebuild for smooth animation. */
  private readonly _layerOpacityUniform = uniform(1);
  private _gradientTexture: DataTexture | null = null;

  /** Direction scale for {@link gaussianBlur}; `sizePx / (2 + 2 * sigma)` with sigma from {@link GroupEffects.quality}. */
  private readonly _blurRadiusUniform = uniform(2);
  private readonly _blurPlaceholderTex = new Texture();
  private readonly _blurTexNode: ReturnType<typeof texture>;
  private _blurTarget: RenderTarget | null = null;
  private _blurTargetW = 0;
  private _blurTargetH = 0;
  private _blurStackMat: MeshBasicNodeMaterial | null = null;
  private _blurFinalMat: MeshBasicNodeMaterial | null = null;
  private readonly _blurQuadMesh: Mesh;
  private readonly _blurQuadScene: Scene;
  private readonly _blurQuadInitMat: MeshBasicNodeMaterial;

  /**
   * LRU cache of compiled `effectsMaterial` variants (max {@link EFFECTS_MAT_CACHE_MAX}).
   *
   * **Invariants (read before changing dispose / gradient / cache logic):**
   * - Cache keys must **not** include values driven by live uniforms (`stroke.sizePx`, `effects.opacity.value`, `effects.blur.sizePx`); update those uniforms instead.
   * - Each entry may own a `gradientTex` ref also held in {@link _gradientTexture}; never `dispose()` a `DataTexture` still referenced by any cache entry.
   * - Before replacing `_gradientTexture`, use {@link _gradientTextureReferencedInCache}; evicted entries {@link _cacheEffectsMaterial} dispose their own `gradientTex`.
   * - Eviction skips the material currently assigned to `effectsMaterial` so we never dispose the active program.
   */
  private readonly _effectsMaterialCache = new Map<
    string,
    CachedEffectsMaterial
  >();

  /** Set when `effects` change in a way that requires rebuilding `effectsMaterial`. Cleared when `GroupRaw.preRenderEffects` runs or when {@link commitEffects} is called. */
  private _effectsDirty = false;

  /**
   * Last `renderTargetWidth` (or {@link RT_FALLBACK}) used to bake drop/inner shadow UV distance.
   * When the real crop width diverges (e.g. first build used fallback before any offscreen pass),
   * we force a rebuild so `distancePx / rtW` matches the texture.
   */
  private _effectsDistanceRtWCommitted = 0;

  constructor() {
    super();
    // Match WebGPU RT orientation: same Y-flip as {@link GroupRaw.mapNode} (V=0 at texture top).
    this._blurTexNode = texture(
      this._blurPlaceholderTex,
      vec2(uv().x, float(1).sub(uv().y)),
    );
    this._blurQuadScene = new Scene();
    const blurQuadMat = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: 2,
    });
    blurQuadMat.colorNode = this.mapNode as MeshBasicNodeMaterial["colorNode"];
    this._blurQuadInitMat = blurQuadMat;
    this._blurQuadMesh = new Mesh(new PlaneGeometry(2, 2), blurQuadMat);
    this._blurQuadMesh.frustumCulled = false;
    this._blurQuadScene.add(this._blurQuadMesh);

    this._effectsTarget = createDefaultEffects();
    this.effects = createDeepProxy(this._effectsTarget, (path) =>
      this._onEffectsPath(path),
    );
    this.effectsEnabled = true;
    this._syncEffectsMaterial();
  }

  /**
   * Mutates the internal effects state (bypassing the reactive proxy) and marks
   * the material stale. The shader graph is rebuilt on the next
   * `GroupRaw.preRenderEffects` / `preRenderEffects` (or call {@link commitEffects} to sync immediately).
   */
  applyEffects(fn: (effects: GroupEffects) => void): void {
    fn(this._effectsTarget);
    this._effectsDirty = true;
  }

  /**
   * Rebuilds `effectsMaterial` now if any deferred changes are pending. Normally
   * runs automatically inside `GroupRaw.preRenderEffects`; use this after bulk
   * updates when you need the material before the next frame (e.g. tests).
   */
  commitEffects(): void {
    this._flushDeferredEffectsSync();
  }

  protected override _flushDeferredEffectsSync(): void {
    const e = this._effectsTarget;
    const rw = this.renderTargetWidth;
    if (
      (e.dropShadow.enabled || e.innerShadow.enabled) &&
      rw > 0 &&
      this._effectsDistanceRtWCommitted !== rw
    ) {
      this._effectsDirty = true;
    }
    if (!this._effectsDirty) return;
    this._effectsDirty = false;
    this._syncEffectsMaterial();
  }

  private _touchEffectsDistanceRtWCommit(e: GroupEffects, rtW: number): void {
    if (e.dropShadow.enabled || e.innerShadow.enabled) {
      const rw = this.renderTargetWidth;
      this._effectsDistanceRtWCommitted = rw > 0 ? rw : rtW;
    } else {
      this._effectsDistanceRtWCommitted = 0;
    }
  }

  private _resolvedQuality(): GroupEffectsQuality {
    return this._effectsTarget.quality ?? GroupRaw.defaultQuality;
  }

  private _onEffectsPath(path: string[]): void {
    if (
      path.length === 2 &&
      path[0] === "stroke" &&
      path[1] === "sizePx" &&
      this._effectsTarget.stroke.enabled &&
      this.effectsMaterial
    ) {
      this._strokeSizeUniform.value = this._effectsTarget.stroke.sizePx;
      return;
    }
    if (
      path.length === 2 &&
      path[0] === "opacity" &&
      path[1] === "value" &&
      this._effectsTarget.opacity.enabled &&
      this.effectsMaterial
    ) {
      const v = this._effectsTarget.opacity.value;
      this._layerOpacityUniform.value = Math.min(1, Math.max(0, v));
      return;
    }
    if (
      path.length === 2 &&
      path[0] === "blur" &&
      path[1] === "sizePx" &&
      this._effectsTarget.blur.enabled &&
      this.effectsMaterial
    ) {
      const bs = BLUR_LAYER_SIGMA[this._resolvedQuality()];
      this._blurRadiusUniform.value =
        this._effectsTarget.blur.sizePx / (2 + 2 * bs);
      return;
    }
    this._effectsDirty = true;
  }

  private _gradientTextureReferencedInCache(tex: DataTexture): boolean {
    for (const v of this._effectsMaterialCache.values()) {
      if (v.gradientTex === tex) return true;
    }
    return false;
  }

  private _takeCachedEffectsMaterial(
    key: string,
  ): CachedEffectsMaterial | undefined {
    const v = this._effectsMaterialCache.get(key);
    if (!v) return undefined;
    this._effectsMaterialCache.delete(key);
    this._effectsMaterialCache.set(key, v);
    return v;
  }

  private _cacheEffectsMaterial(
    key: string,
    entry: CachedEffectsMaterial,
  ): void {
    if (this._effectsMaterialCache.has(key)) {
      this._effectsMaterialCache.delete(key);
    }
    this._effectsMaterialCache.set(key, entry);
    while (this._effectsMaterialCache.size > EFFECTS_MAT_CACHE_MAX) {
      let evictKey: string | undefined;
      for (const [k, v] of this._effectsMaterialCache) {
        if (v.mat !== this.effectsMaterial) {
          evictKey = k;
          break;
        }
      }
      if (!evictKey) break;
      const ev = this._effectsMaterialCache.get(evictKey)!;
      this._effectsMaterialCache.delete(evictKey);
      ev.mat.dispose();
      ev.gradientTex?.dispose();
    }
  }

  private _releaseMaterialIfStale(m: MeshBasicNodeMaterial | null): void {
    if (!m) return;
    for (const v of this._effectsMaterialCache.values()) {
      if (v.mat === m) return;
    }
    m.dispose();
  }

  private _applyStyleChain(
    b: LayerStylesBuilder,
    e: GroupEffects,
    rtW: number,
  ): LayerStylesBuilder {
    const q = e.quality ?? GroupRaw.defaultQuality;
    if (e.dropShadow.enabled) {
      const dsQ = LAYER_KAWASE_QUALITY[q];
      b = b.dropShadow({
        color: e.dropShadow.color,
        opacity: e.dropShadow.opacity,
        angle: e.dropShadow.angle,
        distance: e.dropShadow.distancePx / rtW,
        spread: e.dropShadow.spread,
        blurRadius: e.dropShadow.sizePx / dsQ.blurDenom,
        kawasePasses: dsQ.kawasePasses,
        blurResolutionScale: dsQ.blurResolutionScale,
      });
    }
    if (e.outerGlow.enabled) {
      const kq = LAYER_KAWASE_QUALITY[q];
      b = b.outerGlow({
        color: e.outerGlow.color,
        opacity: e.outerGlow.opacity,
        spread: e.outerGlow.spread,
        blurRadius: e.outerGlow.sizePx / kq.blurDenom,
        kawasePasses: kq.kawasePasses,
        blurResolutionScale: kq.blurResolutionScale,
      });
    }
    if (e.colorOverlay.enabled) {
      b = b.colorOverlay({
        color: e.colorOverlay.color,
        opacity: e.colorOverlay.opacity,
      });
    }
    if (e.gradientOverlay.enabled && e.gradientOverlay.stops.length > 0) {
      b = b.gradientOverlay({
        texture: this._gradientTexture!,
        opacity: e.gradientOverlay.opacity,
        style: e.gradientOverlay.style,
        angle: e.gradientOverlay.angle,
        scale: e.gradientOverlay.scale,
        reverse: e.gradientOverlay.reverse,
      });
    }
    if (e.innerShadow.enabled) {
      const kq = LAYER_KAWASE_QUALITY[q];
      b = b.innerShadow({
        color: e.innerShadow.color,
        opacity: e.innerShadow.opacity,
        angle: e.innerShadow.angle,
        distance: e.innerShadow.distancePx / rtW,
        choke: e.innerShadow.choke,
        blurRadius: e.innerShadow.sizePx / kq.blurDenom,
        kawasePasses: kq.kawasePasses,
        blurResolutionScale: kq.blurResolutionScale,
      });
    }
    if (e.innerGlow.enabled) {
      const kq = LAYER_KAWASE_QUALITY[q];
      b = b.innerGlow({
        color: e.innerGlow.color,
        opacity: e.innerGlow.opacity,
        source: e.innerGlow.source,
        choke: e.innerGlow.choke,
        blurRadius: e.innerGlow.sizePx / kq.blurDenom,
        kawasePasses: kq.kawasePasses,
        blurResolutionScale: kq.blurResolutionScale,
      });
    }
    if (e.stroke.enabled) {
      this._strokeSizeUniform.value = e.stroke.sizePx;
      b = b.stroke({
        color: e.stroke.color,
        opacity: e.stroke.opacity,
        position: e.stroke.position,
        size: this._strokeSizeUniform,
        jfaQuality: q,
      });
    }
    return b;
  }

  /**
   * Rebuilds or reuses `effectsMaterial` from the LRU cache when the **effect signature** changes.
   *
   * **Layer opacity (`effects.opacity`):** `value` is **not** part of the cache key. It drives
   * `_layerOpacityUniform` so you can animate opacity every frame (or scrub a slider)
   * without recompiling the node graph — same pattern as `_strokeSizeUniform`.
   *
   * **Blur (`effects.blur`):** two-pass — pre-blur stack → `_blurTarget` → `gaussianBlur` → billboard.
   * `sizePx` is not part of the cache key; it drives `_blurRadiusUniform`.
   */
  private _syncEffectsMaterial(): void {
    const prev = this.effectsMaterial;
    const e = this._effectsTarget;

    const hasStyleEffects =
      e.stroke.enabled ||
      e.dropShadow.enabled ||
      e.outerGlow.enabled ||
      e.colorOverlay.enabled ||
      e.gradientOverlay.enabled ||
      e.innerShadow.enabled ||
      e.innerGlow.enabled;
    const layerOpacityOn = e.opacity.enabled;
    const blurOn = e.blur.enabled;
    const any = hasStyleEffects || layerOpacityOn || blurOn;

    const rtW =
      this.renderTargetWidth > 0 ? this.renderTargetWidth : RT_FALLBACK;

    try {
      if (blurOn) {
        if (e.gradientOverlay.enabled && e.gradientOverlay.stops.length > 0) {
          const prevTex = this._gradientTexture;
          if (prevTex && !this._gradientTextureReferencedInCache(prevTex)) {
            prevTex.dispose();
          }
          this._gradientTexture = createGradientTexture(
            colorStopsFromSerialized(e.gradientOverlay.stops),
          );
        } else {
          const prevTex = this._gradientTexture;
          if (prevTex && !this._gradientTextureReferencedInCache(prevTex)) {
            prevTex.dispose();
          }
          this._gradientTexture = null;
        }

        let b = layerStyles(this);
        b = this._applyStyleChain(b, e, rtW);

        this._blurStackMat?.dispose();
        const stackMat = new MeshBasicNodeMaterial({
          transparent: true,
          depthWrite: true,
          side: 2,
        });
        stackMat.colorNode = b.node as MeshBasicNodeMaterial["colorNode"];
        this._blurStackMat = stackMat;

        const blurSigma = BLUR_LAYER_SIGMA[this._resolvedQuality()];
        this._blurRadiusUniform.value = e.blur.sizePx / (2 + 2 * blurSigma);
        if (layerOpacityOn) {
          this._layerOpacityUniform.value = Math.min(
            1,
            Math.max(0, e.opacity.value),
          );
        }

        this._blurFinalMat?.dispose();
        const finalMat = new MeshBasicNodeMaterial({
          transparent: true,
          depthWrite: true,
          side: 2,
        });
        const gb = gaussianBlur(
          this._blurTexNode as never,
          this._blurRadiusUniform,
          blurSigma,
        );
        gb.premultipliedAlpha = true;
        if (layerOpacityOn) {
          const rgb = vec3(gb.r, gb.g, gb.b);
          const a = gb.a;
          finalMat.colorNode = vec4(
            mul(rgb, this._layerOpacityUniform),
            mul(a, this._layerOpacityUniform),
          ) as MeshBasicNodeMaterial["colorNode"];
        } else {
          finalMat.colorNode = vec4(
            gb.r,
            gb.g,
            gb.b,
            gb.a,
          ) as MeshBasicNodeMaterial["colorNode"];
        }
        this._blurFinalMat = finalMat;

        this._releaseMaterialIfStale(prev);
        this.effectsMaterial = finalMat;
        return;
      }

      if (this._blurStackMat) {
        this._blurStackMat.dispose();
        this._blurStackMat = null;
      }
      if (this._blurFinalMat) {
        this._blurFinalMat.dispose();
        this._blurFinalMat = null;
      }

      const cacheKey = effectsMaterialCacheKey(e, rtW);
      const cached = this._takeCachedEffectsMaterial(cacheKey);
      if (cached) {
        if (
          this._gradientTexture &&
          this._gradientTexture !== cached.gradientTex &&
          !this._gradientTextureReferencedInCache(this._gradientTexture)
        ) {
          this._gradientTexture.dispose();
        }
        this._gradientTexture = cached.gradientTex;
        if (e.stroke.enabled) {
          this._strokeSizeUniform.value = e.stroke.sizePx;
        }
        if (layerOpacityOn) {
          this._layerOpacityUniform.value = Math.min(
            1,
            Math.max(0, e.opacity.value),
          );
        }
        this.effectsMaterial = cached.mat;
        if (prev && prev !== cached.mat) {
          this._releaseMaterialIfStale(prev);
        }
        return;
      }

      if (!any) {
        const prevTex = this._gradientTexture;
        if (prevTex && !this._gradientTextureReferencedInCache(prevTex)) {
          prevTex.dispose();
        }
        this._gradientTexture = null;
        const mat = new MeshBasicNodeMaterial({
          transparent: true,
          depthWrite: true,
          side: 2,
        });
        mat.colorNode = this.mapNode as MeshBasicNodeMaterial["colorNode"];
        this._cacheEffectsMaterial(cacheKey, { mat, gradientTex: null });
        this.effectsMaterial = mat;
        if (prev && prev !== mat) {
          this._releaseMaterialIfStale(prev);
        }
        return;
      }

      const mat = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: true,
        side: 2,
      });

      if (e.gradientOverlay.enabled && e.gradientOverlay.stops.length > 0) {
        const prevTex = this._gradientTexture;
        if (prevTex && !this._gradientTextureReferencedInCache(prevTex)) {
          prevTex.dispose();
        }
        this._gradientTexture = createGradientTexture(
          colorStopsFromSerialized(e.gradientOverlay.stops),
        );
      } else {
        const prevTex = this._gradientTexture;
        if (prevTex && !this._gradientTextureReferencedInCache(prevTex)) {
          prevTex.dispose();
        }
        this._gradientTexture = null;
      }

      let b = layerStyles(this);
      b = this._applyStyleChain(b, e, rtW);

      if (layerOpacityOn) {
        this._layerOpacityUniform.value = Math.min(
          1,
          Math.max(0, e.opacity.value),
        );
        b = b.opacity({ value: this._layerOpacityUniform });
      }

      mat.colorNode = b.node as MeshBasicNodeMaterial["colorNode"];
      this._cacheEffectsMaterial(cacheKey, {
        mat,
        gradientTex: this._gradientTexture,
      });
      this.effectsMaterial = mat;
      if (prev && prev !== mat) {
        this._releaseMaterialIfStale(prev);
      }
    } finally {
      this._touchEffectsDistanceRtWCommit(e, rtW);
    }
  }

  protected override _renderToTarget(
    renderer: RendererLike,
    scene: Scene,
    camera: PerspectiveCamera,
  ): void {
    super._renderToTarget(renderer, scene, camera);

    const e = this._effectsTarget;
    if (!e.blur.enabled || !this._isEffectsBillboardVisible()) return;

    const w = this.renderTargetWidth;
    const h = this.renderTargetHeight;
    if (w <= 0 || h <= 0) return;
    if (!this._blurStackMat) return;

    if (
      !this._blurTarget ||
      this._blurTargetW !== w ||
      this._blurTargetH !== h
    ) {
      this._blurTarget?.dispose();
      this._blurTarget = new RenderTarget(w, h, {
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        type: HalfFloatType,
      });
      this._blurTargetW = w;
      this._blurTargetH = h;
      this._blurTexNode.value = this._blurTarget.texture;
    }

    this._blurQuadMesh.material = this._blurStackMat;

    const savedRt = renderer.getRenderTarget();
    const savedViewport = new Vector4();
    renderer.getViewport(savedViewport);
    const savedClear = new Color();
    renderer.getClearColor(savedClear);
    const savedClearAlpha = renderer.getClearAlpha();

    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this._blurTarget);
    renderer.clear();

    const dpr = renderer.getPixelRatio();
    renderer.setViewport(0, 0, w / dpr, h / dpr);

    renderer.render(this._blurQuadScene, _blurOrthoCamera);

    renderer.setRenderTarget(savedRt);
    renderer.setViewport(savedViewport);
    renderer.setClearColor(savedClear, savedClearAlpha);
  }

  protected override _syncAutoPadding(
    _renderer: RendererLike,
    _camera: PerspectiveCamera,
    _fullW: number,
    fullH: number,
  ): void {
    if (!this.autoPadding) return;

    let marginPx = 0;
    const e = this._effectsTarget;

    if (e.stroke.enabled) {
      if (e.stroke.position === "outside") marginPx += e.stroke.sizePx;
      else if (e.stroke.position === "center")
        marginPx += e.stroke.sizePx * 0.5;
    }
    if (e.dropShadow.enabled) {
      marginPx += e.dropShadow.distancePx + e.dropShadow.sizePx + 4;
    }
    if (e.outerGlow.enabled) {
      marginPx += e.outerGlow.sizePx + 4;
    }
    if (e.blur.enabled) {
      marginPx += e.blur.sizePx + 4;
    }

    marginPx += 2;

    const dist = this._getContentWorldCenterDistance(_camera);
    let paddingNdc = 0;
    if (dist !== null && marginPx > 0 && fullH > 0) {
      // Same world-units-per-pixel as the billboard plane (GroupRaw onBeforeRender):
      // wpp = viewportHWorld / fullH, marginWorld = marginPx * wpp.
      // NDC Y spans 2 for the full viewport height in world units at this depth:
      // padding = (2 * marginWorld) / viewportHWorld  (= 2 * marginPx / fullH).
      const fovRad = (_camera.fov * Math.PI) / 180;
      const viewportHWorld = 2 * dist * Math.tan(fovRad * 0.5);
      const wpp = viewportHWorld / fullH;
      const marginWorld = marginPx * wpp;
      paddingNdc = (2 * marginWorld) / viewportHWorld;
    }

    this.padding = paddingNdc + this.paddingExtra;
  }

  override dispose(): void {
    for (const [, v] of this._effectsMaterialCache) {
      v.mat.dispose();
      v.gradientTex?.dispose();
    }
    this._effectsMaterialCache.clear();
    this._gradientTexture = null;
    this._blurTarget?.dispose();
    this._blurTarget = null;
    this._blurPlaceholderTex.dispose();
    this._blurStackMat?.dispose();
    this._blurStackMat = null;
    this._blurFinalMat?.dispose();
    this._blurFinalMat = null;
    this._blurQuadMesh.geometry.dispose();
    this._blurQuadInitMat.dispose();
    super.dispose();
  }
}

export type { GroupEffectsQuality } from "./GroupRaw.js";
