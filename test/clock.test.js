import test from 'node:test';
import assert from 'node:assert/strict';

import { createClock, advance, MAX_CATCHUP } from '../src/engine/clock.js';
import { normalise, emptyInputs, EMPTY_INPUT } from '../src/engine/inputs.js';
import { STEP_MS } from '../src/engine/constants.js';

test('time turns into whole steps, without losing any', () => {
  let clock = createClock(0);
  let total = 0;
  // A display rate that does not land exactly on the step: the remainder must
  // be carried over, otherwise the game falls behind on every frame.
  for (let i = 1; i <= 60; i += 1) {
    const tick = advance(clock, i * 17);
    clock = tick.clock;
    total += tick.steps;
  }
  const expected = Math.floor((60 * 17) / STEP_MS);
  assert.ok(Math.abs(total - expected) <= 1, `${total} steps for ${expected} expected`);
});

test('a tab back from the background does not replay the whole game', () => {
  let clock = createClock(0);
  const tick = advance(clock, 30000);
  assert.equal(tick.steps, MAX_CATCHUP);
  // And lost time is lost: it does not come back on the next frame.
  clock = tick.clock;
  assert.equal(advance(clock, 30000 + STEP_MS).steps, 1);
});

test('a clock going backwards does not rewind the game', () => {
  const clock = createClock(1000);
  assert.equal(advance(clock, 500).steps, 0);
  assert.equal(advance(clock, Number.NaN).steps, 0);
});

test('an input off the network is brought back to something usable', () => {
  assert.deepEqual(normalise(null), { ...EMPTY_INPUT });
  assert.deepEqual(normalise('nord'), { ...EMPTY_INPUT });
  assert.deepEqual(normalise({ dir: 9 }), { dir: -1, drop: false, detonate: false });
  assert.deepEqual(normalise({ dir: -4 }), { dir: -1, drop: false, detonate: false });
  assert.deepEqual(normalise({ dir: '2' }), { dir: 2, drop: false, detonate: false });
  assert.deepEqual(normalise({ dir: 1.5 }), { dir: -1, drop: false, detonate: false });
  assert.deepEqual(normalise({ drop: 'oui' }), { dir: -1, drop: false, detonate: false });
  assert.deepEqual(normalise({ dir: 0, drop: true, detonate: true }), {
    dir: 0,
    drop: true,
    detonate: true,
  });
});

test('the empty input is frozen, so nobody changes it by surprise', () => {
  assert.equal(Object.isFrozen(EMPTY_INPUT), true);
  const empty = emptyInputs(4);
  assert.equal(empty.length, 4);
  empty[0].drop = true;
  assert.equal(EMPTY_INPUT.drop, false);
});
