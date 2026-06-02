import { describe, expect, it } from "vitest";
import { compileRange } from "./range.js";

describe("compileRange", () => {
  it("expands a single pair", () => {
    expect(compileRange("AA")).toEqual({ AA: 1 });
  });

  it("expands pair-plus", () => {
    expect(Object.keys(compileRange("QQ+")).sort()).toEqual(["AA", "KK", "QQ"]);
  });

  it("expands suited-plus with a fixed high card", () => {
    expect(Object.keys(compileRange("ATs+")).sort()).toEqual(["AJs", "AKs", "AQs", "ATs"].sort());
  });

  it("expands offsuit-plus", () => {
    expect(Object.keys(compileRange("KJo+")).sort()).toEqual(["KJo", "KQo"].sort());
  });

  it("expands a bare token to both suited and offsuit", () => {
    expect(Object.keys(compileRange("AK")).sort()).toEqual(["AKo", "AKs"]);
  });

  it("expands a pair span", () => {
    expect(Object.keys(compileRange("99-66")).sort()).toEqual(["66", "77", "88", "99"]);
  });

  it("expands a constant-gap suited span", () => {
    expect(Object.keys(compileRange("T9s-76s")).sort()).toEqual(
      ["76s", "87s", "98s", "T9s"].sort(),
    );
  });

  it("applies a frequency suffix", () => {
    expect(compileRange("76s:0.5")).toEqual({ "76s": 0.5 });
  });

  it("lets later tokens override earlier ones", () => {
    expect(compileRange("ATo+, AJo:0.5")).toEqual({ ATo: 1, AJo: 0.5, AQo: 1, AKo: 1 });
  });

  it("merges a comma list", () => {
    const r = compileRange("AA, KK, AKs");
    expect(r).toEqual({ AA: 1, KK: 1, AKs: 1 });
  });
});
