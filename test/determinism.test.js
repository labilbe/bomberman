/**
 * The project's central test.
 *
 * The whole architecture rests on a single promise: same seed + same sequence of
 * inputs = same sequence of states, on any machine. It is that promise which
 * lets the relay simulate the arena, the browser predict its own bomber, and the
 * log replay a game. If this file breaks, it is not a detail of the rules that is
 * at stake, it is the whole network.
 *
 * The second test re-reads the engine's folder looking for the three sources of
 * non-determinism one reintroduces without thinking. Re-reading the folder beats
 * trusting: review forgets, the test does not.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createState, clone } from '../src/engine/state.js';
import { step } from '../src/engine/step.js';
import { createRng, nextRandom } from '../src/engine/rng.js';
import { MAX_PLAYERS } from '../src/engine/constants.js';

/**
 * A log of inputs, pseudo-random but reproducible: we do not draw the inputs at
 * real random, otherwise a failure would not replay.
 */
function log(seed, totalSteps, places) {
  let rng = createRng(seed);
  const draw = (bound) => {
    const t = nextRandom(rng);
    rng = t.rng;
    return Math.floor(t.value * bound);
  };
  const run = [];
  for (let i = 0; i < totalSteps; i += 1) {
    const inputs = [];
    for (let place = 0; place < places; place += 1) {
      inputs[place] = {
        dir: draw(5) - 1,
        drop: draw(16) === 0,
        detonate: draw(64) === 0,
      };
    }
    run.push(inputs);
  }
  return run;
}

/** Condenses a state into a comparable string. */
function fingerprint(state) {
  return JSON.stringify({
    step: state.step,
    phase: state.phase,
    version: state.version,
    seed: state.rng.seed,
    tiles: [...state.tiles],
    items: [...state.items],
    players: state.players,
    bombs: state.bombs,
    flames: state.flames,
    verdict: state.verdict,
  });
}

function replay(seed, places, run) {
  const state = createState({ seed, places });
  for (const inputs of run) step(state, inputs);
  return state;
}

test('two identical games give the same final state', () => {
  const run = log(777, 2000, MAX_PLAYERS);
  const one = replay(555, MAX_PLAYERS, run);
  const two = replay(555, MAX_PLAYERS, run);
  assert.equal(fingerprint(one), fingerprint(two));
  assert.ok(one.step > 0);
});

test('a game replayed from a clone follows the same path', () => {
  const run = log(31, 600, 3);
  const start = createState({ seed: 99, places: 3 });
  const copy = clone(start);
  assert.equal(fingerprint(start), fingerprint(copy), 'the clone starts identical');

  for (const inputs of run) step(start, inputs);
  for (const inputs of run) step(copy, inputs);
  assert.equal(fingerprint(start), fingerprint(copy));
});

test('a clone shares nothing with its original', () => {
  const state = createState({ seed: 5, places: 2 });
  const copy = clone(state);
  copy.tiles[0] = 9;
  copy.items[0] = 9;
  copy.players[0].x = -1;
  copy.rng.seed = 1234;
  assert.notEqual(state.tiles[0], 9);
  assert.notEqual(state.items[0], 9);
  assert.notEqual(state.players[0].x, -1);
  assert.notEqual(state.rng.seed, 1234);
});

test('every position stays an integer', () => {
  // A float accumulating over ten thousand steps ends up differing from one
  // machine to the next, and a player ends up dead on one side and alive on the
  // other.
  const run = log(2, 1500, MAX_PLAYERS);
  const state = createState({ seed: 8, places: MAX_PLAYERS });
  for (const inputs of run) {
    step(state, inputs);
    for (const player of state.players) {
      assert.equal(Number.isInteger(player.x), true, `non-integer x: ${player.x}`);
      assert.equal(Number.isInteger(player.y), true, `non-integer y: ${player.y}`);
    }
    for (const bomb of state.bombs) {
      assert.equal(Number.isInteger(bomb.cx), true);
      assert.equal(Number.isInteger(bomb.cy), true);
      if (bomb.slide) {
        assert.equal(Number.isInteger(bomb.slide.x), true);
        assert.equal(Number.isInteger(bomb.slide.y), true);
      }
    }
  }
});

test('the engine contains no source of randomness nor of clock', () => {
  const folder = fileURLToPath(new URL('../src/engine/', import.meta.url));
  const forbidden = [
    ['Math.random', /Math\s*\.\s*random/],
    ['Date.now', /Date\s*\.\s*now/],
    ['new Date', /new\s+Date\s*\(/],
    ['performance.now', /performance\s*\.\s*now/],
  ];
  const files = readdirSync(folder).filter((name) => name.endsWith('.js'));
  assert.ok(files.length >= 8, 'the engine has to be there');

  for (const name of files) {
    // rng.js is allowed randomSeed(): it is the border where randomness comes
    // in, once, for a solo game.
    const source = readFileSync(new URL(`../src/engine/${name}`, import.meta.url), 'utf8');
    for (const [label, pattern] of forbidden) {
      if (name === 'rng.js' && label === 'Math.random') continue;
      assert.equal(pattern.test(source), false, `${name} must not use ${label}`);
    }
  }
});
