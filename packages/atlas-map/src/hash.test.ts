import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodePng, dhashFromPng, hammingDistance } from "./index.ts";

const FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "tests", "fixtures", "atlas", "png");

async function fixture(name: string): Promise<Buffer> {
  return readFile(resolve(FIXTURES, name));
}

describe("png decoding", () => {
  it("decodes 8-bit RGBA and RGB fixtures into RGBA pixels", async () => {
    const rgba = decodePng(await fixture("screen-a.png"));
    expect(rgba).toMatchObject({ width: 60, height: 120 });
    expect(rgba.pixels).toHaveLength(60 * 120 * 4);
    // Header bar pixel (blue-ish) and body pixel (gray gradient).
    expect([rgba.pixels[0], rgba.pixels[1], rgba.pixels[2], rgba.pixels[3]]).toEqual([30, 60, 200, 255]);

    const rgb = decodePng(await fixture("screen-b.png"));
    expect(rgb).toMatchObject({ width: 60, height: 120 });
    // RGB input is expanded to opaque RGBA.
    expect(rgb.pixels[3]).toBe(255);
  });

  it("rejects unsupported formats with descriptive errors", async () => {
    await expect(fixture("unsupported-16bit.png").then(decodePng)).rejects.toThrow(/unsupported PNG bit depth 16/);
    expect(() => decodePng(Buffer.from("definitely not a png"))).toThrow(/bad signature/);
  });
});

describe("dhash clustering behavior", () => {
  it("hashes identical images to distance zero", async () => {
    const first = dhashFromPng(await fixture("screen-a.png"));
    const second = dhashFromPng(await fixture("screen-a.png"));
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingDistance(first, second)).toBe(0);
  });

  it("keeps same-screen variants within the clustering threshold", async () => {
    const base = dhashFromPng(await fixture("screen-a.png"));
    const variant = dhashFromPng(await fixture("screen-a-variant.png"));
    expect(hammingDistance(base, variant)).toBeLessThanOrEqual(10);
  });

  it("separates structurally different screens beyond the threshold", async () => {
    const screenA = dhashFromPng(await fixture("screen-a.png"));
    const screenB = dhashFromPng(await fixture("screen-b.png"));
    expect(hammingDistance(screenA, screenB)).toBeGreaterThan(10);
  });

  it("validates hash inputs for distance computation", () => {
    expect(() => hammingDistance("short", "0000000000000000")).toThrow(/16-character hex/);
  });
});
