import { describe, it, expect } from "vitest";
import { jfaOutsideStroke, jfaInsideStroke } from "./jfaStroke.js";

describe("jfaStroke", () => {
  it("exports stroke node factories", () => {
    expect(typeof jfaOutsideStroke).toBe("function");
    expect(typeof jfaInsideStroke).toBe("function");
  });
});
