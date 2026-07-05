import { inflateSync } from "node:zlib";

/**
 * Minimal PNG decoder for Atlas Loop screenshots.
 *
 * Deliberately supports only what `simctl io screenshot` produces: 8-bit
 * RGB/RGBA, non-interlaced, single IHDR + IDAT stream. Anything else fails
 * with a descriptive error rather than decoding incorrectly.
 */
export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  pixels: Uint8Array;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePng(data: Buffer | Uint8Array): DecodedPng {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG file (bad signature)");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatParts: Buffer[] = [];
  let sawIhdr = false;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) {
      throw new Error(`truncated PNG chunk ${type}`);
    }

    if (type === "IHDR") {
      sawIhdr = true;
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      interlace = buffer[dataStart + 12];
    } else if (type === "IDAT") {
      idatParts.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  if (!sawIhdr) throw new Error("PNG has no IHDR chunk");
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}; atlas-map only decodes 8-bit screenshots`);
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`unsupported PNG color type ${colorType}; atlas-map only decodes RGB and RGBA screenshots`);
  }
  if (interlace !== 0) throw new Error("unsupported interlaced PNG; atlas-map only decodes non-interlaced screenshots");
  if (width <= 0 || height <= 0) throw new Error("PNG has an empty image area");
  if (idatParts.length === 0) throw new Error("PNG has no IDAT data");

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idatParts));
  const stride = width * channels;
  const expected = (stride + 1) * height;
  if (raw.length < expected) {
    throw new Error(`PNG pixel data is truncated (${raw.length} < ${expected} bytes)`);
  }

  const unfiltered = unfilterScanlines(raw, width, height, channels);
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0, source = 0; index < width * height; index += 1, source += channels) {
    pixels[index * 4] = unfiltered[source];
    pixels[index * 4 + 1] = unfiltered[source + 1];
    pixels[index * 4 + 2] = unfiltered[source + 2];
    pixels[index * 4 + 3] = channels === 4 ? unfiltered[source + 3] : 255;
  }

  return { width, height, pixels };
}

function unfilterScanlines(raw: Buffer, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const output = new Uint8Array(stride * height);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const lineStart = y * (stride + 1) + 1;
    const outStart = y * stride;

    for (let x = 0; x < stride; x += 1) {
      const value = raw[lineStart + x];
      const left = x >= channels ? output[outStart + x - channels] : 0;
      const up = y > 0 ? output[outStart - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? output[outStart - stride + x - channels] : 0;

      let reconstructed: number;
      switch (filter) {
        case 0:
          reconstructed = value;
          break;
        case 1:
          reconstructed = value + left;
          break;
        case 2:
          reconstructed = value + up;
          break;
        case 3:
          reconstructed = value + Math.floor((left + up) / 2);
          break;
        case 4:
          reconstructed = value + paethPredictor(left, up, upLeft);
          break;
        default:
          throw new Error(`unsupported PNG filter type ${filter}`);
      }
      output[outStart + x] = reconstructed & 0xff;
    }
  }

  return output;
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const initial = left + up - upLeft;
  const distanceLeft = Math.abs(initial - left);
  const distanceUp = Math.abs(initial - up);
  const distanceUpLeft = Math.abs(initial - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  if (distanceUp <= distanceUpLeft) return up;
  return upLeft;
}
