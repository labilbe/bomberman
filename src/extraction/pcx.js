/**
 * PCX decoder, for the arena backgrounds of the RES folder.
 *
 * Atomic Bomberman's ground is not a repeated tile: it is a painted 640 x 480
 * image, one per field (FIELD0 to FIELD10). That is what makes the original
 * game's grass never quite repeat, where a single copied tile shows at once.
 *
 * The format is simple and old: a 128-byte header, a byte-wise RLE, and for
 * 8-bit images a 256-colour palette stuck AT THE END of the file, preceded by a
 * 0x0C marker — not in the header, where all you find is the old sixteen-entry
 * EGA palette, of no use here.
 */

import { u16 } from './bytes.js';

/** Length of the PCX header, fixed. */
const HEADER = 128;

/**
 * Decodes an 8-bit PCX into opaque RGBA.
 *
 * We only handle the case present in the game — one plane, eight bits, RLE — and
 * refuse the rest loudly rather than return a wrong image.
 */
export function decodePcx(bytes) {
  if (bytes[0] !== 0x0a) throw new Error('ce fichier n est pas un PCX');
  if (bytes[3] !== 8 || bytes[65] !== 1) {
    throw new Error(`PCX non gere : ${bytes[3]} bits, ${bytes[65]} plans`);
  }

  const width = u16(bytes, 8) - u16(bytes, 4) + 1;
  const height = u16(bytes, 10) - u16(bytes, 6) + 1;
  // `bytesPerRow` can exceed the width: the format rounds up to an even number,
  // and the extra bytes are padding to be thrown away row by row.
  const bytesPerRow = u16(bytes, 66);

  // The palette takes the last 768 bytes, behind its marker.
  const paletteAt = bytes.length - 769;
  if (bytes[paletteAt] !== 0x0c) throw new Error('palette PCX introuvable');
  const palette = bytes.subarray(paletteAt + 1);

  const indexes = new Uint8Array(height * bytesPerRow);
  let p = HEADER;
  let output = 0;
  while (output < indexes.length && p < paletteAt) {
    const byte = bytes[p];
    p += 1;
    // Both top bits set announce a repetition; the length fits in the other six,
    // which caps runs at 63.
    if ((byte & 0xc0) === 0xc0) {
      const count = byte & 0x3f;
      const value = bytes[p];
      p += 1;
      indexes.fill(value, output, Math.min(indexes.length, output + count));
      output += count;
    } else {
      indexes[output] = byte;
      output += 1;
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = indexes[y * bytesPerRow + x] * 3;
      const d = (y * width + x) * 4;
      rgba[d] = palette[index];
      rgba[d + 1] = palette[index + 1];
      rgba[d + 2] = palette[index + 2];
      rgba[d + 3] = 255;
    }
  }

  return { width, height, rgba };
}
