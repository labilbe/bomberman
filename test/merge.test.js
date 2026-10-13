/**
 * Merging is a pure function: it knows neither keyboard nor gamepad, and that is
 * what lets the rule itself be checked rather than its wiring.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { merge } from '../src/input/merge.js';
import { UP, DOWN, RIGHT } from '../src/engine/constants.js';

const empty = { dir: -1, drop: false, detonate: false };

test('a single active source gives its direction', () => {
  assert.equal(merge(empty, { ...empty, dir: RIGHT }).dir, RIGHT);
  assert.equal(merge({ ...empty, dir: UP }, empty).dir, UP);
});

test('the first source that speaks wins the direction', () => {
  const result = merge({ ...empty, dir: UP }, { ...empty, dir: DOWN });
  assert.equal(result.dir, UP);
});

test('the pulses of both sources add up', () => {
  // They are already consumed at their source by the time we read them: losing
  // one here would really lose a bomb.
  const result = merge({ ...empty, drop: true }, { ...empty, detonate: true });
  assert.equal(result.drop, true);
  assert.equal(result.detonate, true);
});

test('a pulse from the source that loses the direction is kept', () => {
  const result = merge({ ...empty, dir: UP }, { ...empty, dir: DOWN, drop: true });
  assert.equal(result.dir, UP);
  assert.equal(result.drop, true);
});

test('two sources at rest give an empty intent', () => {
  assert.deepEqual(merge(empty, empty), empty);
});

test('no source at all gives an empty intent', () => {
  assert.deepEqual(merge(), empty);
});

test('a missing source does not throw', () => {
  assert.deepEqual(merge(null, undefined, { ...empty, dir: DOWN }), { ...empty, dir: DOWN });
});

test('only true and a valid direction get through', () => {
  // Intents go out on the network: we do not let a "drop" worth 1 or a string
  // through.
  const result = merge({ dir: undefined, drop: 1, detonate: 'oui' });
  assert.deepEqual(result, empty);
});
