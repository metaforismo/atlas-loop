import { describe, expect, it } from "vitest";
import { diffPixels, padPixels } from "../../apps/viewer/src/imageDiff.js";

function rgbaImage(width: number, height: number, fill: [number, number, number, number]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels.set(fill, index);
  }
  return pixels;
}

describe("diffPixels", () => {
  it("reports zero changes for identical buffers", () => {
    const a = rgbaImage(4, 4, [10, 20, 30, 255]);
    const result = diffPixels(a, rgbaImage(4, 4, [10, 20, 30, 255]), 4, 4);

    expect(result.changedCount).toBe(0);
    expect(result.changedRatio).toBe(0);
    expect(result.mask.every((byte) => byte === 0)).toBe(true);
  });

  it("flags exactly the changed pixels with a red mask", () => {
    const a = rgbaImage(4, 4, [10, 20, 30, 255]);
    const b = rgbaImage(4, 4, [10, 20, 30, 255]);
    // Change pixel (2, 1) far beyond the threshold.
    const offset = (1 * 4 + 2) * 4;
    b[offset] = 250;

    const result = diffPixels(a, b, 4, 4);

    expect(result.changedCount).toBe(1);
    expect(result.changedRatio).toBeCloseTo(1 / 16, 6);
    expect([result.mask[offset], result.mask[offset + 1], result.mask[offset + 2], result.mask[offset + 3]]).toEqual([255, 64, 64, 200]);
    // Neighboring pixel untouched.
    expect(result.mask[offset + 4]).toBe(0);
  });

  it("treats the threshold as exclusive and ignores alpha-only differences", () => {
    const a = rgbaImage(2, 1, [100, 100, 100, 255]);
    const atThreshold = rgbaImage(2, 1, [124, 100, 100, 255]);
    const beyondThreshold = rgbaImage(2, 1, [125, 100, 100, 255]);
    const alphaOnly = rgbaImage(2, 1, [100, 100, 100, 10]);

    expect(diffPixels(a, atThreshold, 2, 1, 24).changedCount).toBe(0);
    expect(diffPixels(a, beyondThreshold, 2, 1, 24).changedCount).toBe(2);
    expect(diffPixels(a, alphaOnly, 2, 1, 24).changedCount).toBe(0);
  });

  it("rejects mismatched buffer sizes and invalid thresholds", () => {
    const a = rgbaImage(2, 2, [0, 0, 0, 255]);
    expect(() => diffPixels(a, rgbaImage(2, 1, [0, 0, 0, 255]), 2, 2)).toThrow(/must be 16 bytes/);
    expect(() => diffPixels(a, rgbaImage(2, 2, [0, 0, 0, 255]), 2, 2, -1)).toThrow(/non-negative/);
  });
});

describe("padPixels", () => {
  it("anchors the source top-left and fills the rest with opaque black", () => {
    const source = rgbaImage(1, 1, [9, 8, 7, 255]);
    const padded = padPixels(source, 1, 1, 2, 2);

    expect(padded).toHaveLength(2 * 2 * 4);
    expect([padded[0], padded[1], padded[2], padded[3]]).toEqual([9, 8, 7, 255]);
    // Padding pixels are black but opaque so diffs against real content register.
    expect([padded[4], padded[5], padded[6], padded[7]]).toEqual([0, 0, 0, 255]);
  });

  it("returns the source untouched for equal dimensions and rejects shrinking", () => {
    const source = rgbaImage(2, 2, [1, 2, 3, 255]);
    expect(padPixels(source, 2, 2, 2, 2)).toBe(source);
    expect(() => padPixels(source, 2, 2, 1, 2)).toThrow(/at least the source/);
  });
});
