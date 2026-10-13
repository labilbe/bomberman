import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGame,
  stepGame,
  paused,
  frozen,
  ROUND_PAUSE_STEPS,
  ROUND_START_STEPS,
} from '../src/engine/game.js';
import { ROUND_END_STEPS } from '../src/engine/constants.js';
import { index } from '../src/engine/grid.js';
import { EMPTY, SOLID } from '../src/engine/constants.js';
import { isHardWall } from '../src/engine/arena.js';
import { COLS, ROWS } from '../src/engine/constants.js';

/** Empties the current round's arena, to control what kills. */
function strip(game) {
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      game.state.tiles[index(x, y)] = isHardWall(x, y) ? SOLID : EMPTY;
      game.state.items[index(x, y)] = 0;
    }
  }
}

/**
 * Uses up the pause at the start of a round.
 *
 * Every round begins frozen while it is announced. Tests that want to act on the
 * arena therefore have to let that time pass first, failing which their steps do
 * nothing at all.
 */
function launch(game) {
  for (let i = 0; i < ROUND_START_STEPS; i += 1) stepGame(game);
}

/** Kills a place and lets the round come to its conclusion. */
function conclude(game, place) {
  launch(game);
  game.state.players[place].alive = false;
  let transition = null;
  for (let i = 0; i < ROUND_END_STEPS + 5 && transition === null; i += 1) {
    transition = stepGame(game).transition;
  }
  return transition;
}

test('a round won gives a score and a pause', () => {
  const game = createGame({ seed: 11, places: 2 });
  strip(game);
  const transition = conclude(game, 1);
  assert.equal(transition.type, 'score');
  assert.deepEqual(transition.verdict, { winningPlace: 0, draw: false });
  assert.deepEqual(transition.scores, [1, 0]);
  assert.equal(paused(game), true);
});

test('the pause leads to a fresh round, with another arena', () => {
  const game = createGame({ seed: 11, places: 2 });
  strip(game);
  const first = game.state.seed;
  conclude(game, 1);

  let transition = null;
  for (let i = 0; i < ROUND_PAUSE_STEPS + 2 && transition === null; i += 1) {
    transition = stepGame(game).transition;
  }
  assert.equal(transition.type, 'round');
  assert.equal(transition.round, 2);
  assert.notEqual(game.state.seed, first, 'a different arena on every round');
  assert.equal(game.state.players.every((player) => player.alive), true);
  assert.equal(game.state.players[0].bombs, 1, 'the kit starts from scratch');
  assert.equal(paused(game), false);
});

test('the pause produces only one round transition', () => {
  const game = createGame({ seed: 3, places: 2 });
  strip(game);
  conclude(game, 1);
  let rounds = 0;
  for (let i = 0; i < ROUND_PAUSE_STEPS * 2; i += 1) {
    const { transition } = stepGame(game);
    if (transition && transition.type === 'round') rounds += 1;
  }
  assert.equal(rounds, 1);
});

test('two rounds won end the match', () => {
  const game = createGame({ seed: 21, places: 2 });
  strip(game);

  conclude(game, 1);
  for (let i = 0; i < ROUND_PAUSE_STEPS + 2; i += 1) stepGame(game);
  strip(game);
  const end = conclude(game, 1);

  assert.equal(end.type, 'finished');
  assert.equal(end.winner, 0);
  assert.deepEqual(end.scores, [2, 0]);
  assert.equal(game.over, true);

  // A finished game no longer moves, whatever is sent to it.
  const after = stepGame(game, [{ dir: 1, drop: true, detonate: false }]);
  assert.equal(after.transition, null);
  assert.deepEqual(after.events, []);
});

test('a format imposed is found in the game', () => {
  const game = createGame({ seed: 1, places: 4, format: 7 });
  assert.equal(game.format, 7);
  assert.equal(game.match.toWin, 4);
  assert.equal(game.state.players.length, 4);
});

test('a round starts frozen, long enough to announce it', () => {
  // The flaw this fixes: the "Manche N" announcement appeared over a game
  // already under way, and the bots had time to drop before the player had
  // finished reading.
  const game = createGame({ seed: 7, places: 2 });
  strip(game);
  const start = { x: game.state.players[0].x, y: game.state.players[0].y };

  assert.equal(frozen(game), true, 'frozen from creation');
  for (let i = 0; i < ROUND_START_STEPS; i += 1) {
    stepGame(game, [{ dir: 1, drop: true, detonate: false }]);
  }
  assert.deepEqual(
    { x: game.state.players[0].x, y: game.state.players[0].y },
    start,
    'nobody moves during the announcement',
  );
  assert.equal(game.state.bombs.length, 0, 'and nobody drops');
  assert.equal(game.state.step, 0, 'the arena time has not moved');

  assert.equal(frozen(game), false, 'then the round starts');
  stepGame(game, [{ dir: 1, drop: false, detonate: false }]);
  assert.notEqual(game.state.players[0].x, start.x, 'and the player can move at last');
});

test('the next round is frozen too, and the announcement says for how long', () => {
  const game = createGame({ seed: 11, places: 2 });
  strip(game);
  conclude(game, 1);

  let transition = null;
  for (let i = 0; i < ROUND_PAUSE_STEPS + 2 && transition === null; i += 1) {
    transition = stepGame(game).transition;
  }
  assert.equal(transition.type, 'round');
  // The page lines its banner's duration up with this field rather than a value
  // of its own: two separate countdowns would end up diverging.
  assert.equal(transition.wait, ROUND_START_STEPS);
  assert.equal(frozen(game), true);
});
