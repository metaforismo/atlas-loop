import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodePng, diffPngs, encodePng } from "./index.ts";

const FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "tests", "fixtures", "atlas", "png");

async function fixture(name: string): Promise<Buffer> {
  return readFile(resolve(FIXTURES, name));
}

describe("diffPngs", () => {
  it("reports zero changes for identical files", async () => {
    const a = await fixture("screen-a.png");
    const result = diffPngs(a, a);

    expect(result.changedCount).toBe(0);
    expect(result.changedRatio).toBe(0);
    expect(result.width).toBe(60);
    expect(result.height).toBe(120);
  });

  it("scores variants low and different screens high", async () => {
    const base = await fixture("screen-a.png");
    const variant = diffPngs(base, await fixture("screen-a-variant.png"));
    const different = diffPngs(base, await fixture("screen-b.png"));

    expect(variant.changedRatio).toBeGreaterThan(0);
    expect(variant.changedRatio).toBeLessThan(0.05);
    expect(different.changedRatio).toBeGreaterThan(0.3);
    expect(different.changedRatio).toBeGreaterThan(variant.changedRatio);
  });

  it("pads size mismatches so the excess region counts as changed", async () => {
    // screen-b is RGB 60x120; build a smaller synthetic by decoding and re-encoding a crop.
    const decoded = decodePng(await fixture("screen-a.png"));
    const cropWidth = 30;
    const cropHeight = 60;
    const crop = new Uint8Array(cropWidth * cropHeight * 4);
    for (let y = 0; y < cropHeight; y += 1) {
      crop.set(decoded.pixels.subarray(y * decoded.width * 4, y * decoded.width * 4 + cropWidth * 4), y * cropWidth * 4);
    }
    const cropped = encodePng(crop, cropWidth, cropHeight);

    const result = diffPngs(await fixture("screen-a.png"), cropped);

    expect(result.width).toBe(60);
    expect(result.height).toBe(120);
    // At minimum everything outside the crop differs from the gradient.
    expect(result.changedRatio).toBeGreaterThan(0.4);
  });

  it("rejects invalid thresholds", async () => {
    const a = await fixture("screen-a.png");
    expect(() => diffPngs(a, a, -1)).toThrow(/non-negative/);
  });
});

describe("encodePng", () => {
  it("round-trips through the decoder", () => {
    const width = 5;
    const height = 3;
    const pixels = new Uint8Array(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      pixels[index * 4] = index * 10;
      pixels[index * 4 + 1] = 255 - index * 10;
      pixels[index * 4 + 2] = 128;
      pixels[index * 4 + 3] = 255;
    }

    const decoded = decodePng(encodePng(pixels, width, height));

    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(pixels));
  });

  it("rejects mismatched buffer sizes", () => {
    expect(() => encodePng(new Uint8Array(10), 5, 3)).toThrow(/must be 60 bytes/);
  });
});
