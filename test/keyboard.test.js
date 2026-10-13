/**
 * The keyboard is tested without a browser: `createKeyboard` accepts any event
 * target, and Node provides a native one. That is the whole point of not having
 * hard-coded `window` in the module.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createKeyboard, KEYS } from '../src/input/keyboard.js';
import { UP, DOWN, LEFT, RIGHT } from '../src/engine/constants.js';

/** A minimal event target, with what it takes to simulate keys. */
function bench() {
  const target = new EventTarget();
  const keyboard = createKeyboard({ target, count: 2 });
  const press = (code, { target: origin, ...extra } = {}) => {
    const event = new Event('keydown');
    Object.assign(event, { code, repeat: false, preventDefault() {}, ...extra });
    // `target` is a read-only accessor on Event: Object.assign does not replace
    // it, it has to be shadowed by an own property.
    if (origin) Object.defineProperty(event, 'target', { value: origin });
    target.dispatchEvent(event);
  };
  const release = (code) => {
    const event = new Event('keyup');
    Object.assign(event, { code, preventDefault() {} });
    target.dispatchEvent(event);
  };
  return { target, keyboard, press, release };
}

test('the two key sets drive two distinct seats', () => {
  const { keyboard, press } = bench();
  press('ArrowRight');
  press('KeyW');
  assert.equal(keyboard.read(0).dir, RIGHT);
  assert.equal(keyboard.read(1).dir, UP);
});

test('the direction follows the last key still held', () => {
  // A player who anticipates presses the next key before releasing the previous
  // one: keeping the first would make them carry straight on.
  const { keyboard, press, release } = bench();
  press('ArrowLeft');
  assert.equal(keyboard.read(0).dir, LEFT);
  press('ArrowDown');
  assert.equal(keyboard.read(0).dir, DOWN);
  release('ArrowDown');
  assert.equal(keyboard.read(0).dir, LEFT, 'we fall back on the key still held');
  release('ArrowLeft');
  assert.equal(keyboard.read(0).dir, -1);
});

test('the bomb is a pulse: read once, it falls back', () => {
  const { keyboard, press } = bench();
  press('Space');
  assert.equal(keyboard.read(0).drop, true);
  assert.equal(keyboard.read(0).drop, false, 'holding the key does not drop a bomb per step');
  press('Space');
  assert.equal(keyboard.read(0).drop, true);
});

test('the keyboard auto-repeat does not count', () => {
  const { keyboard, press } = bench();
  press('Space', { repeat: true });
  assert.equal(keyboard.read(0).drop, false);
});

test('the trigger is a pulse as well', () => {
  const { keyboard, press } = bench();
  press('Enter');
  assert.equal(keyboard.read(0).detonate, true);
  assert.equal(keyboard.read(0).detonate, false);
});

test('typing in an input field drops no bomb', () => {
  const { keyboard, press } = bench();
  press('Space', { target: { tagName: 'INPUT' } });
  assert.equal(keyboard.read(0).drop, false);
  press('ArrowUp', { target: { tagName: 'TEXTAREA' } });
  assert.equal(keyboard.read(0).dir, -1);
});

test('losing focus releases the held keys', () => {
  // Otherwise the bomber sets off into a wall on its own until the tab is back.
  const { keyboard, press, target } = bench();
  press('ArrowUp');
  assert.equal(keyboard.read(0).dir, UP);
  target.dispatchEvent(new Event('blur'));
  assert.equal(keyboard.read(0).dir, -1);
});

test('interface shortcuts never reach the engine', () => {
  const { keyboard, press } = bench();
  let calls = 0;
  keyboard.shortcut('KeyN', () => {
    calls += 1;
  });
  press('KeyN');
  assert.equal(calls, 1);
  assert.deepEqual(keyboard.read(0), { dir: -1, drop: false, detonate: false });
});

test('an unknown seat returns an empty intent rather than throwing', () => {
  const { keyboard } = bench();
  assert.deepEqual(keyboard.read(9), { dir: -1, drop: false, detonate: false });
});

test('the two key sets do not tread on each other', () => {
  const codes = new Set();
  for (const set of KEYS) {
    for (const role of ['up', 'down', 'left', 'right', 'bomb', 'trigger']) {
      assert.equal(codes.has(set[role]), false, `${set[role]} is used twice`);
      codes.add(set[role]);
    }
  }
});
