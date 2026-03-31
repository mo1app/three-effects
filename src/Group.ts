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
  private _gradientTexture: DataTexture | null = null;

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
    this._syncEffectsMaterial();
  }

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
    const opacityActive = e.opacity.enabled && e.opacity.value < 1;
    const any = hasStyleEffects || opacityActive;

    if (!any) {
      this._gradientTexture?.dispose();
      this._gradientTexture = null;
      const mat = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: true,
        side: 2,
      });
      mat.colorNode = this.mapNode as MeshBasicNodeMaterial["colorNode"];
      this.effectsMaterial = mat;
      prev?.dispose();
      return;
    }

    const mat = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: true,
      side: 2,
    });

    const rtW = this.renderTargetWidth > 0 ? this.renderTargetWidth : RT_FALLBACK;

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
      this._gradientTexture?.dispose();
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
      this._gradientTexture?.dispose();
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
    if (e.opacity.enabled && e.opacity.value < 1) {
      b = b.opacity({ value: e.opacity.value });
    }

    mat.colorNode = b.node as MeshBasicNodeMaterial["colorNode"];
    this.effectsMaterial = mat;
    prev?.dispose();
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
    this._gradientTexture?.dispose();
    this._gradientTexture = null;
    super.dispose();
  }
}
