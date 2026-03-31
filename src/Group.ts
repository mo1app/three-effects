import {
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  Color,
  DataTexture,
  Scene,
} from "three/webgpu";
import { uniform } from "three/tsl";
import { GroupRaw, type RendererLike } from "./GroupRaw.js";
import { layerStyles } from "./layerStyles.js";
import {
  colorStopsFromSerialized,
  createGradientTexture,
  type SerializedGradientStop,
} from "./gradientTexture.js";

// ─── sigma defaults (match layerStyles / playground) ─────────────────────────

const DS_SIGMA = 12;
const IS_SIGMA = 8;
const IG_SIGMA = 8;
const OG_SIGMA = 8;
const RT_FALLBACK = 200;

const EFFECTS_MAT_CACHE_MAX = 8;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

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

/**
 * Reactive layer-style configuration for {@link Group}. Each block has an
 * `enabled` flag and parameters aligned with {@link layerStyles}.
 */
export type GroupEffects = {
  stroke: GroupEffectsStroke;
  dropShadow: GroupEffectsDropShadow;
  outerGlow: GroupEffectsOuterGlow;
  colorOverlay: GroupEffectsColorOverlay;
  gradientOverlay: GroupEffectsGradientOverlay;
  innerShadow: GroupEffectsInnerShadow;
  innerGlow: GroupEffectsInnerGlow;
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

  /**
   * LRU cache of compiled `effectsMaterial` variants (max {@link EFFECTS_MAT_CACHE_MAX}).
   *
   * **Invariants (read before changing dispose / gradient / cache logic):**
   * - Cache keys must **not** include values driven by live uniforms (`stroke.sizePx`, `effects.opacity.value`); update those uniforms instead.
   * - Each entry may own a `gradientTex` ref also held in {@link _gradientTexture}; never `dispose()` a `DataTexture` still referenced by any cache entry.
   * - Before replacing `_gradientTexture`, use {@link _gradientTextureReferencedInCache}; evicted entries {@link _cacheEffectsMaterial} dispose their own `gradientTex`.
   * - Eviction skips the material currently assigned to `effectsMaterial` so we never dispose the active program.
   */
  private readonly _effectsMaterialCache = new Map<string, CachedEffectsMaterial>();

  constructor() {
    super();
    this._effectsTarget = createDefaultEffects();
    this.effects = createDeepProxy(this._effectsTarget, (path) =>
      this._onEffectsPath(path),
    );
    this.effectsEnabled = true;
    this._syncEffectsMaterial();
  }

  /**
   * Mutates the internal effects state and rebuilds `effectsMaterial` once.
   * Prefer this over many assignments on {@link effects} when syncing from an
   * external store (avoids one graph rebuild per field).
   */
  applyEffects(fn: (effects: GroupEffects) => void): void {
    fn(this._effectsTarget);
    this._syncEffectsMaterial();
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
    this._syncEffectsMaterial();
  }

  /** Serialize enabled effect parameters for cache lookup (`stroke.sizePx` and `effects.opacity.value` excluded — live uniforms). */
  private _effectsMaterialCacheKey(e: GroupEffects, rtW: number): string {
    const w = rtW > 0 ? rtW : RT_FALLBACK;
    const r = round4;

    const hasStyleEffects =
      e.stroke.enabled ||
      e.dropShadow.enabled ||
      e.outerGlow.enabled ||
      e.colorOverlay.enabled ||
      e.gradientOverlay.enabled ||
      e.innerShadow.enabled ||
      e.innerGlow.enabled;
    const layerOpacityOn = e.opacity.enabled;

    if (!hasStyleEffects && !layerOpacityOn) {
      return JSON.stringify({ p: 1 });
    }
    if (!hasStyleEffects && layerOpacityOn) {
      return JSON.stringify({ lo: 1 });
    }

    const o: Record<string, unknown> = { rtW: w };
    if (e.dropShadow.enabled) {
      o.ds = {
        c: e.dropShadow.color.getHexString(),
        o: r(e.dropShadow.opacity),
        a: r(e.dropShadow.angle),
        d: r(e.dropShadow.distancePx),
        sp: r(e.dropShadow.spread),
        sz: r(e.dropShadow.sizePx),
      };
    }
    if (e.outerGlow.enabled) {
      o.og = {
        c: e.outerGlow.color.getHexString(),
        o: r(e.outerGlow.opacity),
        sp: r(e.outerGlow.spread),
        sz: r(e.outerGlow.sizePx),
      };
    }
    if (e.colorOverlay.enabled) {
      o.co = {
        c: e.colorOverlay.color.getHexString(),
        o: r(e.colorOverlay.opacity),
      };
    }
    if (e.gradientOverlay.enabled && e.gradientOverlay.stops.length > 0) {
      o.go = {
        style: e.gradientOverlay.style,
        o: r(e.gradientOverlay.opacity),
        angle: r(e.gradientOverlay.angle),
        scale: r(e.gradientOverlay.scale),
        reverse: e.gradientOverlay.reverse,
        stops: e.gradientOverlay.stops.map((s) => ({
          c: s.color,
          p: r(s.position),
        })),
      };
    }
    if (e.innerShadow.enabled) {
      o.ins = {
        c: e.innerShadow.color.getHexString(),
        o: r(e.innerShadow.opacity),
        a: r(e.innerShadow.angle),
        d: r(e.innerShadow.distancePx),
        ch: r(e.innerShadow.choke),
        sz: r(e.innerShadow.sizePx),
      };
    }
    if (e.innerGlow.enabled) {
      o.ig = {
        c: e.innerGlow.color.getHexString(),
        o: r(e.innerGlow.opacity),
        source: e.innerGlow.source,
        ch: r(e.innerGlow.choke),
        sz: r(e.innerGlow.sizePx),
      };
    }
    if (e.stroke.enabled) {
      o.st = {
        p: e.stroke.position,
        o: r(e.stroke.opacity),
        c: e.stroke.color.getHexString(),
      };
    }
    if (layerOpacityOn) {
      o.lo = 1;
    }
    return JSON.stringify(o);
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

  private _cacheEffectsMaterial(key: string, entry: CachedEffectsMaterial): void {
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

  /**
   * Rebuilds or reuses `effectsMaterial` from the LRU cache when the **effect signature** changes.
   *
   * **Layer opacity (`effects.opacity`):** `value` is **not** part of the cache key. It drives
   * `_layerOpacityUniform` so you can animate opacity every frame (or scrub a slider)
   * without recompiling the node graph — same pattern as `_strokeSizeUniform`.
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
    const any = hasStyleEffects || layerOpacityOn;

    const rtW = this.renderTargetWidth > 0 ? this.renderTargetWidth : RT_FALLBACK;
    const cacheKey = this._effectsMaterialCacheKey(e, rtW);
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
        this._layerOpacityUniform.value = Math.min(1, Math.max(0, e.opacity.value));
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

    let b = layerStyles(this);

    if (e.dropShadow.enabled) {
      b = b.dropShadow({
        color: e.dropShadow.color,
        opacity: e.dropShadow.opacity,
        angle: e.dropShadow.angle,
        distance: e.dropShadow.distancePx / rtW,
        spread: e.dropShadow.spread,
        blurRadius: e.dropShadow.sizePx / (2 + 2 * DS_SIGMA),
        sigma: DS_SIGMA,
      });
    }
    if (e.outerGlow.enabled) {
      b = b.outerGlow({
        color: e.outerGlow.color,
        opacity: e.outerGlow.opacity,
        spread: e.outerGlow.spread,
        blurRadius: e.outerGlow.sizePx / (2 + 2 * OG_SIGMA),
        sigma: OG_SIGMA,
      });
    }
    if (e.colorOverlay.enabled) {
      b = b.colorOverlay({
        color: e.colorOverlay.color,
        opacity: e.colorOverlay.opacity,
      });
    }
    if (e.gradientOverlay.enabled && e.gradientOverlay.stops.length > 0) {
      const prevTex = this._gradientTexture;
      if (prevTex && !this._gradientTextureReferencedInCache(prevTex)) {
        prevTex.dispose();
      }
      this._gradientTexture = createGradientTexture(
        colorStopsFromSerialized(e.gradientOverlay.stops),
      );
      b = b.gradientOverlay({
        texture: this._gradientTexture,
        opacity: e.gradientOverlay.opacity,
        style: e.gradientOverlay.style,
        angle: e.gradientOverlay.angle,
        scale: e.gradientOverlay.scale,
        reverse: e.gradientOverlay.reverse,
      });
    } else {
      const prevTex = this._gradientTexture;
      if (prevTex && !this._gradientTextureReferencedInCache(prevTex)) {
        prevTex.dispose();
      }
      this._gradientTexture = null;
    }
    if (e.innerShadow.enabled) {
      b = b.innerShadow({
        color: e.innerShadow.color,
        opacity: e.innerShadow.opacity,
        angle: e.innerShadow.angle,
        distance: e.innerShadow.distancePx / rtW,
        choke: e.innerShadow.choke,
        blurRadius: e.innerShadow.sizePx / (2 + 2 * IS_SIGMA),
        sigma: IS_SIGMA,
      });
    }
    if (e.innerGlow.enabled) {
      b = b.innerGlow({
        color: e.innerGlow.color,
        opacity: e.innerGlow.opacity,
        source: e.innerGlow.source,
        choke: e.innerGlow.choke,
        blurRadius: e.innerGlow.sizePx / (2 + 2 * IG_SIGMA),
        sigma: IG_SIGMA,
      });
    }
    if (e.stroke.enabled) {
      this._strokeSizeUniform.value = e.stroke.sizePx;
      b = b.stroke({
        color: e.stroke.color,
        opacity: e.stroke.opacity,
        position: e.stroke.position,
        size: this._strokeSizeUniform,
      });
    }
    if (layerOpacityOn) {
      this._layerOpacityUniform.value = Math.min(1, Math.max(0, e.opacity.value));
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
      else if (e.stroke.position === "center") marginPx += e.stroke.sizePx * 0.5;
    }
    if (e.dropShadow.enabled) {
      marginPx += e.dropShadow.distancePx + e.dropShadow.sizePx + 4;
    }
    if (e.outerGlow.enabled) {
      marginPx += e.outerGlow.sizePx + 4;
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
    super.dispose();
  }
}
