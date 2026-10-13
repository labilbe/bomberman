import test from 'node:test';
import assert from 'node:assert/strict';

import { step, advanceBy } from '../src/engine/step.js';
import { ray } from '../src/engine/explosion.js';
import { drop } from '../src/engine/bombs.js';
import { index, cellOnAxis } from '../src/engine/grid.js';
import {
  FUSE_STEPS,
  FLAME_STEPS,
  BRICK,
  EMPTY,
  RIGHT,
  LEFT,
  UP,
  HALF_DEADLY,
  HALF_BOMBER,
  TRIGGERS_PER_BONUS,
  FALL_STEPS,
} from '../src/engine/constants.js';
import { BONUS_CODES } from '../src/engine/bonus.js';
import { bareArena, brick, item, place, input, events } from './helpers.js';

/**
 * Makes a player's oldest bomb explode on the spot.
 *
 * We shorten its fuse rather than press the trigger: the trigger only commands
 * bombs dropped WAITING, and the explosion tests drop ordinary ones. It is in
 * fact exactly what the engine does on detonation — a fuse at 1, which goes off
 * when the step is collected.
 */
function detonate(state, seat) {
  const theirs = state.bombs.filter((bomb) => bomb.place === seat);
  const chosen = theirs.sort((a, b) => a.id - b.id)[0];
  if (chosen) chosen.fuse = 1;
  step(state, input(seat, {}));
}

test('the cross stops at the first hard wall', () => {
  const state = bareArena();
  // (2,2) is a checkerboard pillar: the branch upwards from (2,3) stops before
  // it.
  const branch = ray(state, 2, 3, UP, 5);
  assert.deepEqual(branch.cells, []);
  assert.equal(branch.brick, null);
});

test('the cross destroys one brick and stops there', () => {
  const state = bareArena();
  brick(state, 5, 3);
  brick(state, 6, 3);
  const branch = ray(state, 3, 3, RIGHT, 5);
  // The brick's cell is NOT set alight: the brick absorbs the blast.
  assert.deepEqual(branch.cells, [[4, 3]]);
  assert.deepEqual(branch.brick, [5, 3]);

  const player = place(state, 0, 3, 3);
  player.range = 5;
  step(state, input(0, { drop: true }));
  detonate(state, 0);
  assert.equal(events(state, 'brick').length, 1, 'the first is announced as coming down');
  assert.equal(state.tiles[index(5, 3)], BRICK, 'but it still blocks during its fall');

  advanceBy(state, FALL_STEPS, input(0, {}));
  assert.equal(state.tiles[index(5, 3)], EMPTY, 'the fall over, the cell opens');
  assert.equal(state.tiles[index(6, 3)], BRICK, 'the second holds');
});

test('the boom event carries the real length of all four branches', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 3);
  player.range = 2;
  step(state, input(0, { drop: true }));
  detonate(state, 0);
  const [boom] = events(state, 'boom');
  assert.ok(boom, 'a boom event has to go out');
  const [, , cx, cy, up, right, down, left] = boom;
  assert.deepEqual([cx, cy], [3, 3]);
  assert.deepEqual([up, right, down, left], [2, 2, 2, 2]);
});

test('a chain of five bombs resolves within the same step', () => {
  const state = bareArena();
  const player = place(state, 0, 1, 1);
  player.bombs = 5;
  // Dropped by the engine and not by the button: two presses close together
  // would mean BURST, and it is the chain we measure here, not the gesture.
  for (const cx of [1, 2, 3, 4, 5]) {
    place(state, 0, cx, 1);
    drop(state, state.players[0]);
  }
  step(state, input(0, {}));
  assert.equal(state.bombs.length, 5);

  place(state, 0, 9, 9);
  detonate(state, 0);
  assert.equal(state.bombs.length, 0, 'everything has to go off within the same step');
  assert.equal(events(state, 'boom').length, 5);
  assert.equal(player.dropped, 0);
});

test('two bombs that set each other off only explode once', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 3);
  player.bombs = 2;
  drop(state, player);
  place(state, 0, 4, 3);
  drop(state, player);
  step(state, input(0, {}));

  place(state, 0, 9, 9);
  detonate(state, 0);
  assert.equal(events(state, 'boom').length, 2);
  assert.equal(state.bombs.length, 0);
});

test('two bombers in the same flame die on the same step', () => {
  const state = bareArena({ places: 2 });
  const one = place(state, 0, 3, 3);
  const two = place(state, 1, 4, 3);
  one.range = 2;

  step(state, input(0, { drop: true }));
  detonate(state, 0);
  assert.equal(one.alive, false);
  assert.equal(two.alive, false);
  assert.equal(one.diedAt, two.diedAt);
  assert.equal(events(state, 'death').length, 2);
});

test('a revealed bonus survives the explosion that uncovers it', () => {
  const state = bareArena();
  brick(state, 5, 3);
  item(state, 5, 3, 128 + BONUS_CODES.FLAME);
  const player = place(state, 0, 3, 3);
  player.range = 3;

  step(state, input(0, { drop: true }));
  detonate(state, 0);
  // It only appears once the brick has fallen: before that, it would be visible
  // under a brick still standing.
  assert.equal(state.items[index(5, 3)], 128 + BONUS_CODES.FLAME, 'still hidden');
  // The fall is already one step in when the explosion happens: the cell
  // therefore opens FALL_STEPS - 1 steps later, and it is on that step that the
  // event goes out — events only live for one step.
  advanceBy(state, FALL_STEPS - 1, input(0, {}));
  assert.equal(state.items[index(5, 3)], BONUS_CODES.FLAME, 'it has to appear');
  assert.equal(events(state, 'item').length, 1);
  assert.equal(events(state, 'itemgone').length, 0);

  // And it survives as long as the flame that uncovered it is still burning.
  advanceBy(state, FLAME_STEPS + 2, input(0, {}));
  assert.equal(state.items[index(5, 3)], BONUS_CODES.FLAME);
});

test('a bonus already visible is destroyed by a fresh flame', () => {
  const state = bareArena();
  item(state, 5, 3, BONUS_CODES.BOMB);
  const player = place(state, 0, 3, 3);
  player.range = 3;

  step(state, input(0, { drop: true }));
  detonate(state, 0);
  assert.equal(state.items[index(5, 3)], 0);
  assert.equal(events(state, 'itemgone').length, 1);
});

test('you pick a bonus up by walking over it', () => {
  const state = bareArena();
  item(state, 4, 3, BONUS_CODES.BOMB);
  const player = place(state, 0, 3, 3);
  assert.equal(player.bombs, 1);

  advanceBy(state, 20, input(0, { dir: RIGHT }));
  assert.equal(player.bombs, 2);
  assert.equal(state.items[index(4, 3)], 0);
});

test('a bomber that dies does not pick up the bonus under its feet', () => {
  // The setup: the flame touches the cell (3,3), which the victim only bites
  // into, while its CENTRE is at (3,4) with an untouched bonus. The bonus is
  // therefore not burnt, and only the "burn before picking up" order can keep it
  // from being pocketed by a corpse.
  const state = bareArena({ places: 2 });
  const killer = place(state, 1, 3, 2);
  killer.triggers = TRIGGERS_PER_BONUS;
  // The range is set HERE and must not follow the starting kit: the whole setup
  // rests on the flame stopping at (3,3). At two cells, it would reach (3,4),
  // burn the bonus, and the test would no longer check anything.
  killer.range = 1;
  const victim = place(state, 0, 3, 4);
  victim.y = 4300;

  // The bomb is dropped without playing a step, and the bonus sown just after:
  // otherwise the victim would have picked it up at leisure before the
  // explosion.
  drop(state, killer);
  item(state, 3, 4, BONUS_CODES.BOMB);

  step(state, input(1, { detonate: true }));
  assert.equal(victim.alive, false, 'it has to die of the flame at (3,3)');
  assert.equal(state.items[index(3, 4)], BONUS_CODES.BOMB, 'the bonus is not burnt');
  assert.equal(victim.bombs, 1, 'no posthumous bonus');
  assert.equal(events(state, 'pick').length, 0);
});

test('the flame goes out after its duration', () => {
  const state = bareArena();
  place(state, 0, 3, 3);
  step(state, input(0, { drop: true }));
  place(state, 0, 9, 9);
  detonate(state, 0);
  assert.ok(state.flames.length > 0);
  advanceBy(state, FLAME_STEPS, input(0, {}));
  assert.equal(state.flames.length, 0);
});

test('a bomb explodes on its own at the end of its fuse', () => {
  const state = bareArena();
  place(state, 0, 7, 7);
  step(state, input(0, { drop: true }));
  place(state, 0, 1, 1);
  advanceBy(state, FUSE_STEPS - 2, input(0, {}));
  assert.equal(state.bombs.length, 1, 'it must not go off before time');
  advanceBy(state, 3, input(0, {}));
  assert.equal(state.bombs.length, 0);
});

test('a player sheltered behind a brick survives the hole opening', () => {
  // The bug reported: the brick's cell was emptied AND set alight on the same
  // step. The player on the right side of the shelter walked into the hole that
  // had just opened and died, punished for having taken cover.
  const state = bareArena();
  brick(state, 5, 3);
  const dropper = place(state, 0, 3, 3);
  dropper.range = 4;
  const sheltered = place(state, 1, 6, 3);

  step(state, input(0, { drop: true }));
  detonate(state, 0);
  assert.equal(sheltered.alive, true, 'the sheltered one must feel nothing');
  // The brick blocks for as long as it takes to fall: the hole only opens after.
  advanceBy(state, FALL_STEPS, input(0, {}));
  assert.equal(state.tiles[index(5, 3)], EMPTY, 'the brick must have finished falling');

  // It now walks towards the explosion, and stops as soon as it is in the hole
  // that has just opened. We go no further on purpose: the next cell really is
  // burning, and dying there would be fair.
  let steps = 0;
  while (cellOnAxis(sheltered.x) !== 5 && steps < FLAME_STEPS) {
    step(state, input(1, { dir: LEFT }));
    steps += 1;
  }

  assert.equal(cellOnAxis(sheltered.x), 5, 'it has to reach the hole before the fire is out');
  assert.ok(state.flames.length > 0, 'and the neighbouring cell must still be burning');
  assert.equal(sheltered.alive, true, 'walking into the hole must not kill');
});

test('the cell of a fallen brick does not burn', () => {
  const state = bareArena();
  brick(state, 5, 3);
  const player = place(state, 0, 3, 3);
  player.range = 4;

  step(state, input(0, { drop: true }));
  detonate(state, 0);

  const alight = state.flames.some((flame) => flame.cx === 5 && flame.cy === 3);
  assert.equal(alight, false);
  // The cell just before does burn: the blast goes as far as the brick.
  assert.ok(state.flames.some((flame) => flame.cx === 4 && flame.cy === 3));
});

test('you can stand in the hole while the neighbouring cell burns', () => {
  // The guarantee that counts for the player: the hole opened by the brick is a
  // shelter, and not merely a passage where you die a step later.
  const state = bareArena({ places: 2 });
  brick(state, 5, 3);
  const dropper = place(state, 0, 3, 3);
  dropper.range = 4;

  step(state, input(0, { drop: true }));
  detonate(state, 0);
  assert.ok(state.flames.some((f) => f.cx === 4 && f.cy === 3), 'the neighbouring cell must burn');

  // We stand in the middle of the hole, and do not move again.
  const sheltered = place(state, 1, 5, 3);
  advanceBy(state, FLAME_STEPS + 2, input(1, {}));
  assert.equal(sheltered.alive, true);
});

test('the box that catches fire is smaller than the one that bumps', () => {
  // The two used to be the same, and you died before reaching the flame. This
  // test locks the distinction down, not the exact value.
  assert.ok(HALF_DEADLY < HALF_BOMBER);
  // It stays non-zero: a bomber half in the fire has to die.
  assert.ok(HALF_DEADLY > 0);
});

test('a bomber well into the flame does die', () => {
  const state = bareArena({ places: 2 });
  const dropper = place(state, 0, 3, 3);
  dropper.range = 2;
  step(state, input(0, { drop: true }));

  // Centred in the cell next to the blast, but well bitten into it.
  const victim = place(state, 1, 5, 3);
  victim.x = 5 * 1024 + 120;
  detonate(state, 0);
  assert.equal(victim.alive, false);
});

test('you do not walk through a brick while it is falling', () => {
  // The flaw this fixes: the cell emptied at the instant of the explosion, and
  // the falling animation was only scenery painted over nothing. So you walked
  // through a brick you could still see falling.
  const state = bareArena({ places: 2 });
  brick(state, 5, 3);
  const dropper = place(state, 0, 3, 3);
  dropper.range = 4;
  const walker = place(state, 1, 6, 3);

  step(state, input(0, { drop: true }));
  detonate(state, 0);

  // It pushes towards the brick for the whole fall: the brick has to hold it.
  advanceBy(state, FALL_STEPS - 2, input(1, { dir: LEFT }));
  assert.equal(state.tiles[index(5, 3)], BRICK, 'it is still there');
  assert.equal(cellOnAxis(walker.x), 6, 'and it could not get in');
});

test('the cell opens when the fall ends, and the way with it', () => {
  const state = bareArena({ places: 2 });
  brick(state, 5, 3);
  const dropper = place(state, 0, 3, 3);
  dropper.range = 4;
  const walker = place(state, 1, 6, 3);

  step(state, input(0, { drop: true }));
  detonate(state, 0);
  // Just what it takes to step into the freed cell, without crossing it.
  advanceBy(state, FALL_STEPS + 6, input(1, { dir: LEFT }));

  assert.equal(state.tiles[index(5, 3)], EMPTY);
  assert.equal(cellOnAxis(walker.x), 5, 'it steps in once the brick has fallen');
});

test('a second blast does not restart a brick already coming down', () => {
  // It still blocks, so the blast stops there — but its animation and its
  // countdown do not start again from scratch, otherwise a brick under fire
  // would never fall.
  const state = bareArena();
  brick(state, 5, 3);
  const player = place(state, 0, 3, 3);
  player.range = 4;
  player.bombs = 2;

  step(state, input(0, { drop: true }));
  detonate(state, 0);
  assert.equal(state.rubble.length, 1);

  // A second bomb, in the same spot, during the fall.
  place(state, 0, 3, 3);
  step(state, input(0, { drop: true }));
  detonate(state, 0);
  assert.equal(state.rubble.length, 1, 'a single fall in progress');
  assert.equal(events(state, 'brick').length, 0, 'and no further announcement');
});

test('a bonus on the ground stops the branch, like a brick', () => {
  // Otherwise a bonus was destroyed while covering nothing, and two players
  // separated by a bonus were exposed to each other.
  const state = bareArena();
  item(state, 5, 3, BONUS_CODES.BOMB);
  const branch = ray(state, 3, 3, RIGHT, 5);

  // Its cell does burn: a bonus does not block the way, you can stand on it, so
  // you can die on it. That is the difference from a brick.
  assert.deepEqual(branch.cells, [[4, 3], [5, 3]]);
  assert.equal(branch.brick, null, 'no brick in there');
});

test('what the bonus covers survives the explosion', () => {
  const state = bareArena();
  item(state, 5, 3, BONUS_CODES.BOMB);
  item(state, 6, 3, BONUS_CODES.FLAME);
  const player = place(state, 0, 3, 3);
  player.range = 5;
  step(state, input(0, { drop: true }));
  detonate(state, 0);

  assert.equal(state.items[index(5, 3)], 0, 'the first is burnt');
  assert.equal(state.items[index(6, 3)], BONUS_CODES.FLAME, 'the second is sheltered behind it');
});

test('a corpse drops everything it had picked up', () => {
  // Without that, killing the best-equipped player removed their bonuses from
  // the round for good, and the survivor had nothing to covet any more.
  const state = bareArena({ places: 3 });
  const rich = place(state, 0, 7, 7);
  rich.bombs = 3;      // two bomb bonuses
  rich.range = 4;      // two flame bonuses
  rich.kick = true;    // one
  rich.glove = true;   // one
  rich.jelly = true;   // one
  rich.triggers = 3;   // a part-used pack

  const killer = place(state, 1, 7, 5);
  killer.range = 1;
  place(state, 2, 13, 11);
  drop(state, killer);
  place(state, 1, 13, 1);
  place(state, 0, 7, 6);
  detonate(state, 1);

  assert.equal(rich.alive, false, 'it has to die');
  const sown = events(state, 'item');
  assert.equal(sown.length, 8, 'two bombs, two flames, kick, glove, jelly, trigger');
  const names = sown.map((event) => event[3]).sort();
  assert.deepEqual(names, ['bomb', 'bomb', 'flame', 'flame', 'jelly', 'kick', 'punch', 'trigger']);

  // And each one is laid on the grid, on a cell of its own.
  const cells = new Set(sown.map((event) => `${event[1]},${event[2]}`));
  assert.equal(cells.size, 8, 'one bonus per cell, never stacked');
});

test('the bonuses dropped do not fall into the flames', () => {
  const state = bareArena({ places: 3 });
  const rich = place(state, 0, 7, 7);
  rich.kick = true;
  const killer = place(state, 1, 7, 5);
  killer.range = 3;
  place(state, 2, 13, 11);
  drop(state, killer);
  place(state, 1, 13, 1);
  place(state, 0, 7, 6);
  detonate(state, 1);

  const [sown] = events(state, 'item');
  assert.ok(sown, 'the kick has to be dropped somewhere');
  const [, cx, cy] = sown;
  assert.equal(
    state.flames.some((flame) => flame.cx === cx && flame.cy === cy),
    false,
    'and never on a burning cell',
  );
});

test('a corpse with no bonus drops nothing', () => {
  const state = bareArena({ places: 3 });
  place(state, 0, 7, 7);
  const killer = place(state, 1, 7, 5);
  killer.range = 3;
  place(state, 2, 13, 11);
  drop(state, killer);
  place(state, 1, 13, 1);
  place(state, 0, 7, 6);
  detonate(state, 1);

  assert.equal(state.players[0].alive, false);
  assert.equal(events(state, 'item').length, 0);
});

test('the loot falls at random across the arena, and not around the body', () => {
  // Around the body, the bonuses would have fallen into the blast that has just
  // killed it, and the killer — alone on the spot — would have picked them all
  // up on the way through.
  const sowing = (seed) => {
    const state = bareArena({ places: 3, seed });
    const rich = place(state, 0, 7, 7);
    rich.bombs = 4;
    rich.range = 5;
    rich.kick = true;
    const killer = place(state, 1, 7, 5);
    killer.range = 1;
    place(state, 2, 13, 11);
    drop(state, killer);
    place(state, 1, 13, 1);
    place(state, 0, 7, 6);
    detonate(state, 1);
    assert.equal(rich.alive, false);
    return events(state, 'item').map((event) => [event[1], event[2]]);
  };

  const first = sowing(1);
  assert.equal(first.length, 7, 'three bombs, three flames, one kick');
  // No stacking, and the lot does not huddle against the corpse's cell.
  assert.equal(new Set(first.map((c) => c.join())).size, first.length);
  const close = first.filter(([cx, cy]) => Math.abs(cx - 7) <= 1 && Math.abs(cy - 7) <= 1);
  assert.ok(close.length < first.length, 'they are not all neighbours of the body');

  // Same seed, same sowing: the draw comes from the state's generator, not from
  // the browser's randomness. Without that, relay and replay would diverge.
  assert.deepEqual(sowing(1), first);
  assert.notDeepEqual(sowing(7), first, 'another seed sows elsewhere');
});
