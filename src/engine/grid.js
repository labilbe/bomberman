/**
 * Reading and writing the grid, and box geometry.
 *
 * The grid is a flat Uint8Array rather than an array of arrays: it is cloned
 * every round, walked sixty times a second by the relay, and serialised for the
 * network. A byte buffer copies and encodes in one go, where nested arrays
 * would force a loop.
 *
 * `setCell` is the ONLY write path, and it bumps `state.version`. Repairing
 * desynchronisations depends on that: the client only receives the whole arena
 * at the start of a round, then edits it from events; by comparing its version
 * with the relay's, it knows at once that it missed something, instead of
 * playing on a phantom arena.
 */

import { COLS, ROWS, EMPTY, SOLID, BRICK, UNITS, HALF_BOMBER } from './constants.js';

/** @param {number} x @param {number} y */
export function index(x, y) {
  return y * COLS + x;
}

/** True when the cell is inside the grid. */
export function inArena(x, y) {
  return x >= 0 && y >= 0 && x < COLS && y < ROWS;
}

/**
 * Brings a cell back inside the arena by LEAVING THROUGH THE OTHER EDGE.
 *
 * The arena only wraps for the boxing glove: a bomb punched upwards comes back
 * from the bottom, on the same column, as in the original game. Nothing else
 * wraps — not walking, not flames, not the kick, which all stop at the border
 * wall.
 *
 * JavaScript's remainder keeps the sign of the dividend: `-1 % 13` is -1, not
 * 12. Hence the double modulo rather than a plain `%`.
 */
export function wrap(x, y) {
  return {
    cx: ((x % COLS) + COLS) % COLS,
    cy: ((y % ROWS) + ROWS) % ROWS,
  };
}

/**
 * What a cell is made of. Outside the arena the answer is SOLID: flame
 * propagation and movement then stop without testing the edges twice.
 *
 * @param {{ tiles: Uint8Array }} state
 */
export function cellAt(state, x, y) {
  if (!inArena(x, y)) return SOLID;
  return state.tiles[index(x, y)];
}

/**
 * Changes a cell and marks the arena as modified.
 *
 * @param {{ tiles: Uint8Array, version: number }} state
 */
export function setCell(state, x, y, value) {
  if (!inArena(x, y)) return;
  state.tiles[index(x, y)] = value;
  state.version += 1;
}

/** Does this cell stop a bomber and a flame? */
export function isSolid(value) {
  return value === SOLID || value === BRICK;
}

/** True when the cell is a destructible brick. */
export function isBrick(value) {
  return value === BRICK;
}

/**
 * True when the cell can be walked through, bombs aside.
 *
 * A destroyed brick goes straight to EMPTY, with no intermediate rubble state:
 * the debris is a rendering animation, fired by the `brick` event. A "rubble"
 * cell in the grid would have meant a second write a few steps later, hence a
 * second version bump for the client to reproduce exactly — a whole class of
 * desynchronisation for a purely decorative effect.
 */
export function isFree(value) {
  return value === EMPTY;
}

/** Centre of a cell, in sub-units. */
export function centreOfCell(cx, cy) {
  return { x: cx * UNITS + UNITS / 2, y: cy * UNITS + UNITS / 2 };
}

/** Coordinate of a cell's centre on one axis. */
export function centreOnAxis(c) {
  return c * UNITS + UNITS / 2;
}

/** Cell holding a position given in sub-units. */
export function cellOf(x, y) {
  return { cx: Math.floor(x / UNITS), cy: Math.floor(y / UNITS) };
}

/** Cell on a single axis. */
export function cellOnAxis(v) {
  return Math.floor(v / UNITS);
}

/**
 * A bomber's box around a position, in sub-units.
 *
 * @returns {{ left: number, right: number, top: number, bottom: number }}
 */
export function box(x, y) {
  return {
    left: x - HALF_BOMBER,
    right: x + HALF_BOMBER,
    top: y - HALF_BOMBER,
    bottom: y + HALF_BOMBER,
  };
}

/**
 * Cells touched by a box. One to four, never more: the box is smaller than a
 * tile.
 *
 * @returns {{ cx: number, cy: number }[]}
 */
export function touchedCells(x, y) {
  const b = box(x, y);
  const left = cellOnAxis(b.left);
  const right = cellOnAxis(b.right);
  const top = cellOnAxis(b.top);
  const bottom = cellOnAxis(b.bottom);
  const cells = [];
  for (let cy = top; cy <= bottom; cy += 1) {
    for (let cx = left; cx <= right; cx += 1) cells.push({ cx, cy });
  }
  return cells;
}

/**
 * True when a bomber's box overlaps a given cell.
 *
 * Strict comparisons: a bomber flush against a cell's edge is not inside it.
 * Without that, a flame would kill through a one-tile wall.
 *
 * `half` allows asking about a SMALLER box than the collision one. Flames use
 * it: see HALF_DEADLY, which explains why dying and bumping are not measured
 * with the same box.
 */
export function boxOnCell(x, y, cx, cy, half = HALF_BOMBER) {
  return (
    x + half > cx * UNITS
    && x - half < (cx + 1) * UNITS
    && y + half > cy * UNITS
    && y - half < (cy + 1) * UNITS
  );
}

export { COLS, ROWS, EMPTY, SOLID, BRICK };
