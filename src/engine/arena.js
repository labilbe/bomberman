/**
 * Deterministic arena generation, and sowing of the bonuses.
 *
 * The four corners are cleared in an L shape. Without that a bomber can be born
 * locked between two bricks, lose the round before moving, and blame the game
 * with good reason.
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
import { HIDDEN, BONUS_TABLE } from './bonus.js';

/** Share of bricks among the free cells. */
const BRICK_DENSITY = 0.78;

/** Share of bricks hiding a bonus. */
const BRICKS_WITH_BONUS = 0.35;

/**
 * Starting corners, in the order of the places.
 *
 * Diagonally: with two players you face each other across the arena, which
 * leaves time to build up before meeting. Listing them in reading order would
 * have put places 0 and 1 side by side.
 */
export const STARTS = [
  { x: 1, y: 1 },
  { x: COLS - 2, y: ROWS - 2 },
  { x: COLS - 2, y: 1 },
  { x: 1, y: ROWS - 2 },
];

/** True when the cell is one of the checkerboard's indestructible walls. */
export function isHardWall(x, y) {
  return x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0);
}

/**
 * The three cells to clear around a start: its own, and two neighbours towards
 * the inside of the arena. A bomber therefore always has two ways out.
 */
function clearings(start) {
  const towardsX = start.x === 1 ? 1 : -1;
  const towardsY = start.y === 1 ? 1 : -1;
  return [
    { x: start.x, y: start.y },
    { x: start.x + towardsX, y: start.y },
    { x: start.x, y: start.y + towardsY },
  ];
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
  const total = BONUS_TABLE.reduce((sum, [, weight]) => sum + weight, 0);
  const roll = nextRandom(rng);
  let left = roll.value * total;
  for (const [code, weight] of BONUS_TABLE) {
    left -= weight;
    if (left < 0) return { rng: roll.rng, bonus: code };
  }
  return { rng: roll.rng, bonus: BONUS_TABLE[BONUS_TABLE.length - 1][0] };
}

/**
 * Generates an arena and sows the hidden bonuses in it.
 *
 * @param {{ seed: number }} rng seeded generator
 * @returns {{ tiles: Uint8Array, items: Uint8Array, rng: { seed: number } }}
 */
export function generateArena(rng) {
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

  // After the brick draw, not during it: the sequence of numbers consumed then
  // does not depend on how many corners are cleared, and stays the same with 2
  // players as with 4.
  for (const start of STARTS) {
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
