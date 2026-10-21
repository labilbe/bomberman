/**
 * The arena closing in, once the round's time is up.
 *
 * Tested on a bare arena, like every other rule: what matters here is WHERE the
 * blocks fall and WHEN, and an assertion that depended on where chance put a
 * brick would say nothing about either.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { bareArena, place, item, events } from './helpers.js';
import { advanceBy, step } from '../src/engine/step.js';
import { ENCLOSURE } from '../src/engine/arena.js';
import { wallsDue, timeLeft, closing } from '../src/engine/enclosure.js';
import { BY_WALL } from '../src/engine/explosion.js';
import { cellAt, index } from '../src/engine/grid.js';
import {
  COLS,
  ROWS,
  SOLID,
  EMPTY,
  ROUND_TIME_STEPS,
  ENCLOSURE_STEPS,
  STEP_HZ,
} from '../src/engine/constants.js';
import { BONUS_CODES } from '../src/engine/bonus.js';

test('the spiral covers the whole playable area, once each', () => {
  const inside = (COLS - 2) * (ROWS - 2);
  assert.equal(ENCLOSURE.length, inside, 'every cell inside the outer wall');
  const seen = new Set(ENCLOSURE.map(([x, y]) => `${x},${y}`));
  assert.equal(seen.size, ENCLOSURE.length, 'and none of them twice');
  for (const [x, y] of ENCLOSURE) {
    assert.ok(x >= 1 && x <= COLS - 2 && y >= 1 && y <= ROWS - 2, `${x},${y} is inside`);
  }
});

test('it starts at the top left and ends in the middle', () => {
  assert.deepEqual(ENCLOSURE[0], [1, 1], 'the first block falls in the corner');
  // The spiral turns inwards, so the last cell is the middle of the board — to
  // within the half cell a grid of even width cannot have.
  const [lastX, lastY] = ENCLOSURE.at(-1);
  assert.ok(Math.abs(lastX - (COLS - 1) / 2) <= 1, 'last column is the middle one');
  assert.ok(Math.abs(lastY - (ROWS - 1) / 2) <= 1, 'last row is the middle one');
});

test('it turns clockwise: along the top, then down the right side', () => {
  // The first thirteen run the top row left to right, the next ones go down the
  // far column. Reading the order is the only way to tell a clockwise spiral
  // from a counter-clockwise one, and the game turns this way.
  const top = ENCLOSURE.slice(0, COLS - 2);
  assert.deepEqual(top.map(([x]) => x), Array.from({ length: COLS - 2 }, (_, i) => i + 1));
  assert.ok(top.every(([, y]) => y === 1), 'all along the top row');
  assert.deepEqual(ENCLOSURE[COLS - 2], [COLS - 2, 2], 'then one row down, on the far side');
});

test('nothing falls while the round still has time', () => {
  assert.equal(wallsDue(0), 0);
  assert.equal(wallsDue(ROUND_TIME_STEPS), 0, 'not even on the very last step');
  assert.equal(closing(ROUND_TIME_STEPS), false);
  assert.equal(wallsDue(ROUND_TIME_STEPS + 1), 1, 'the first one falls on the step after');
  assert.equal(closing(ROUND_TIME_STEPS + 1), true);
});

test('the blocks fall at a steady pace, and stop once the board is full', () => {
  assert.equal(wallsDue(ROUND_TIME_STEPS + ENCLOSURE_STEPS), 1, 'one per interval');
  assert.equal(wallsDue(ROUND_TIME_STEPS + ENCLOSURE_STEPS + 1), 2);
  const whole = ROUND_TIME_STEPS + ENCLOSURE.length * ENCLOSURE_STEPS;
  assert.equal(wallsDue(whole), ENCLOSURE.length, 'the spiral is done');
  assert.equal(wallsDue(whole + 10000), ENCLOSURE.length, 'and nothing runs off the end');
});

test('the time left is what the dashboard counts down', () => {
  assert.equal(timeLeft(0), ROUND_TIME_STEPS);
  assert.equal(timeLeft(ROUND_TIME_STEPS - STEP_HZ), STEP_HZ, 'one second to go');
  assert.equal(timeLeft(ROUND_TIME_STEPS + 500), 0, 'never negative');
});

test('the first block walls off the top left corner', () => {
  const state = bareArena();
  // Out of the corner, so that nobody is crushed while we watch the grid.
  place(state, 0, 5, 5);
  place(state, 1, 9, 5);

  advanceBy(state, ROUND_TIME_STEPS);
  assert.equal(cellAt(state, 1, 1), EMPTY, 'still open on the last step of the round');

  step(state);
  assert.equal(cellAt(state, 1, 1), SOLID, 'and walled on the next');
  assert.deepEqual(events(state, 'wall'), [['wall', 1, 1]], 'announced to the renderer');
});

test('a block crushes whoever is under it', () => {
  const state = bareArena();
  place(state, 0, 1, 1);
  place(state, 1, 9, 5);

  advanceBy(state, ROUND_TIME_STEPS + 1);

  const crushed = state.players[0];
  assert.equal(crushed.alive, false, 'the corner is where the first block falls');
  assert.deepEqual(events(state, 'death'), [['death', 0, BY_WALL]], 'and it says what killed them');
  assert.equal(state.players[1].alive, true, 'the other one is elsewhere');
});

test('a block buries the pack that was lying there', () => {
  const state = bareArena();
  place(state, 0, 5, 5);
  place(state, 1, 9, 5);
  item(state, 1, 1, BONUS_CODES.FLAME);

  advanceBy(state, ROUND_TIME_STEPS + 1);

  assert.equal(state.items[index(1, 1)], 0, 'the pack goes with the cell');
  assert.deepEqual(events(state, 'itemgone'), [['itemgone', 1, 1]], 'so the client clears it too');
});

test('a bomb under a block is gone, not set off', () => {
  // Letting it burn would send flames out of a cell that is solid wall, through
  // the block that just buried it: fire out of nowhere, as far as the eye goes.
  const state = bareArena();
  place(state, 0, 1, 1);
  place(state, 1, 9, 5);
  // Dropped THREE STEPS before the block falls: a fuse runs far longer than
  // that, so what buries the bomb is the block and nothing else.
  advanceBy(state, ROUND_TIME_STEPS - 3);
  step(state, [{ dir: -1, drop: true, detonate: false, hold: false }]);
  assert.equal(state.bombs.length, 1, 'the bomb is there before the block');

  advanceBy(state, 3);
  assert.equal(state.bombs.length, 0, 'and gone with it');
  assert.equal(events(state, 'boom').length, 0, 'without going off');
});

test('the blocks fall one at a time, in the order of the spiral', () => {
  // The count is READ OFF THE CLOCK rather than kept in the state, so the thing
  // worth checking is that the clock and the spiral stay in step over a long
  // run: no block skipped, none laid twice, none out of order.
  const state = bareArena();
  place(state, 0, 5, 5);
  place(state, 1, 9, 5);
  advanceBy(state, ROUND_TIME_STEPS);

  const laid = [];
  for (let i = 0; i < 20 * ENCLOSURE_STEPS; i += 1) {
    step(state);
    for (const [, x, y] of events(state, 'wall')) laid.push([x, y]);
  }

  assert.equal(laid.length, 20, 'one block per interval, no more and no less');
  assert.deepEqual(laid, ENCLOSURE.slice(0, 20), 'and exactly the spiral, in order');
});

test('the closing forces the round to a conclusion', () => {
  // The whole point of the limit: two bombers who avoid each other are not left
  // to avoid each other for ever. Nobody is declared anything — the ground runs
  // out, and the round then ends on its ordinary rule, the last one standing.
  const state = bareArena();
  place(state, 0, 1, 5);
  place(state, 1, 13, 5);

  // Neither of them moves or drops anything: left alone they would still be
  // there in an hour, which is exactly the round this rule exists to end.
  advanceBy(state, ROUND_TIME_STEPS + ENCLOSURE.length * ENCLOSURE_STEPS + 200);

  assert.equal(state.phase, 'verdict', 'the round is over');
  assert.ok(state.verdict, 'and it has a verdict');
  assert.ok(
    state.players.filter((player) => player.alive).length <= 1,
    'at most the last one standing is left',
  );
  // The corner they were standing in is walled: that is what ended it.
  assert.equal(cellAt(state, 1, 1), SOLID);
});
