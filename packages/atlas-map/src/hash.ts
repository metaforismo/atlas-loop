import { decodePng, type DecodedPng } from "./png.ts";

/**
 * 64-bit difference hash (dHash) over a 9x8 grayscale downscale: each bit is
 * the horizontal gradient direction between neighboring cells. Structurally
 * similar screens land within a small Hamming distance of each other.
 */
export const DHASH_HEX_LENGTH = 16;

export function dhashFromPng(data: Buffer | Uint8Array): string {
  return dhashFromDecoded(decodePng(data));
}

export function dhashFromDecoded(image: DecodedPng): string {
  const gray = downscaleGrayscale(image, 9, 8);
  let bits = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      bits <<= 1n;
      if (gray[y * 9 + x] > gray[y * 9 + x + 1]) bits |= 1n;
    }
  }
  return bits.toString(16).padStart(DHASH_HEX_LENGTH, "0");
}

export function hammingDistance(leftHex: string, rightHex: string): number {
  const left = parseHashHex(leftHex, "left");
  const right = parseHashHex(rightHex, "right");
  let xor = left ^ right;
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}

function parseHashHex(value: string, label: string): bigint {
  if (!/^[0-9a-f]{16}$/i.test(value)) {
    throw new Error(`${label} hash must be a 16-character hex dHash, got: ${value}`);
  }
  return BigInt(`0x${value}`);
}

/** Box-average downscale to grid cells; alpha is ignored (screenshots are opaque). */
function downscaleGrayscale(image: DecodedPng, targetWidth: number, targetHeight: number): Float64Array {
  const grid = new Float64Array(targetWidth * targetHeight);

  for (let cellY = 0; cellY < targetHeight; cellY += 1) {
    const startY = Math.floor((cellY * image.height) / targetHeight);
    const endY = Math.max(startY + 1, Math.floor(((cellY + 1) * image.height) / targetHeight));
    for (let cellX = 0; cellX < targetWidth; cellX += 1) {
      const startX = Math.floor((cellX * image.width) / targetWidth);
      const endX = Math.max(startX + 1, Math.floor(((cellX + 1) * image.width) / targetWidth));

      let sum = 0;
      let count = 0;
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const offset = (y * image.width + x) * 4;
          sum +=
            0.299 * image.pixels[offset] +
            0.587 * image.pixels[offset + 1] +
            0.114 * image.pixels[offset + 2];
          count += 1;
        }
      }
      grid[cellY * targetWidth + cellX] = count > 0 ? sum / count : 0;
    }
  }

  return grid;
}
