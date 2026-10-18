import { describe, expect, it } from "vitest";
import { pyRound } from "./pyround";

describe("pyRound matches Python's round()", () => {
  it.each([
    [0.03125, 4, 0.0312], // exact tie → even
    [0.04375, 4, 0.0437], // not an exact tie in binary: rounds by value
    [2.5, 0, 2],
    [3.5, 0, 4],
    [-2.5, 0, -2],
    [0.123456, 4, 0.1235],
    [1, 4, 1],
  ])("round(%f, %i) = %f", (x, d, want) => {
    expect(pyRound(x, d)).toBe(want);
  });
});
