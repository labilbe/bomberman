/**
 * Atomic Bomberman's player colours, taken from the game's own files.
 *
 * Every sprite is drawn in GREEN — bombers, bombs, flames — and that is
 * deliberate: green is a neutral ramp the game replaces with the player's
 * colour. The sequences carry the word in their name: "bomb regular green",
 * "flame center green".
 *
 * The tables sit at the root of the game, next to BM.EXE:
 *
 *   COLOR.PAL   768 bytes of 6-bit palette, then 32768 bytes of inverse table
 *               giving, for every RGB555 colour, the nearest palette index.
 *   0.RMP .. 9.RMP   one file per player: 3 bytes of header then 256 entries
 *               mapping one palette index onto another.
 *
 * THESE TABLES CANNOT BE APPLIED AS THEY ARE, and that is the trap of this whole
 * module. They substitute index by index, for the precise palette of the 8-BIT
 * art. But the sprites we extract are 16-bit and carry shades that are in no
 * palette: looking for the "nearest" one drops two neighbouring pixels on
 * unrelated indexes, and the substitution sends them to unrelated colours. The
 * result is a blotchy sprite, with fringes and a garish helmet. The table is not
 * even monotonic: the source #044100 (luminance 39) becomes an off-white while
 * #048600, which is lighter, becomes a dark grey.
 *
 * So we only read from the tables what they say TRULY at any depth: each
 * player's HUE. The gradient stays the sprite's own.
 *
 * This module touches no file: it is handed the bytes. That is what lets it
 * serve two callers that have nothing in common — the extraction script, which
 * reads the disk, and the page, which is handed the folder the visitor chose.
 */

/** Number of players Atomic Bomberman colours. */
export const COLOURS = 10;

/** Length of the palette, in bytes: 256 entries of three components. */
const PALETTE = 768;

/** Length of the inverse table that follows the palette in COLOR.PAL. */
const INVERSE = 32768;

/** Header of a .RMP file, before its 256 entries. */
const RMP_HEADER = 3;

/** Index an entry points at when it remaps nothing. */
const DEAD = 0;

/** Six bits to eight, folded so that the maximum really reaches 255. */
const six = (v) => (v << 2) | (v >> 4);

/** Hue, saturation, lightness, over [0,360] and [0,1]. */
function toHsl([r, g, b]) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const [R, G, B] = [r / 255, g / 255, b / 255];
  let h;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [((h * 60) + 360) % 360, s, l];
}

/** Median: robust to the few aberrant targets of these old tables. */
const median = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : 0;
};

/**
 * Reads each player's colour: hue, saturation, lightness correction.
 *
 * We only query the tables on PURE GREEN sources — full saturation, hue around
 * 120 — because they are the only ones the game guarantees belong to the
 * swappable ramp. The greys and mixed hues that linger in the remapped range are
 * scenery, and including them brought back absurd values.
 *
 * @param {Uint8Array} pal contents of COLOR.PAL
 * @param {Uint8Array[]} rmps contents of 0.RMP to 9.RMP, in order
 * @returns {{ hue: number, saturation: number, lightness: number }[]}
 */
export function playerColours(pal, rmps) {
  if (pal.length !== PALETTE + INVERSE) {
    throw new Error(`COLOR.PAL fait ${pal.length} octets, attendu ${PALETTE + INVERSE}`);
  }
  if (rmps.length !== COLOURS) {
    throw new Error(`${rmps.length} fichiers .RMP, attendu ${COLOURS}`);
  }
  const colour = (i) => [six(pal[i * 3]), six(pal[i * 3 + 1]), six(pal[i * 3 + 2])];

  const sources = [];
  for (let i = 1; i < 256; i += 1) {
    const [hue, saturation] = toHsl(colour(i));
    if (saturation < 0.9 || hue < 100 || hue > 140) continue;
    if (rmps.every((t) => t[RMP_HEADER + i] === i)) continue;
    if (rmps.some((t) => t[RMP_HEADER + i] === DEAD)) continue;
    sources.push(i);
  }

  return rmps.map((table) => {
    const pairs = sources.map((i) => ({
      source: toHsl(colour(i)),
      target: toHsl(colour(table[RMP_HEADER + i])),
    }));
    // We sort on CHROMA, not on HSL saturation: that one climbs to 1 for an
    // off-white like #f3fbff, and the white player then passed for a clear
    // colour. The gap between components, on the other hand, does not lie.
    const chroma = (i) => (Math.max(...colour(i)) - Math.min(...colour(i))) / 255;
    const coloured = pairs.filter((_, k) => chroma(table[RMP_HEADER + sources[k]]) > 0.12);
    // White and black have no hue: their targets are greys. We then keep the
    // residual saturation, which is the right answer — almost zero.
    const kept = coloured.length > pairs.length / 2 ? coloured : pairs;
    return {
      hue: Math.round(median(kept.map(({ target }) => target[0]))),
      saturation: Number(median(kept.map(({ target }) => target[1])).toFixed(2)),
      // How much the player lightens or darkens the ramp, on average.
      lightness: Number(median(pairs.map(({ source, target }) => target[2] - source[2])).toFixed(2)),
    };
  });
}
