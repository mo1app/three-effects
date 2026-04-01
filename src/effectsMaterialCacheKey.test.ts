import { afterEach, describe, it, expect } from "vitest";
import { Color } from "three/webgpu";
import {
  effectsMaterialCacheKey,
  RT_FALLBACK,
} from "./effectsMaterialCacheKey.js";
import type { GroupEffects } from "./Group.js";
import { GroupRaw } from "./GroupRaw.js";

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
  afterEach(() => {
    GroupRaw.defaultQuality = "fast";
  });

  it("returns the same string for identical state", () => {
    const e = baseEffects();
    expect(effectsMaterialCacheKey(e, 512)).toBe(
      effectsMaterialCacheKey(e, 512),
    );
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
    expect(effectsMaterialCacheKey(a, 512)).toBe(
      effectsMaterialCacheKey(b, 512),
    );
  });

  it("does not include stroke sizePx (live uniform)", () => {
    const a = baseEffects();
    a.stroke.enabled = true;
    a.stroke.sizePx = 8;
    const b = baseEffects();
    b.stroke.enabled = true;
    b.stroke.sizePx = 24;
    expect(effectsMaterialCacheKey(a, 400)).toBe(
      effectsMaterialCacheKey(b, 400),
    );
  });

  it("changes key when stroke effect opacity changes (not a live uniform)", () => {
    const a = baseEffects();
    a.stroke.enabled = true;
    a.stroke.opacity = 0.5;
    const b = baseEffects();
    b.stroke.enabled = true;
    b.stroke.opacity = 0.9;
    expect(effectsMaterialCacheKey(a, 400)).not.toBe(
      effectsMaterialCacheKey(b, 400),
    );
  });

  it("changes key when rtW changes and drop shadow is enabled", () => {
    const e = baseEffects();
    e.dropShadow.enabled = true;
    expect(effectsMaterialCacheKey(e, 400)).not.toBe(
      effectsMaterialCacheKey(e, 800),
    );
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
    expect(effectsMaterialCacheKey(a, 400)).toBe(
      effectsMaterialCacheKey(b, 400),
    );
  });

  it("changes key when blur is toggled on", () => {
    const off = baseEffects();
    const on = baseEffects();
    on.blur.enabled = true;
    expect(effectsMaterialCacheKey(off, 400)).not.toBe(
      effectsMaterialCacheKey(on, 400),
    );
  });

  it("changes key when quality changes with drop shadow on", () => {
    const fast = baseEffects();
    fast.dropShadow.enabled = true;
    const high = baseEffects();
    high.dropShadow.enabled = true;
    high.quality = "high";
    expect(effectsMaterialCacheKey(fast, 400)).not.toBe(
      effectsMaterialCacheKey(high, 400),
    );
  });

  it("changes key when quality changes with layer blur on", () => {
    const fast = baseEffects();
    fast.blur.enabled = true;
    const high = baseEffects();
    high.blur.enabled = true;
    high.quality = "high";
    expect(effectsMaterialCacheKey(fast, 400)).not.toBe(
      effectsMaterialCacheKey(high, 400),
    );
  });

  it("changes key when quality changes with stroke on", () => {
    const fast = baseEffects();
    fast.stroke.enabled = true;
    const high = baseEffects();
    high.stroke.enabled = true;
    high.quality = "high";
    expect(effectsMaterialCacheKey(fast, 400)).not.toBe(
      effectsMaterialCacheKey(high, 400),
    );
  });

  it("changes key when quality changes with only outer glow on", () => {
    const fast = baseEffects();
    fast.outerGlow.enabled = true;
    const high = baseEffects();
    high.outerGlow.enabled = true;
    high.quality = "high";
    expect(effectsMaterialCacheKey(fast, 400)).not.toBe(
      effectsMaterialCacheKey(high, 400),
    );
  });

  it("changes key when quality changes with only inner shadow on", () => {
    const fast = baseEffects();
    fast.innerShadow.enabled = true;
    const high = baseEffects();
    high.innerShadow.enabled = true;
    high.quality = "high";
    expect(effectsMaterialCacheKey(fast, 400)).not.toBe(
      effectsMaterialCacheKey(high, 400),
    );
  });

  it("changes key when quality changes with only inner glow on", () => {
    const fast = baseEffects();
    fast.innerGlow.enabled = true;
    const high = baseEffects();
    high.innerGlow.enabled = true;
    high.quality = "high";
    expect(effectsMaterialCacheKey(fast, 400)).not.toBe(
      effectsMaterialCacheKey(high, 400),
    );
  });

  it("uses GroupRaw.defaultQuality when effects.quality is omitted", () => {
    const unset = baseEffects();
    unset.stroke.enabled = true;
    const explicitFast = baseEffects();
    explicitFast.stroke.enabled = true;
    explicitFast.quality = "fast";
    expect(effectsMaterialCacheKey(unset, 400)).toBe(
      effectsMaterialCacheKey(explicitFast, 400),
    );

    GroupRaw.defaultQuality = "high";
    const unsetHigh = baseEffects();
    unsetHigh.stroke.enabled = true;
    const explicitHigh = baseEffects();
    explicitHigh.stroke.enabled = true;
    explicitHigh.quality = "high";
    expect(effectsMaterialCacheKey(unsetHigh, 400)).toBe(
      effectsMaterialCacheKey(explicitHigh, 400),
    );
  });
});
