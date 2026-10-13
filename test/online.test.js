/**
 * Tests for the rule that keeps the client's grid up to date.
 *
 * The relay does not broadcast the grid thirty times a second: it only sends what
 * changes, and the client applies it. That half was missing, and the flaw only
 * showed on a detail — a bonus picked up stayed drawn on the ground for ever,
 * although the player had indeed pocketed it. So the rule is isolated and pure,
 * to be checked without opening a WebSocket.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { followGrid } from '../src/net/online.js';
import { index } from '../src/engine/grid.js';
import { COLS, ROWS, EMPTY, BRICK } from '../src/engine/constants.js';
import { BONUS_CODES } from '../src/engine/bonus.js';

/** A client's grid, as `setGrid` lays it down. */
function grid() {
  return {
    tiles: new Uint8Array(COLS * ROWS),
    items: new Uint8Array(COLS * ROWS),
  };
}

test('a bonus picked up disappears from the ground', () => {
  // The bug reported: you did pick it up — the counter went up — but the bonus
  // stayed drawn, because nothing erased it from the client's grid.
  const state = grid();
  state.items[index(5, 3)] = BONUS_CODES.FLAME;

  followGrid(state, [['pick', 5, 3, 0, 'flame']]);
  assert.equal(state.items[index(5, 3)], 0);
});

test('a bonus revealed appears on the ground', () => {
  const state = grid();
  followGrid(state, [['item', 7, 4, 'kick']]);
  assert.equal(state.items[index(7, 4)], BONUS_CODES.KICK);
});

test('a bonus burnt disappears', () => {
  const state = grid();
  state.items[index(2, 2)] = BONUS_CODES.BOMB;
  followGrid(state, [['itemgone', 2, 2]]);
  assert.equal(state.items[index(2, 2)], 0);
});

test('a brick that is FALLING does not empty its cell yet', () => {
  // `brick` announces the fall: the brick still blocks, and only its animation
  // starts. Confusing the two opened the way before the relay did.
  const state = grid();
  state.tiles[index(4, 4)] = BRICK;

  const writes = followGrid(state, [['brick', 4, 4]]);
  assert.equal(state.tiles[index(4, 4)], BRICK);
  assert.equal(writes, 0, 'nothing is written, so the version does not move');
});

test('a brick that has fallen empties its cell and counts for the version', () => {
  const state = grid();
  state.tiles[index(4, 4)] = BRICK;

  const writes = followGrid(state, [['brickgone', 4, 4]]);
  assert.equal(state.tiles[index(4, 4)], EMPTY);
  // The relay counts one version per tile write: without carrying that over,
  // every broken brick would trigger a resynchronisation of the whole grid.
  assert.equal(writes, 1);
});

test('events that do not touch the grid do not count', () => {
  const state = grid();
  const writes = followGrid(state, [
    ['bomb', 1, 1, 0],
    ['boom', 3, 1, 1, 2, 2, 2, 2],
    ['death', 0, 0],
  ]);
  assert.equal(writes, 0);
});

test('a whole step applies in order', () => {
  // The explosion uncovers a bonus, and the same step can burn another one.
  const state = grid();
  state.tiles[index(5, 3)] = BRICK;
  state.items[index(1, 1)] = BONUS_CODES.SPEED;

  const writes = followGrid(state, [
    ['brickgone', 5, 3],
    ['itemgone', 1, 1],
    ['item', 5, 3, 'trigger'],
  ]);

  assert.equal(state.tiles[index(5, 3)], EMPTY);
  assert.equal(state.items[index(5, 3)], BONUS_CODES.TRIGGER);
  assert.equal(state.items[index(1, 1)], 0);
  assert.equal(writes, 1);
});

test('a cell outside the arena is ignored, not written at random', () => {
  // Events come off the network: an aberrant coordinate must not write somewhere
  // else in the array.
  const state = grid();
  const copy = Uint8Array.from(state.items);
  followGrid(state, [['pick', 99, 99, 0, 'bomb'], ['item', -4, 2, 'bomb']]);
  assert.deepEqual(state.items, copy);
});

test('an unknown bonus name empties the cell rather than inventing one', () => {
  const state = grid();
  state.items[index(6, 6)] = BONUS_CODES.KICK;
  followGrid(state, [['item', 6, 6, 'parachute']]);
  assert.equal(state.items[index(6, 6)], 0);
});
