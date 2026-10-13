/**
 * Tools for the engine's tests.
 *
 * Rule tests are run on a BARE arena — the checkerboard walls only, no brick, no
 * bonus — and not on an arena drawn at random. An assertion that depends on
 * where chance put a brick says nothing about the rule it claims to check, and it
 * breaks the day the density changes.
 */

import { createState } from '../src/engine/state.js';
import { isHardWall } from '../src/engine/arena.js';
import { index, centreOfCell } from '../src/engine/grid.js';
import { COLS, ROWS, EMPTY, SOLID, BRICK } from '../src/engine/constants.js';

/**
 * A state with neither brick nor bonus.
 *
 * @param {{ places?: number, seed?: number }} options
 */
export function bareArena({ places = 2, seed = 1 } = {}) {
  const state = createState({ seed, places });
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      state.tiles[index(x, y)] = isHardWall(x, y) ? SOLID : EMPTY;
      state.items[index(x, y)] = 0;
    }
  }
  state.version = 0;
  return state;
}

/** Puts a brick down. */
export function brick(state, cx, cy) {
  state.tiles[index(cx, cy)] = BRICK;
}

/** Puts a visible bonus down. */
export function item(state, cx, cy, code) {
  state.items[index(cx, cy)] = code;
}

/** Teleports a bomber to the centre of a cell. */
export function place(state, seat, cx, cy) {
  const player = state.players[seat];
  const centre = centreOfCell(cx, cy);
  player.x = centre.x;
  player.y = centre.y;
  return player;
}

/** An input for a single place, the others idle. */
export function input(seat, { dir = -1, drop = false, detonate = false, hold = false } = {}) {
  const inputs = [];
  inputs[seat] = { dir, drop, detonate, hold };
  return inputs;
}

/** The events of a given type on the last step. */
export function events(state, name) {
  return state.events.filter((entry) => entry[0] === name);
}
