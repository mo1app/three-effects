import { describe, it, expect } from "vitest";
import { Color } from "three/webgpu";
import { effectsMaterialCacheKey, RT_FALLBACK } from "./effectsMaterialCacheKey.js";
import type { GroupEffects } from "./Group.js";

/** Mirrors `createDefaultEffects` in Group.ts — used for stable cache-key fixtures. */
function baseEffects(): GroupEffects {
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

describe("effectsMaterialCacheKey", () => {
  it("returns the same string for identical state", () => {
    const e = baseEffects();
    expect(effectsMaterialCacheKey(e, 512)).toBe(effectsMaterialCacheKey(e, 512));
  });

  it("uses passthrough key when no styles and layer opacity off", () => {
    const e = baseEffects();
    e.opacity.enabled = false;
    expect(effectsMaterialCacheKey(e, 512)).toBe(JSON.stringify({ p: 1 }));
  });

  it("uses layer-opacity-only key when opacity on and no styles", () => {
    const e = baseEffects();
    e.opacity.enabled = true;
    e.opacity.value = 0.42;
    expect(effectsMaterialCacheKey(e, 512)).toBe(JSON.stringify({ lo: 1 }));
  });

  it("does not include layer opacity value (smooth animation via uniform)", () => {
    const a = baseEffects();
    a.opacity.enabled = true;
    a.opacity.value = 0.3;
    const b = baseEffects();
    b.opacity.enabled = true;
    b.opacity.value = 0.9;
    expect(effectsMaterialCacheKey(a, 512)).toBe(effectsMaterialCacheKey(b, 512));
  });

  it("does not include stroke sizePx (live uniform)", () => {
    const a = baseEffects();
    a.stroke.enabled = true;
    a.stroke.sizePx = 8;
    const b = baseEffects();
    b.stroke.enabled = true;
    b.stroke.sizePx = 24;
    expect(effectsMaterialCacheKey(a, 400)).toBe(effectsMaterialCacheKey(b, 400));
  });

  it("changes key when stroke effect opacity changes (not a live uniform)", () => {
    const a = baseEffects();
    a.stroke.enabled = true;
    a.stroke.opacity = 0.5;
    const b = baseEffects();
    b.stroke.enabled = true;
    b.stroke.opacity = 0.9;
    expect(effectsMaterialCacheKey(a, 400)).not.toBe(effectsMaterialCacheKey(b, 400));
  });

  it("changes key when rtW changes and drop shadow is enabled", () => {
    const e = baseEffects();
    e.dropShadow.enabled = true;
    expect(effectsMaterialCacheKey(e, 400)).not.toBe(effectsMaterialCacheKey(e, 800));
  });

  it("uses RT_FALLBACK when rtW is zero", () => {
    const e = baseEffects();
    e.dropShadow.enabled = true;
    const k0 = effectsMaterialCacheKey(e, 0);
    const kFallback = effectsMaterialCacheKey(e, RT_FALLBACK);
    expect(k0).toBe(kFallback);
  });

  it("does not include blur sizePx (live uniform)", () => {
    const a = baseEffects();
    a.blur.enabled = true;
    a.blur.sizePx = 4;
    const b = baseEffects();
    b.blur.enabled = true;
    b.blur.sizePx = 40;
    expect(effectsMaterialCacheKey(a, 400)).toBe(effectsMaterialCacheKey(b, 400));
  });

  it("changes key when blur is toggled on", () => {
    const off = baseEffects();
    const on = baseEffects();
    on.blur.enabled = true;
    expect(effectsMaterialCacheKey(off, 400)).not.toBe(effectsMaterialCacheKey(on, 400));
  });
});
