import { describe, it, expect } from "vitest";
import { Color } from "three/webgpu";
import { Group } from "./Group.js";
import { layerStyles } from "./layerStyles.js";
import { createGradientTexture, colorStopsFromSerialized } from "./gradientTexture.js";

describe("layerStyles", () => {
  it("builds a vec4 node for passthrough map (opacity only)", () => {
    const g = new Group();
    g.applyEffects((e) => {
      e.opacity.enabled = true;
      e.opacity.value = 0.5;
    });
    const node = layerStyles(g).opacity({ value: 0.5 }).node;
    expect(node).toBeDefined();
    expect(typeof node).toBe("object");
  });

  it("chains drop shadow + stroke only when enabled in builder", () => {
    const g = new Group();
    const b = layerStyles(g)
      .dropShadow({
        color: new Color(0x000000),
        opacity: 0.5,
        angle: 0,
        distance: 0.01,
        spread: 0,
        blurRadius: 1,
        kawasePasses: 4,
      })
      .stroke({
        color: new Color(0x111111),
        opacity: 1,
        position: "outside",
        size: 4,
      });
    const node = b.node;
    expect(node).toBeDefined();
  });

  it("supports gradient overlay with texture", () => {
    const g = new Group();
    const tex = createGradientTexture(
      colorStopsFromSerialized([
        { color: "#000000", position: 0 },
        { color: "#ffffff", position: 1 },
      ]),
      4,
    );
    try {
      const node = layerStyles(g)
        .gradientOverlay({
          texture: tex,
          opacity: 1,
          style: "linear",
          angle: 0,
          scale: 1,
          reverse: false,
        })
        .node;
      expect(node).toBeDefined();
    } finally {
      tex.dispose();
    }
  });

  it("accepts OpacityOptions with number or uniform-like value", () => {
    const g = new Group();
    const b = layerStyles(g).opacity({ value: 0.25 });
    expect(b.node).toBeDefined();
  });

  it("chains blur on source then opacity without throwing", () => {
    const g = new Group();
    const node = layerStyles(g)
      .blur({ radius: 2, sigma: 8 })
      .opacity({ value: 0.8 })
      .node;
    expect(node).toBeDefined();
    expect(typeof node).toBe("object");
  });

  it("chains full style stack without throwing", () => {
    const g = new Group();
    const tex = createGradientTexture(
      colorStopsFromSerialized([
        { color: "#ff0000", position: 0 },
        { color: "#0000ff", position: 1 },
      ]),
      8,
    );
    try {
      const node = layerStyles(g)
        .dropShadow({
          color: new Color(0),
          opacity: 0.2,
          angle: 90,
          distance: 0.02,
          spread: 0,
          blurRadius: 2,
          kawasePasses: 4,
        })
        .outerGlow({
          color: new Color(0xffff00),
          opacity: 0.3,
          spread: 0,
          blurRadius: 2,
          kawasePasses: 4,
        })
        .colorOverlay({ color: new Color(0xff0000), opacity: 0.2 })
        .gradientOverlay({
          texture: tex,
          opacity: 0.5,
          style: "linear",
          angle: 0,
          scale: 1,
          reverse: false,
        })
        .innerShadow({
          color: new Color(0),
          opacity: 0.2,
          angle: 0,
          distance: 0.01,
          choke: 0,
          blurRadius: 1,
          kawasePasses: 4,
        })
        .innerGlow({
          color: new Color(0xffffff),
          opacity: 0.2,
          source: "edge",
          choke: 0,
          blurRadius: 2,
          kawasePasses: 4,
        })
        .stroke({
          color: new Color(0),
          opacity: 1,
          position: "outside",
          size: 2,
        })
        .opacity({ value: 0.9 })
        .node;
      expect(node).toBeDefined();
    } finally {
      tex.dispose();
    }
  });
});
