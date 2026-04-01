import { describe, it, expect } from "vitest";
import {
  jfaOutsideStroke,
  jfaInsideStroke,
  jfaPassCount,
} from "./jfaStroke.js";

describe("jfaStroke", () => {
  it("exports stroke node factories", () => {
    expect(typeof jfaOutsideStroke).toBe("function");
    expect(typeof jfaInsideStroke).toBe("function");
  });

  it("jfaPassCount scales with texture size and quality cap", () => {
    expect(jfaPassCount(64, "high")).toBe(6);
    expect(jfaPassCount(64, "fast")).toBe(6);
    expect(jfaPassCount(1024, "high")).toBe(10);
    expect(jfaPassCount(1024, "fast")).toBe(8);
  });
});
