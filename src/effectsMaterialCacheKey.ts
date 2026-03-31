import type { GroupEffects } from "./Group.js";

export const RT_FALLBACK = 200;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Stable JSON signature for {@link Group} `effectsMaterial` LRU cache.
 * Excludes live uniforms: `stroke.sizePx`, `effects.opacity.value`, `effects.blur.sizePx`.
 */
export function effectsMaterialCacheKey(e: GroupEffects, rtW: number): string {
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
  const blurOn = e.blur.enabled;

  if (!hasStyleEffects && !layerOpacityOn && !blurOn) {
    return JSON.stringify({ p: 1 });
  }
  if (!hasStyleEffects && layerOpacityOn && !blurOn) {
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
  if (blurOn) {
    o.blur = 1;
  }
  return JSON.stringify(o);
}
