import { describe, it, expect } from "vitest";
import { Color } from "three/webgpu";
import {
  colorStopsFromSerialized,
  createGradientTexture,
  sampleSerializedGradient,
  type SerializedGradientStop,
} from "./gradientTexture.js";

describe("colorStopsFromSerialized", () => {
  it("maps hex strings to Color and preserves positions", () => {
    const stops: SerializedGradientStop[] = [
      { color: "#ff0000", position: 0 },
      { color: "#0000ff", position: 1 },
    ];
    const out = colorStopsFromSerialized(stops);
    expect(out).toHaveLength(2);
    expect(out[0]!.position).toBe(0);
    expect(out[1]!.position).toBe(1);
    expect(out[0]!.color.getHexString()).toBe("ff0000");
    expect(out[1]!.color.getHexString()).toBe("0000ff");
  });
});

describe("sampleSerializedGradient", () => {
  it("returns black when no stops", () => {
    expect(sampleSerializedGradient([], 0.5)).toBe("#000000");
  });

  it("returns endpoints outside the span", () => {
    const stops: SerializedGradientStop[] = [
      { color: "#ff0000", position: 0.25 },
      { color: "#00ff00", position: 0.75 },
    ];
    expect(sampleSerializedGradient(stops, 0)).toMatch(/^#ff0000$/i);
    expect(sampleSerializedGradient(stops, 1)).toMatch(/^#00ff00$/i);
  });

  it("interpolates between two stops", () => {
    const stops: SerializedGradientStop[] = [
      { color: "#000000", position: 0 },
      { color: "#ffffff", position: 1 },
    ];
    const mid = sampleSerializedGradient(stops, 0.5);
    expect(mid).toMatch(/^#[0-9a-f]{6}$/i);
    expect(mid).not.toBe("#000000");
    expect(mid).not.toBe("#ffffff");
  });

  it("sorts unsorted stops before sampling", () => {
    const stops: SerializedGradientStop[] = [
      { color: "#ff0000", position: 1 },
      { color: "#0000ff", position: 0 },
    ];
    expect(sampleSerializedGradient(stops, 0)).toMatch(/^#0000ff$/i);
    expect(sampleSerializedGradient(stops, 1)).toMatch(/^#ff0000$/i);
  });
});

describe("createGradientTexture", () => {
  it("throws when no stops", () => {
    expect(() => createGradientTexture([])).toThrow(/at least one color stop/);
  });

  it("creates a 1×N DataTexture with RGBA data", () => {
    const stops = colorStopsFromSerialized([
      { color: "#ff0000", position: 0 },
      { color: "#0000ff", position: 1 },
    ]);
    const tex = createGradientTexture(stops, 4);
    expect(tex.image.width).toBe(4);
    expect(tex.image.height).toBe(1);
    const data = tex.image.data as Uint8Array;
    expect(data.length).toBe(4 * 4);
    expect(data[3]).toBe(255);
    expect(data[0]).toBeGreaterThan(200);
    tex.dispose();
  });

  it("uses width 256 by default", () => {
    const stops = colorStopsFromSerialized([{ color: "#ffffff", position: 0 }]);
    const tex = createGradientTexture(stops);
    expect(tex.image.width).toBe(256);
    tex.dispose();
  });
});
