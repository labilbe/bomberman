/**
 * Gamepads are tested without a browser: `createGamepads` is handed its probe
 * instead of calling `navigator.getGamepads` itself. That is the whole point of
 * not having hard-coded the API in the module — and here it counts double,
 * because a browser only returns a gamepad once a human has pressed a button on
 * it, which no automated test can do.
 *
 * Many tests start with a read at rest. That is not a formality: the first read
 * of a gamepad only records the state of its buttons, without drawing a pulse
 * from it. That is what keeps landing on the page with a trigger held down from
 * dropping a bomb nobody asked for.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createGamepads, DPAD, BUTTONS, DEAD_ZONE } from '../src/input/gamepads.js';
import { UP, DOWN, LEFT, RIGHT } from '../src/engine/constants.js';

/** A gamepad at rest, to be tilted step by step. */
function gamepad({ dpad = [], buttons: pressed = [], axes = [0, 0] } = {}) {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  for (const role of dpad) buttons[DPAD[role]] = { pressed: true, value: 1 };
  for (const role of pressed) buttons[BUTTONS[role]] = { pressed: true, value: 1 };
  return { connected: true, buttons, axes };
}

/** A bench where anything can be plugged back in between two reads. */
function bench(initial = [gamepad()]) {
  let plugged = initial;
  const gamepads = createGamepads({ probe: () => plugged, count: 2 });
  return {
    gamepads,
    plug: (list) => { plugged = list; },
    read: (seat = 0) => gamepads.read(seat),
  };
}

test('the d-pad drives the bomber', () => {
  const b = bench([gamepad({ dpad: ['right'] })]);
  assert.equal(b.read().dir, RIGHT);
});

test('the direction follows the last direction still held', () => {
  const b = bench([gamepad({ dpad: ['left'] })]);
  assert.equal(b.read().dir, LEFT);

  // The player anticipates their turn: they push up without releasing left.
  b.plug([gamepad({ dpad: ['left', 'up'] })]);
  assert.equal(b.read().dir, UP);

  // They finally release left: the direction must not change for that.
  b.plug([gamepad({ dpad: ['up'] })]);
  assert.equal(b.read().dir, UP);
});

test('the stick takes over when the d-pad is silent', () => {
  const b = bench([gamepad({ axes: [0, -1] })]);
  assert.equal(b.read().dir, UP);
});

test('a stick at rest does not make the bomber walk', () => {
  // A worn gamepad never returns exactly zero at rest.
  const b = bench([gamepad({ axes: [0.2, -0.3] })]);
  assert.equal(b.read().dir, -1);
});

test('on a diagonal, the axis tilted furthest wins', () => {
  const b = bench([gamepad({ axes: [0.9, 0.6] })]);
  assert.equal(b.read().dir, RIGHT);

  b.plug([gamepad({ axes: [0.6, 0.9] })]);
  assert.equal(b.read().dir, DOWN);
});

test('just under the threshold the stick does not count; just over, it does', () => {
  const b = bench([gamepad({ axes: [DEAD_ZONE - 0.01, 0] })]);
  assert.equal(b.read().dir, -1);

  b.plug([gamepad({ axes: [DEAD_ZONE, 0] })]);
  assert.equal(b.read().dir, RIGHT);
});

test('the d-pad wins over the stick', () => {
  const b = bench([gamepad({ dpad: ['up'], axes: [1, 0] })]);
  assert.equal(b.read().dir, UP);
});

test('the bomb is a pulse: read once, it falls back', () => {
  const b = bench();
  b.read();

  b.plug([gamepad({ buttons: ['bomb'] })]);
  assert.equal(b.read().drop, true);
  // The button is still pressed, but the edge is past.
  assert.equal(b.read().drop, false);
});

test('releasing then pressing again drops another bomb', () => {
  const b = bench();
  b.read();

  b.plug([gamepad({ buttons: ['bomb'] })]);
  assert.equal(b.read().drop, true);

  b.plug([gamepad()]);
  assert.equal(b.read().drop, false);

  b.plug([gamepad({ buttons: ['bomb'] })]);
  assert.equal(b.read().drop, true);
});

test('the trigger is a pulse as well', () => {
  const b = bench();
  b.read();

  b.plug([gamepad({ buttons: ['trigger'] })]);
  const first = b.read();
  assert.equal(first.detonate, true);
  assert.equal(first.drop, false);
  assert.equal(b.read().detonate, false);
});

test('a button already held on arrival drops no bomb', () => {
  // We discover the gamepad with the trigger held: that is a state, not an edge.
  const b = bench([gamepad({ buttons: ['bomb'] })]);
  assert.equal(b.read().drop, false);
  assert.equal(b.read().drop, false);

  // It really has to be released and pressed again to count.
  b.plug([gamepad()]);
  b.read();
  b.plug([gamepad({ buttons: ['bomb'] })]);
  assert.equal(b.read().drop, true);
});

test('two gamepads drive two distinct seats', () => {
  const b = bench([gamepad(), gamepad()]);
  b.read(0);
  b.read(1);

  b.plug([
    gamepad({ dpad: ['up'] }),
    gamepad({ dpad: ['down'], buttons: ['bomb'] }),
  ]);

  assert.equal(b.read(0).dir, UP);
  const second = b.read(1);
  assert.equal(second.dir, DOWN);
  assert.equal(second.drop, true);
});

test('an empty slot does not shift the seats', () => {
  // The browser leaves a hole when one is unplugged: without filtering, the
  // remaining player would lose their gamepad although it is still plugged in.
  const b = bench([null, gamepad({ dpad: ['right'] })]);
  assert.equal(b.read(0).dir, RIGHT);
});

test('a gamepad announced as disconnected is ignored', () => {
  const unplugged = gamepad({ dpad: ['right'] });
  unplugged.connected = false;
  const b = bench([unplugged]);
  assert.equal(b.read(0).dir, -1);
});

test('unplugging mid-run releases the direction', () => {
  const b = bench([gamepad({ dpad: ['right'] })]);
  assert.equal(b.read().dir, RIGHT);

  b.plug([]);
  assert.equal(b.read().dir, -1);

  // And when it comes back, the direction does not return on its own.
  b.plug([gamepad()]);
  assert.equal(b.read().dir, -1);
});

test('plugging back in with the button already pressed drops no bomb', () => {
  const b = bench();
  b.read();

  b.plug([gamepad({ buttons: ['bomb'] })]);
  assert.equal(b.read().drop, true);

  b.plug([]);
  b.read();

  // Same button, still held, gamepad found again: nothing must go off.
  b.plug([gamepad({ buttons: ['bomb'] })]);
  assert.equal(b.read().drop, false);
});

test('forget releases everything, and drops no bomb when it comes back', () => {
  const b = bench([gamepad({ dpad: ['up'], buttons: ['bomb'] })]);
  b.read();

  b.gamepads.forget();
  assert.equal(b.read().dir, UP);
  assert.equal(b.read().drop, false);

  b.plug([gamepad()]);
  assert.equal(b.read().dir, -1);
});

test('howMany counts the gamepads actually plugged in', () => {
  const b = bench([gamepad(), null, gamepad()]);
  assert.equal(b.gamepads.howMany(), 2);

  b.plug([]);
  assert.equal(b.gamepads.howMany(), 0);
});

test('with no gamepad, the intent is empty rather than thrown', () => {
  const b = bench([]);
  assert.deepEqual(b.read(0), { dir: -1, drop: false, detonate: false });
});

test('an unknown seat returns an empty intent', () => {
  const b = bench([gamepad({ dpad: ['up'] })]);
  assert.deepEqual(b.read(7), { dir: -1, drop: false, detonate: false });
});

test('an analogue trigger counts as pressed past halfway', () => {
  const b = bench();
  b.read();

  const pad = gamepad();
  pad.buttons[BUTTONS.bomb] = { pressed: false, value: 0.8 };
  b.plug([pad]);
  assert.equal(b.read().drop, true);
});
