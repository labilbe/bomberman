/**
 * Decoder for CIMG chunks: the images of an .ANI file.
 *
 * Two families coexist in the game's data, told apart by the header's `extra`
 * field:
 *
 *   extra = 24    16-bit image, one RGB565 word per pixel (2254 of 2327 images)
 *   extra = 1056  8-bit image, with its own 256-entry palette embedded
 *
 * Both share the same compression, described on `expand`.
 *
 * The background is not an alpha channel but a key colour stored in the header —
 * the 1997 game wrote 16 bits with no transparency. We turn it into alpha zero
 * on output, otherwise every sprite arrives on an opaque rectangle.
 */

import { u16, u32 } from './bytes.js';

/** Length of the basic header, before the `extra` block. */
const HEADER = 12;

/**
 * Reads a CIMG's header.
 *
 * Two things cannot be guessed. `extra` counts from byte 12, and its last twelve
 * bytes form a sub-header carrying both sizes — so a single computation covers
 * both families. And `compressed` counts those twelve bytes in its own total:
 * the payload is `compressed - 12`. It is that discrepancy that makes a naive
 * decode overrun into the next chunk.
 */
export function readImageHeader(bytes) {
  const extra = u32(bytes, 4);
  const subHeader = HEADER + extra - 12;

  const header = {
    type: u16(bytes, 0),
    subtype: u16(bytes, 2),
    extra,
    width: u16(bytes, 12),
    height: u16(bytes, 14),
    // The anchor point: where the game puts the sprite relative to its cell.
    // Atomic Bomberman's sprites are framed wide with uneven margins, and it is
    // that point — not the corner of the image — that lines them up on the grid.
    anchorX: u16(bytes, 16),
    anchorY: u16(bytes, 18),
    key: u16(bytes, 20),
    compressed: u32(bytes, subHeader + 4),
    raw: u32(bytes, subHeader + 8),
    data: HEADER + extra,
  };

  // The depth is read from the decompressed size, not from `extra`: thirty-two
  // of the game's images are 16-bit AND drag a palette along that they do not
  // use. Deduced from `extra`, they came out read as 8-bit — a stream twice too
  // short, hence an image three quarters truncated.
  header.bits = header.raw === header.width * header.height * 2 ? 16 : 8;
  // When a palette is there, it sits between the basic header and the
  // sub-header: 20 spare bytes, 1024 of palette, 12 of sub-header.
  if (extra >= 1056) header.palette = 32;
  return header;
}

/**
 * Expands a CIMG's RLE into 16-bit words or palette indexes.
 *
 * The encoding, reconstructed by demanding that the stream be consumed exactly
 * and fill the surface exactly — checked on all 2327 images of the game:
 *
 *   0x00..0x7f   (command + 1) literal pixels, one after the other
 *   0x80..0xfe   repetition of the next pixel, (command & 0x7f) + 1 times
 *   0xff         end of image
 *
 * The trap is the "+ 1": both lengths are offset by one, because a literal or a
 * repetition of zero pixels would make no sense and the format reclaims the
 * value. Without the offset, the image drifts by one more pixel on every command
 * — the kind of mistake that leaves the first rows right and ruins all the rest.
 *
 * There is no end-of-row marker: rows follow one another with no separator and a
 * repetition crosses the edges without saying anything. So we count in a linear
 * index, never in (x, y).
 */
export function expand(data, width, height, bits, key) {
  const total = width * height;
  const pixels = new (bits === 16 ? Uint16Array : Uint8Array)(total).fill(key);
  const step = bits === 16 ? 2 : 1;
  const read = bits === 16 ? (p) => u16(data, p) : (p) => data[p];

  let p = 0;
  let index = 0;

  while (p < data.length && index < total) {
    const command = data[p];
    p += 1;
    if (command === 0xff) break;

    const repeat = (command & 0x80) !== 0;
    const count = (command & 0x7f) + 1;
    if (index + count > total || p + (repeat ? step : count * step) > data.length) {
      throw new Error(`flux CIMG incoherent a l'octet ${p - 1} (index ${index}/${total})`);
    }

    if (repeat) {
      pixels.fill(read(p), index, index + count);
      p += step;
    } else {
      for (let i = 0; i < count; i += 1) pixels[index + i] = read(p + i * step);
      p += count * step;
    }
    index += count;
  }

  return { pixels, consumed: p, filled: index };
}

/**
 * Converts a 16-bit word into RGB.
 *
 * The data is RGB555, not 565: five bits per component and the top bit unused.
 * The histogram proves it — the game's greys are 0x0c63, 0x1084, 0x6739, that is
 * the same value repeated over three five-bit fields. Read as 565, those greys
 * turn green because one bit of red falls into the green, and the whole sheet
 * takes on a tint.
 *
 * The components are folded onto themselves (`<< 3 | >> 2`) rather than merely
 * shifted: otherwise white tops out at 248 and light flats take on a grey veil.
 */
export function rgb555(word) {
  const r = (word >> 10) & 0x1f;
  const g = (word >> 5) & 0x1f;
  const b = word & 0x1f;
  return [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2)];
}

/** Decodes a whole CIMG into RGBA, the key colour becoming transparent. */
export function decode(bytes) {
  const header = readImageHeader(bytes);
  const { width, height, bits, key } = header;
  const data = bytes.subarray(header.data, header.data + header.compressed - 12);
  const { pixels } = expand(data, width, height, bits, key);

  // Palette of the 8-bit images: 256 BGRX entries, the way Windows wrote them.
  let palette = null;
  if (bits === 8) {
    palette = [];
    for (let i = 0; i < 256; i += 1) {
      const o = header.palette + i * 4;
      palette.push([bytes[o + 2], bytes[o + 1], bytes[o]]);
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    const value = pixels[i];
    if (value === key) continue;
    const [r, g, b] = palette ? palette[value] : rgb555(value);
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }

  return { ...header, rgba };
}
