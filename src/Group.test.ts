import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { Group } from "./Group.js";
import { GroupRaw } from "./GroupRaw.js";

describe("Group", () => {
  let g: Group;

  beforeEach(() => {
    g = new Group();
  });

  afterEach(() => {
    GroupRaw.defaultQuality = "fast";
  });

  it("exposes effects and effectsMaterial after construction", () => {
    expect(g.effects).toBeDefined();
    expect(g.effectsMaterial).not.toBeNull();
  });

  it("leaves effects.quality unset by default", () => {
    expect(g.effects.quality).toBeUndefined();
  });

  it("syncs Group.defaultQuality with GroupRaw.defaultQuality", () => {
    Group.defaultQuality = "high";
    expect(GroupRaw.defaultQuality).toBe("high");
    GroupRaw.defaultQuality = "fast";
    expect(Group.defaultQuality).toBe("fast");
  });

  it("builds stroke material when quality is unset (uses defaultQuality)", () => {
    GroupRaw.defaultQuality = "high";
    g.applyEffects((e) => {
      e.stroke.enabled = true;
      e.stroke.sizePx = 6;
    });
    g.commitEffects();
    expect(g.effects.quality).toBeUndefined();
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
