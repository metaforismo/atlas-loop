export interface PixelDiffResult {
  changedCount: number;
  totalCount: number;
  /** 0..1 fraction of pixels whose max RGB channel delta exceeds the threshold. */
  changedRatio: number;
  /** RGBA mask: red highlight where changed, fully transparent elsewhere. */
  mask: Uint8ClampedArray;
}

export const DEFAULT_DIFF_THRESHOLD = 24;

/**
 * Per-pixel comparison of two same-sized RGBA buffers. Alpha is ignored:
 * simulator screenshots are opaque and encoder alpha wobble is noise.
 */
export function diffPixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = DEFAULT_DIFF_THRESHOLD
): PixelDiffResult {
  const expected = width * height * 4;
  if (a.length !== expected || b.length !== expected) {
    throw new Error(`pixel buffers must be ${expected} bytes for ${width}x${height} RGBA, got ${a.length} and ${b.length}`);
  }
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error("diff threshold must be a non-negative number");
  }

  const totalCount = width * height;
  const mask = new Uint8ClampedArray(expected);
  let changedCount = 0;

  for (let index = 0; index < expected; index += 4) {
    const delta = Math.max(
      Math.abs(a[index] - b[index]),
      Math.abs(a[index + 1] - b[index + 1]),
      Math.abs(a[index + 2] - b[index + 2])
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
    mask
  };
}

/** Expands an RGBA buffer onto a larger canvas size (top-left anchored, black fill). */
export function padPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number
): Uint8ClampedArray {
  if (width === targetWidth && height === targetHeight) return pixels;
  if (targetWidth < width || targetHeight < height) {
    throw new Error("target dimensions must be at least the source dimensions");
  }

  const padded = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let index = 3; index < padded.length; index += 4) {
    padded[index] = 255;
  }
  for (let y = 0; y < height; y += 1) {
    padded.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * targetWidth * 4);
  }
  return padded;
}
