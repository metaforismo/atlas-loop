import { deflateSync } from "node:zlib";
import { decodePng, type DecodedPng } from "./png.ts";

export const DEFAULT_DIFF_THRESHOLD = 24;

export interface PixelDiffResult {
  changedCount: number;
  totalCount: number;
  /** 0..1 fraction of pixels whose max RGB channel delta exceeds the threshold. */
  changedRatio: number;
  /** RGBA mask: red highlight where changed, fully transparent elsewhere. */
  mask: Uint8Array;
  width: number;
  height: number;
}

/**
 * Per-pixel comparison of two decoded images. Alpha is ignored (screenshots
 * are opaque); size mismatches are padded top-left with opaque black so the
 * excess region counts as changed.
 */
export function diffDecodedPngs(a: DecodedPng, b: DecodedPng, threshold = DEFAULT_DIFF_THRESHOLD): PixelDiffResult {
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error("diff threshold must be a non-negative number");
  }

  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const left = padDecoded(a, width, height);
  const right = padDecoded(b, width, height);

  const totalCount = width * height;
  const mask = new Uint8Array(totalCount * 4);
  let changedCount = 0;

  for (let index = 0; index < mask.length; index += 4) {
    const delta = Math.max(
      Math.abs(left[index] - right[index]),
      Math.abs(left[index + 1] - right[index + 1]),
      Math.abs(left[index + 2] - right[index + 2])
    );
    if (delta > threshold) {
      changedCount += 1;
      mask[index] = 255;
      mask[index + 1] = 64;
      mask[index + 2] = 64;
      mask[index + 3] = 200;
    }
  }

  return {
    changedCount,
    totalCount,
    changedRatio: totalCount === 0 ? 0 : changedCount / totalCount,
    mask,
    width,
    height
  };
}

export function diffPngs(a: Buffer | Uint8Array, b: Buffer | Uint8Array, threshold = DEFAULT_DIFF_THRESHOLD): PixelDiffResult {
  return diffDecodedPngs(decodePng(a), decodePng(b), threshold);
}

function padDecoded(image: DecodedPng, targetWidth: number, targetHeight: number): Uint8Array {
  if (image.width === targetWidth && image.height === targetHeight) return image.pixels;

  const padded = new Uint8Array(targetWidth * targetHeight * 4);
  for (let index = 3; index < padded.length; index += 4) {
    padded[index] = 255;
  }
  for (let y = 0; y < image.height; y += 1) {
    padded.set(image.pixels.subarray(y * image.width * 4, (y + 1) * image.width * 4), y * targetWidth * 4);
  }
  return padded;
}

/** Minimal RGBA PNG encoder (8-bit, non-interlaced, filter 0) for diff masks. */
export function encodePng(pixels: Uint8Array, width: number, height: number): Buffer {
  if (pixels.length !== width * height * 4) {
    throw new Error(`pixel buffer must be ${width * height * 4} bytes for ${width}x${height} RGBA`);
  }

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "latin1");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
