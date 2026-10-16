/**
 * Deterministic arena generation, and sowing of the bonuses.
 *
 * Every start in play is cleared, itself and two ways out. Without that a bomber
 * can be born locked between two bricks, lose the round before moving, and blame
 * the game with good reason.
 *
 * Bonuses are sown HERE, at the start of the round, and not when a brick
 * explodes. That is what makes a game replayable: if the draw happened on
 * destruction, the sequence of bonuses would depend on the order in which
 * players break walls, hence on everyone's latency, and the log would no longer
 * let the round be reconstructed.
 */

import { COLS, ROWS, EMPTY, SOLID, BRICK } from './constants.js';
import { index } from './grid.js';
import { nextRandom } from './rng.js';
import { HIDDEN, fromTable } from './bonus.js';

/** Share of bricks among the free cells. */
const BRICK_DENSITY = 0.78;

/** Share of bricks hiding a bonus. */
const BRICKS_WITH_BONUS = 0.35;

/**
 * Starting cells, in the order of the places.
 *
 * TEN, like the original game, and all on the outer corridor: it is the only
 * ring of the arena where ten bombers can be spread out without any of them
 * being born in the middle of the board, which is a sentence rather than a
 * place. Four corners, four quarter-points on the long sides, and the two
 * middles of the short ones.
 *
 * IN PAIRS, each one opposite the one before: with two players you face each
 * other across the arena, which leaves time to build up before meeting, and
 * every count in between stays as spread out as it can be. Listing them in
 * reading order would have put places 0 and 1 side by side.
 *
 * THE FIRST FOUR HAVE NOT MOVED. A game of two, three or four is played on the
 * arena it has always been played on.
 */
export const STARTS = [
  { x: 1, y: 1 },
  { x: COLS - 2, y: ROWS - 2 },
  { x: COLS - 2, y: 1 },
  { x: 1, y: ROWS - 2 },
  { x: 1, y: (ROWS - 1) / 2 },
  { x: COLS - 2, y: (ROWS - 1) / 2 },
  { x: 5, y: 1 },
  { x: COLS - 6, y: ROWS - 2 },
  { x: COLS - 6, y: 1 },
  { x: 5, y: ROWS - 2 },
];

/** True when the cell is one of the checkerboard's indestructible walls. */
export function isHardWall(x, y) {
  return x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0);
}

/**
 * The three cells to clear around a start: its own, and two neighbours. A bomber
 * therefore always has two ways out.
 *
 * TOWARDS THE INSIDE FIRST, then along the wall. The two orders were the same
 * thing as long as every start was a corner; a start set against the middle of a
 * side has its inward neighbour on the checkerboard — one chance in two — and
 * only the corridor it stands in to offer. Picking blind there cleared a wall
 * and left the bomber with a single way out.
 *
 * Exported for the tests: this is the rule a start has to keep, and rewriting it
 * in the test would only check that two copies of it agree.
 */
export function clearings(start) {
  const inX = Math.sign((COLS - 1) / 2 - start.x);
  const inY = Math.sign((ROWS - 1) / 2 - start.y);
  const around = [
    { x: start.x + inX, y: start.y },
    { x: start.x, y: start.y + inY },
    { x: start.x - 1, y: start.y },
    { x: start.x + 1, y: start.y },
    { x: start.x, y: start.y - 1 },
    { x: start.x, y: start.y + 1 },
  ];

  const free = [{ x: start.x, y: start.y }];
  for (const cell of around) {
    if (free.length === 3) break;
    // A sign of zero names the start itself: a start level with the middle of
    // the arena has no inside on that axis.
    if (isHardWall(cell.x, cell.y)) continue;
    if (free.some((kept) => kept.x === cell.x && kept.y === cell.y)) continue;
    free.push(cell);
  }
  return free;
}

/**
 * Draws a bonus from the weighted table.
 *
 * A single call to the generator, whichever branch is taken: if the number of
 * draws depended on the result, two machines would desynchronise from the very
 * first bonus.
 *
 * @param {{ seed: number }} rng
 * @returns {{ rng: { seed: number }, bonus: number }}
 */
export function drawBonus(rng) {
  const roll = nextRandom(rng);
  return { rng: roll.rng, bonus: fromTable(roll.value) };
}

/**
 * Generates an arena and sows the hidden bonuses in it.
 *
 * `places` ONLY decides which starts are cleared, never the draw: a round of two
 * is therefore played on the arena it has always been played on, while a round
 * of ten opens the ten cells its bombers are born on — and, with them, the thirty
 * or so squares that keep ten people from spawning nose to nose in a brick maze.
 *
 * @param {{ seed: number }} rng seeded generator
 * @param {number} places bombers to make room for
 * @returns {{ tiles: Uint8Array, items: Uint8Array, rng: { seed: number } }}
 */
export function generateArena(rng, places = STARTS.length) {
  const tiles = new Uint8Array(COLS * ROWS);
  const items = new Uint8Array(COLS * ROWS);
  let current = rng;

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (isHardWall(x, y)) {
        tiles[index(x, y)] = SOLID;
        continue;
      }
      const roll = nextRandom(current);
      current = roll.rng;
      tiles[index(x, y)] = roll.value < BRICK_DENSITY ? BRICK : EMPTY;
    }
  }

  // After the brick draw, not during it: THE BRICK DRAW consumes one number per
  // free cell whatever the count, so the checkerboard of a given seed is the
  // same with 2 players as with 10 — only the cells cleared afterwards differ.
  // The bonus sowing below, which draws per brick, does follow from it: both
  // sides of the wire therefore have to generate with the SAME count, which they
  // do, since the arena is born of the state and the state knows how many are
  // playing.
  for (const start of STARTS.slice(0, Math.max(1, Math.min(STARTS.length, places)))) {
    for (const free of clearings(start)) tiles[index(free.x, free.y)] = EMPTY;
  }

  // Walked by increasing index, one draw per brick: never an iteration over a
  // Set nor over key order, whose stability nothing guarantees.
  for (let i = 0; i < tiles.length; i += 1) {
    if (tiles[i] !== BRICK) continue;
    const dice = nextRandom(current);
    current = dice.rng;
    if (dice.value >= BRICKS_WITH_BONUS) continue;
    const choice = drawBonus(current);
    current = choice.rng;
    items[i] = HIDDEN + choice.bonus;
  }

  return { tiles, items, rng: current };
}

export { EMPTY, SOLID, BRICK };
