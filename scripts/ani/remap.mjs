/**
 * Reading the game's colour tables off the disk.
 *
 * All the reasoning is in `src/extraction/colours.js`, which knows nothing but
 * bytes. All that is left here is to go and fetch them: it is the only thing a
 * command-line script can do that a page cannot.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { playerColours, COLOURS } from '../../src/extraction/colours.js';

export { COLOURS };

/**
 * Reads each player's colour from an installation of the game.
 *
 * @param {string} root folder containing COLOR.PAL and the .RMP files
 * @returns {{ hue: number, saturation: number, lightness: number }[]}
 */
export function readPlayerColours(root) {
  const pal = readFileSync(join(root, 'COLOR.PAL'));
  const rmps = [];
  for (let n = 0; n < COLOURS; n += 1) rmps.push(readFileSync(join(root, `${n}.RMP`)));
  return playerColours(pal, rmps);
}
