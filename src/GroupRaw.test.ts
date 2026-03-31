import { describe, it, expect } from "vitest";
import { GroupRaw, preRenderEffects } from "./GroupRaw.js";

describe("GroupRaw", () => {
  it("constructs and exposes mapNode", () => {
    const g = new GroupRaw();
    expect(g.mapNode).toBeDefined();
    g.dispose();
  });

  it("exports preRenderEffects as a function", () => {
    expect(typeof preRenderEffects).toBe("function");
  });
});
