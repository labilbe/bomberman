import test from 'node:test';
import assert from 'node:assert/strict';

import { step, advanceBy } from '../src/engine/step.js';
import { recentre, passable } from '../src/engine/collision.js';
import { cellOnAxis, centreOnAxis, boxOnCell } from '../src/engine/grid.js';
import {
  UNITS,
  HALF_BOMBER,
  BASE_SPEED,
  MAX_SPEED,
  UP,
  DOWN,
  LEFT,
  RIGHT,
} from '../src/engine/constants.js';
import { bareArena, brick, place, input } from './helpers.js';

test('recentre converges without ever overshooting the centre', () => {
  const centre = centreOnAxis(3);
  let v = centre - 100;
  for (let i = 0; i < 50; i += 1) v = recentre(v, 20);
  assert.equal(v, centre);

  // The last step is truncated: we do not jump over the centre.
  assert.equal(recentre(centre - 7, 20), centre);
  assert.equal(recentre(centre + 7, 20), centre);
  assert.equal(recentre(centre, 20), centre);
});

test('a bomber does not go through a wall, even at maximum speed', () => {
  for (const speed of [BASE_SPEED, MAX_SPEED, MAX_SPEED * 3]) {
    const state = bareArena();
    const player = place(state, 0, 1, 1);
    player.speed = speed;
    advanceBy(state, 60, input(0, { dir: LEFT }));
    // Column 0 is a wall: the box has to stay in column 1.
    assert.equal(cellOnAxis(player.x - HALF_BOMBER), 1, `speed ${speed}`);
    assert.ok(player.x >= UNITS + HALF_BOMBER, `speed ${speed}`);
  }
});

test('a bomber wedges against the wall instead of stopping short of it', () => {
  const state = bareArena();
  const player = place(state, 0, 1, 1);
  advanceBy(state, 40, input(0, { dir: UP }));
  // In contact: the top of the box is one sub-unit from row 1.
  assert.equal(player.y - HALF_BOMBER, UNITS + 1);
});

test('recentring unblocks a turn begun too early', () => {
  // A vertical corridor in column 1, open to the right at (2,3) only.
  const state = bareArena();
  brick(state, 2, 1);
  brick(state, 2, 2);
  const player = place(state, 0, 1, 1);

  // We go down until the bomber's CENTRE is in row 3, but not yet in the middle:
  // its box still bites into row 2, whose way out is walled. That is the turn
  // asked for a handful of sub-units too early, the gesture that makes clones
  // without recentring unplayable.
  advanceBy(state, 19, input(0, { dir: DOWN }));
  assert.equal(cellOnAxis(player.y), 3);
  assert.notEqual(player.y, centreOnAxis(3), 'the bomber has to be offset within its row');

  advanceBy(state, 40, input(0, { dir: RIGHT }));
  assert.ok(cellOnAxis(player.x) >= 2, `x = ${player.x}, cell ${cellOnAxis(player.x)}`);
  assert.equal(player.y, centreOnAxis(3), 'it has to have lined up in the corridor');
});

test('you walk through your own bomb while on it, and never after', () => {
  const state = bareArena();
  const player = place(state, 0, 1, 1);

  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];
  assert.equal(player.onBomb, bomb.id);
  assert.equal(passable(state, player, 1, 1), true);

  // We move away until the bomb's cell is no longer touched.
  let releases = 0;
  for (let i = 0; i < 60; i += 1) {
    step(state, input(0, { dir: RIGHT }));
    if (player.onBomb === null) {
      releases += 1;
      break;
    }
  }
  assert.equal(releases, 1, 'the permission has to drop on leaving');
  assert.equal(boxOnCell(player.x, player.y, 1, 1), false);
  assert.equal(passable(state, player, 1, 1), false);

  // And there is no coming back to it.
  advanceBy(state, 40, input(0, { dir: LEFT }));
  assert.equal(boxOnCell(player.x, player.y, 1, 1), false);
  assert.equal(cellOnAxis(player.x), 2);
});

test('the permission drops too when the bomb explodes underfoot', () => {
  const state = bareArena();
  const player = place(state, 0, 1, 1);
  step(state, input(0, { drop: true }));
  const id = player.onBomb;
  assert.ok(id);

  // Motionless: it dies, and its permission must not survive the bomb, whose id
  // will be handed out again on the next drop.
  advanceBy(state, 200, input(0, {}));
  assert.equal(state.bombs.length, 0);
  assert.equal(player.onBomb, null);
  assert.equal(player.alive, false);
});

test('bombers do not block each other', () => {
  const state = bareArena({ places: 2 });
  const one = place(state, 0, 1, 1);
  place(state, 1, 3, 1);
  advanceBy(state, 40, input(0, { dir: RIGHT }));
  assert.ok(cellOnAxis(one.x) >= 3, 'the first has to have gone through the second');
});

test('a missing direction leaves the bomber motionless', () => {
  const state = bareArena();
  const player = place(state, 0, 1, 1);
  const before = { x: player.x, y: player.y };
  advanceBy(state, 30, []);
  assert.deepEqual({ x: player.x, y: player.y }, before);
  assert.equal(player.walking, false);
});

/**
 * Pushes a bomber in one direction and returns the cell it ends up in.
 *
 * The bare arena has its pillars at (even, even): (4,5) is free, (5,5) too. So
 * we place the rock by hand to control exactly what blocks.
 */
function shove(state, player, dir, steps = 40) {
  for (let i = 0; i < steps; i += 1) step(state, input(player.place, { dir }));
  return { cx: cellOnAxis(player.x), cy: cellOnAxis(player.y) };
}

test('flush against a pillar edge, the bomber lines up with the free corridor', () => {
  // The flaw this fixes: recentring brought the bomber back to the centre of ITS
  // row — the one that is blocked — so it pushed it into the pillar instead of
  // out of it. You had to release the key, step aside, set off again.
  //
  // The situation is the one you live with all the time: you follow the lattice
  // of pillars, which occupy the (even, even) cells. From (3,4) to the right,
  // the pillar (4,4) blocks, but rows 3 and 5 are open.
  const state = bareArena({ places: 1 });
  const player = place(state, 0, 3, 4);
  player.y = centreOnAxis(4) - Math.round(0.3 * UNITS);

  const arrival = shove(state, player, RIGHT);
  assert.equal(arrival.cy, 3, 'it lined up with the row above');
  assert.ok(arrival.cx > 3, 'and it got past the pillar');
});

test('the slide works downwards too, and on the vertical axis', () => {
  const down = bareArena({ places: 1 });
  const a = place(down, 0, 3, 4);
  a.y = centreOnAxis(4) + Math.round(0.3 * UNITS);
  assert.equal(shove(down, a, RIGHT).cy, 5, 'downwards');

  const vertical = bareArena({ places: 1 });
  const b = place(vertical, 0, 4, 3);
  b.x = centreOnAxis(4) - Math.round(0.3 * UNITS);
  assert.equal(shove(vertical, b, DOWN).cx, 3, 'and on the vertical axis');
});

test('centred in its corridor, the bomber stops dead', () => {
  // The slide must not go off by itself: a bomber properly lined up pushing
  // against a wall stays against the wall. Otherwise you drift without having
  // asked for it, and you can no longer hug a pillar to take cover.
  const state = bareArena({ places: 1 });
  const player = place(state, 0, 3, 4);
  const start = player.y;

  const arrival = shove(state, player, RIGHT);
  assert.equal(arrival.cx, 3, 'it stays blocked');
  assert.equal(player.y, start, 'and does not drift');
});

test('the slide threshold is the bomber box, not a chosen value', () => {
  // The bomber slides as soon as its box BITES into the neighbouring corridor,
  // and not before: half a tile minus half the box, that is 0.13 tile of offset.
  const threshold = UNITS / 2 - HALF_BOMBER;
  const attempt = (offset) => {
    const state = bareArena({ places: 1 });
    const player = place(state, 0, 3, 4);
    player.y = centreOnAxis(4) - offset;
    return shove(state, player, RIGHT).cx > 3;
  };

  assert.equal(attempt(threshold), false, 'just short of the threshold: we stop');
  assert.equal(attempt(threshold + 2), true, 'just past it: we slide');
});

test("somebody else's bomb dropped underfoot does not lock you in", () => {
  // Two bombers share a square every time they cross: they do not collide with
  // each other. The one who dropped used to walk away leaving the other walled
  // in on its own square, with nothing to do but wait for the explosion.
  const state = bareArena({ places: 2 });
  const trapped = place(state, 0, 3, 3);
  place(state, 1, 3, 3);

  step(state, input(1, { drop: true }));
  assert.equal(state.bombs.length, 1, 'the bomb is there');

  advanceBy(state, 60, input(0, { dir: RIGHT }));
  assert.ok(cellOnAxis(trapped.x) > 3, 'it got out');
  assert.equal(trapped.alive, true);
});

test('once off that bomb, you no longer walk back onto it', () => {
  // The permission is the one granted on one's own bomb, and it is released the
  // same way: at the far side of the square. Otherwise a bomb dropped under
  // somebody would become a square they own for as long as it burns.
  const state = bareArena({ places: 2 });
  const other = place(state, 0, 3, 3);
  place(state, 1, 3, 3);

  step(state, input(1, { drop: true }));
  advanceBy(state, 40, input(0, { dir: RIGHT }));
  const away = cellOnAxis(other.x);
  assert.ok(away > 3);

  advanceBy(state, 60, input(0, { dir: LEFT }));
  assert.equal(cellOnAxis(other.x), 4, 'it comes back as far as the bomb, no further');
  assert.equal(other.onBomb, null, 'and keeps no permission on it');
});

test('standing beside a bomb grants nothing', () => {
  // The bomber's box overlaps the neighbouring square by a few sub-units:
  // granting the permission there would open a free passage over every bomb in
  // the arena.
  const state = bareArena({ places: 2 });
  const walker = place(state, 0, 3, 3);
  place(state, 1, 4, 3);
  step(state, input(1, { drop: true }));

  advanceBy(state, 60, input(0, { dir: RIGHT }));
  assert.equal(walker.onBomb, null);
  assert.equal(cellOnAxis(walker.x), 3, 'the bomb next door still blocks');
});
