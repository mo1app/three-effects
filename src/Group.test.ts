import { describe, it, expect, beforeEach } from "vitest";
import { Group } from "./Group.js";

describe("Group", () => {
  let g: Group;

  beforeEach(() => {
    g = new Group();
  });

  it("exposes effects and effectsMaterial after construction", () => {
    expect(g.effects).toBeDefined();
    expect(g.effectsMaterial).not.toBeNull();
  });

  it("applyEffects updates stroke and keeps a material", () => {
    g.applyEffects((e) => {
      e.stroke.enabled = true;
      e.stroke.sizePx = 14;
      e.stroke.position = "outside";
      e.stroke.color.set(0x00ff00);
    });
    expect(g.effects.stroke.sizePx).toBe(14);
    expect(g.effectsMaterial).not.toBeNull();
  });

  it("applyEffects toggles gradient overlay on then off", () => {
    g.applyEffects((e) => {
      e.gradientOverlay.enabled = true;
      e.gradientOverlay.stops = [
        { color: "#ff0000", position: 0 },
        { color: "#00ff00", position: 1 },
      ];
    });
    g.applyEffects((e) => {
      e.gradientOverlay.enabled = false;
    });
    expect(g.effectsMaterial).not.toBeNull();
  });

  it("commitEffects applies deferred applyEffects before the next preRenderEffects", () => {
    g.applyEffects((e) => {
      e.stroke.enabled = true;
      e.stroke.sizePx = 20;
    });
    g.commitEffects();
    expect(g.effects.stroke.sizePx).toBe(20);
    expect(g.effectsMaterial).not.toBeNull();
  });

  it("applyEffects enables blur and builds blur final material", () => {
    g.applyEffects((e) => {
      e.blur.enabled = true;
      e.blur.sizePx = 12;
    });
    g.commitEffects();
    expect(g.effects.blur.sizePx).toBe(12);
    expect(g.effectsMaterial).not.toBeNull();
  });

  it("toggles blur off after on and keeps a material", () => {
    g.applyEffects((e) => {
      e.blur.enabled = true;
      e.blur.sizePx = 6;
    });
    g.commitEffects();
    g.applyEffects((e) => {
      e.blur.enabled = false;
    });
    g.commitEffects();
    expect(g.effectsMaterial).not.toBeNull();
  });

  it("dispose runs without throwing", () => {
    expect(() => g.dispose()).not.toThrow();
  });
});
