import { describe, it, expect } from "vitest";
import * as lib from "./index.js";

describe("package exports", () => {
  it("exports Group, GroupRaw, layerStyles, gradient helpers, jfa, cache key", () => {
    expect(lib.Group).toBeDefined();
    expect(lib.Group.defaultQuality).toBe("fast");
    expect(lib.GroupRaw).toBeDefined();
    expect(lib.GroupRaw.defaultQuality).toBe("fast");
    expect(lib.preRenderEffects).toBeDefined();
    expect(lib.layerStyles).toBeDefined();
    expect(lib.LayerStylesBuilder).toBeDefined();
    expect(lib.createGradientTexture).toBeDefined();
    expect(lib.colorStopsFromSerialized).toBeDefined();
    expect(lib.sampleSerializedGradient).toBeDefined();
    expect(lib.jfaOutsideStroke).toBeDefined();
    expect(lib.jfaInsideStroke).toBeDefined();
    expect(lib.jfaPassCount).toBeDefined();
    expect(lib.effectsMaterialCacheKey).toBeDefined();
    expect(lib.RT_FALLBACK).toBe(200);
  });
});
