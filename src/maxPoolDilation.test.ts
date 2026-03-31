import { describe, it, expect } from "vitest";
import { maxPoolDilate, minPoolErode } from "./maxPoolDilation.js";

describe("maxPoolDilation", () => {
  it("exports morphology node factories", () => {
    expect(typeof maxPoolDilate).toBe("function");
    expect(typeof minPoolErode).toBe("function");
  });
});
