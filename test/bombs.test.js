import test from 'node:test';
import assert from 'node:assert/strict';

import { step, advanceBy } from '../src/engine/step.js';
import { canDrop, bombAt, pushBomb } from '../src/engine/bombs.js';
import { cellOnAxis, centreOnAxis } from '../src/engine/grid.js';
import {
  FUSE_STEPS,
  DOUBLE_TAP_STEPS,
  FLAME_STEPS,
  TRIGGERS_PER_BONUS,
  RIGHT,
  LEFT,
  DOWN,
  UP,
  ROWS,
  COLS,
  FLIGHT_STEPS_PER_CELL,
} from '../src/engine/constants.js';
import { apply, BONUS_CODES } from '../src/engine/bonus.js';
import { bareArena, brick, place, input, events } from './helpers.js';

test('you never drop more bombs than your quota', () => {
  const state = bareArena();
  const player = place(state, 0, 1, 1);
  player.bombs = 2;

  step(state, input(0, { drop: true }));
  assert.equal(state.bombs.length, 1);

  // Second drop: you have to have changed cell, one bomb per cell. We also let
  // the double-tap window pass, failing which the second press would mean burst
  // and would drop ahead instead of underfoot.
  advanceBy(state, DOUBLE_TAP_STEPS + 1, input(0, { dir: RIGHT }));
  step(state, input(0, { drop: true, dir: RIGHT }));
  assert.equal(state.bombs.length, 2);
  assert.equal(player.dropped, 2);

  advanceBy(state, DOUBLE_TAP_STEPS + 1, input(0, { dir: RIGHT }));
  step(state, input(0, { drop: true, dir: RIGHT }));
  assert.equal(state.bombs.length, 2, 'the quota of 2 has to hold');
  assert.equal(canDrop(state, player), false);
});

test('two bombs do not fit on the same cell', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 3);
  player.bombs = 4;
  step(state, input(0, { drop: true }));
  // Spaced out, so that these really are three drops and not a burst.
  advanceBy(state, DOUBLE_TAP_STEPS + 1, input(0, {}));
  step(state, input(0, { drop: true }));
  advanceBy(state, DOUBLE_TAP_STEPS + 1, input(0, {}));
  step(state, input(0, { drop: true }));
  assert.equal(state.bombs.length, 1);
});

test('the quota is given back on the explosion, once only', () => {
  const state = bareArena();
  const player = place(state, 0, 5, 5);
  player.bombs = 3;
  step(state, input(0, { drop: true }));
  assert.equal(player.dropped, 1);
  advanceBy(state, FUSE_STEPS + 5, input(0, {}));
  assert.equal(state.bombs.length, 0);
  assert.equal(player.dropped, 0);
});

test('without the bonus, a bomb cannot be pushed', () => {
  const state = bareArena();
  const dropper = place(state, 0, 3, 3);
  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];

  // We move away, then come back into it: with no kick, it does not move.
  advanceBy(state, 20, input(0, { dir: RIGHT }));
  advanceBy(state, 30, input(0, { dir: LEFT }));
  assert.equal(bomb.cx, 3);
  assert.equal(bomb.slide, null);
  assert.ok(cellOnAxis(dropper.x) >= 4, 'it has to stop against its own bomb');
});

test('with the kick, the bomb slides and snaps to a cell centre', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 3);
  player.kick = true;
  brick(state, 6, 3);

  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];

  // We leave the cell to the left, then come back: the bomber runs into its bomb
  // and pushes it to the right.
  advanceBy(state, 20, input(0, { dir: LEFT }));
  assert.equal(player.onBomb, null, 'it has to have left its bomb');
  advanceBy(state, 40, input(0, { dir: RIGHT }));

  assert.equal(bomb.cx, 5, 'it stops against the brick at (6,3)');
  assert.equal(bomb.cy, 3);
  assert.equal(bomb.slide, null, 'arrived, it no longer slides');
  assert.equal(centreOnAxis(bomb.cx), centreOnAxis(5));
});

test('a kicked bomb reports its departure once only', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 3);
  player.kick = true;
  step(state, input(0, { drop: true }));
  advanceBy(state, 20, input(0, { dir: LEFT }));

  let seen = 0;
  for (let i = 0; i < 40; i += 1) {
    step(state, input(0, { dir: RIGHT }));
    seen += events(state, 'kick').length;
  }
  assert.equal(seen, 1, 'a single kick event for a single kick');
});

test('a bomb flush against the wall does not set off', () => {
  const state = bareArena();
  const player = place(state, 0, 1, 1);
  player.kick = true;
  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];

  // From the right, we push it to the left: the wall in column 0 holds it, and
  // it must not sink into it by one sub-unit.
  advanceBy(state, 20, input(0, { dir: RIGHT }));
  advanceBy(state, 40, input(0, { dir: LEFT }));
  assert.equal(bomb.cx, 1);
  assert.equal(bomb.slide, null);
});

test('the trigger sets off the oldest bomb, and it alone', () => {
  const state = bareArena();
  const player = place(state, 0, 1, 5);
  player.bombs = 3;
  player.triggers = TRIGGERS_PER_BONUS;

  // Three bombs far enough from each other that none chains onto the others: it
  // is the trigger we are trying out, not the chain.
  step(state, input(0, { drop: true }));
  place(state, 0, 5, 5);
  step(state, input(0, { drop: true }));
  place(state, 0, 9, 5);
  step(state, input(0, { drop: true }));
  assert.equal(state.bombs.length, 3);

  const ids = state.bombs.map((bomb) => bomb.id).sort((a, b) => a - b);
  step(state, input(0, { detonate: true }));
  assert.equal(state.bombs.length, 2, 'only one has to go off');
  assert.equal(
    state.bombs.some((bomb) => bomb.id === ids[0]),
    false,
    'the oldest has to have gone',
  );
  assert.equal(player.dropped, 2, 'the quota given back has to follow');
});

test('without the bonus, the trigger does nothing', () => {
  const state = bareArena();
  place(state, 0, 1, 5);
  step(state, input(0, { drop: true }));
  step(state, input(0, { detonate: true }));
  assert.equal(state.bombs.length, 1);
});

test('the bomb stays on its cell as long as it does not slide', () => {
  const state = bareArena();
  place(state, 0, 7, 5);
  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];
  advanceBy(state, 50, input(0, { dir: DOWN }));
  assert.equal(bombAt(state, 7, 5), bomb);
});

test('a trigger bomb has no fuse and waits indefinitely', () => {
  // How the bonus works: with no timer, the trigger is no longer a way of going
  // faster but a weapon of patience.
  const state = bareArena();
  const player = place(state, 0, 7, 7);
  player.triggers = TRIGGERS_PER_BONUS;

  step(state, input(0, { drop: true }));
  const [bomb] = state.bombs;
  assert.equal(bomb.fuse, null, 'it must carry no fuse');

  place(state, 0, 1, 1);
  advanceBy(state, FUSE_STEPS * 3, input(0, {}));
  assert.equal(state.bombs.length, 1, 'three fuses later, it is still there');
  assert.equal(state.bombs[0].fuse, null);
});

test('the trigger sets off the bomb that waits', () => {
  const state = bareArena();
  const player = place(state, 0, 7, 7);
  player.triggers = TRIGGERS_PER_BONUS;

  step(state, input(0, { drop: true }));
  place(state, 0, 1, 1);
  advanceBy(state, FUSE_STEPS * 2, input(0, {}));
  assert.equal(state.bombs.length, 1);

  step(state, input(0, { detonate: true }));
  assert.equal(state.bombs.length, 0);
  assert.equal(events(state, 'boom').length, 1);
  assert.equal(player.dropped, 0, 'and its quota comes back');
});

test('without the trigger, the bomb keeps its fuse', () => {
  const state = bareArena();
  place(state, 0, 7, 7);
  step(state, input(0, { drop: true }));
  assert.equal(state.bombs[0].fuse, FUSE_STEPS - 1);
});

test('a waiting bomb goes off all the same if another reaches it', () => {
  // It does not escape the chains: staying sheltered from a blast would be a
  // privilege the bonus does not grant.
  const state = bareArena({ places: 2 });
  const patient = place(state, 0, 5, 3);
  patient.triggers = TRIGGERS_PER_BONUS;
  step(state, input(0, { drop: true }));

  const neighbour = place(state, 1, 3, 3);
  neighbour.range = 3;
  neighbour.triggers = TRIGGERS_PER_BONUS;
  step(state, input(1, { drop: true }));
  place(state, 1, 9, 9);
  step(state, input(1, { detonate: true }));

  assert.equal(state.bombs.length, 0, 'both have to have gone off');
  assert.equal(events(state, 'boom').length, 2);
});

test("the carrier's death gives a fuse back to its waiting bombs", () => {
  // Otherwise they would stay there until the end of the round: no finger can
  // detonate them any more, and they would block the arena for nothing.
  // Three places, and not two: with two, the round concludes on the carrier's
  // death and the engine freezes before the fuse could burn.
  const state = bareArena({ places: 3 });
  const carrier = place(state, 0, 7, 7);
  carrier.triggers = TRIGGERS_PER_BONUS;
  step(state, input(0, { drop: true }));
  assert.equal(state.bombs[0].fuse, null);
  place(state, 2, 13, 11);

  const killer = place(state, 1, 1, 1);
  killer.triggers = TRIGGERS_PER_BONUS;
  killer.range = 1;
  place(state, 0, 1, 2);
  step(state, input(1, { drop: true }));
  // The killer moves away before pressing: if it died with its victim, only one
  // survivor would be left and the round would conclude.
  place(state, 1, 13, 1);
  step(state, input(1, { detonate: true }));

  assert.equal(carrier.alive, false, 'the carrier does have to die');
  const left = state.bombs.find((bomb) => bomb.place === 0);
  assert.ok(left, 'its distant bomb is still there');
  assert.equal(left.fuse, FUSE_STEPS, 'but it now has a fuse');

  advanceBy(state, FUSE_STEPS + 1, []);
  assert.equal(state.bombs.length, 0, 'and it ends up going off on its own');
});

test('the trigger is a reserve that runs out', () => {
  const state = bareArena();
  const player = place(state, 0, 1, 5);
  player.bombs = 1;
  assert.equal(player.triggers, 0, 'we start without');

  apply(player, BONUS_CODES.TRIGGER);
  assert.equal(player.triggers, TRIGGERS_PER_BONUS);

  // We drop and detonate as many times as there are charges, changing cell every
  // time so as not to get in our own way.
  for (let shot = 0; shot < TRIGGERS_PER_BONUS; shot += 1) {
    place(state, 0, 1 + shot * 2, 5);
    step(state, input(0, { drop: true }));
    assert.equal(state.bombs[0].fuse, null, `shot ${shot}: it has to wait`);
    // We move away before pressing: dropping and blowing yourself up with it is
    // the surest way of testing a single shot only.
    place(state, 0, 13, 11);
    step(state, input(0, { detonate: true }));
    assert.equal(state.bombs.length, 0, `shot ${shot}: it has to go off`);
    assert.equal(player.triggers, TRIGGERS_PER_BONUS - shot - 1);
    // We let the fire go out: the next shot's cell is two cells from this one,
    // hence still in flames, and the player would teleport into them.
    advanceBy(state, FLAME_STEPS, []);
  }

  // Reserve empty: we are back to fused bombs.
  place(state, 0, 11, 5);
  step(state, input(0, { drop: true }));
  assert.equal(state.bombs[0].fuse, FUSE_STEPS - 1, 'the fuse comes back');
  step(state, input(0, { detonate: true }));
  assert.equal(state.bombs.length, 1, 'and the button does nothing any more');
});

test('pressing into thin air does not waste a charge', () => {
  const state = bareArena();
  const player = place(state, 0, 1, 5);
  apply(player, BONUS_CODES.TRIGGER);

  step(state, input(0, { detonate: true }));
  assert.equal(player.triggers, TRIGGERS_PER_BONUS, 'no bomb, no charge');
});

test('the reserve empties on the drop, not on the detonation', () => {
  // It counts delayed bombs to drop, and not presses: dropping three bombs costs
  // three charges, setting them off costs none.
  const state = bareArena();
  const player = place(state, 0, 1, 5);
  player.bombs = 3;
  player.triggers = 3;

  step(state, input(0, { drop: true }));
  assert.equal(player.triggers, 2, 'the drop takes one');
  place(state, 0, 5, 5);
  step(state, input(0, { drop: true }));
  place(state, 0, 9, 5);
  step(state, input(0, { drop: true }));
  assert.equal(player.triggers, 0, 'three bombs, three charges');
  assert.equal(state.bombs.every((bomb) => bomb.fuse === null), true);

  // Reserve empty, and yet all three go off, one per press.
  place(state, 0, 13, 11);
  step(state, input(0, { detonate: true }));
  assert.equal(state.bombs.length, 2, 'the oldest is gone');
  assert.equal(player.triggers, 0, 'the button costs nothing');
  advanceBy(state, FLAME_STEPS + 1, []);
  step(state, input(0, { detonate: true }));
  advanceBy(state, FLAME_STEPS + 1, []);
  step(state, input(0, { detonate: true }));
  advanceBy(state, 2, []);
  assert.equal(state.bombs.length, 0, 'all three have gone off');
});

test('with the reserve empty, we are back to fused bombs', () => {
  const state = bareArena();
  const player = place(state, 0, 1, 5);
  player.bombs = 2;
  player.triggers = 1;

  step(state, input(0, { drop: true }));
  assert.equal(state.bombs[0].fuse, null, 'the last charge does give a waiting bomb');
  advanceBy(state, DOUBLE_TAP_STEPS + 1, input(0, {}));
  place(state, 0, 5, 5);
  step(state, input(0, { drop: true }));
  assert.equal(state.bombs[1].fuse, FUSE_STEPS - 1, 'the next one has a fuse');

  // And the button does not command a fused bomb: it was never paid for.
  place(state, 0, 13, 11);
  step(state, input(0, { detonate: true }));
  step(state, input(0, { detonate: true }));
  assert.equal(bombAt(state, 5, 5) !== null, true, 'the fused bomb waits its turn');
});

test('a second bonus recharges the reserve', () => {
  const state = bareArena();
  const player = place(state, 0, 1, 5);
  player.triggers = 2;
  apply(player, BONUS_CODES.TRIGGER);
  assert.equal(player.triggers, 2 + TRIGGERS_PER_BONUS);
});

test('the glove sends the bomb three cells further, over everything', () => {
  // That is the difference from the kick: the kick pushes at ground level and
  // stops at the first obstacle; the glove makes the bomb FLY OVER.
  const state = bareArena();
  brick(state, 5, 5);
  const player = place(state, 0, 3, 5);
  player.glove = true;
  player.dir = RIGHT;

  // An opponent's bomb right in front of it.
  const neighbour = place(state, 0, 4, 5);
  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];
  assert.deepEqual([bomb.cx, bomb.cy], [4, 5]);

  // It comes back to its cell and punches, with the trigger button.
  place(state, 0, 3, 5);
  player.dir = RIGHT;
  step(state, input(0, { detonate: true }));

  assert.ok(bomb.flight, 'it has to be in the air');
  assert.deepEqual([bomb.cx, bomb.cy], [7, 5], 'and aim three cells further');
  assert.equal(state.bombs.length, 1, 'no extra bomb was dropped');
  assert.equal(events(state, 'punch').length, 1);
  assert.ok(neighbour);
});

test('a bomb in flight blocks nobody', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 5);
  player.glove = true;
  player.dir = RIGHT;
  place(state, 0, 4, 5);
  step(state, input(0, { drop: true }));
  place(state, 0, 3, 5);
  player.dir = RIGHT;
  step(state, input(0, { detonate: true }));

  const bomb = state.bombs[0];
  assert.ok(bomb.flight);
  // We walk across the starting cell, which the bomb has just left.
  advanceBy(state, 12, input(0, { dir: RIGHT }));
  assert.ok(cellOnAxis(player.x) >= 4, 'it walks under the trajectory');
});

test('with nothing to punch, the key keeps its first meaning: it detonates', () => {
  // The glove does not take the trigger away: it only comes first when there
  // really is a bomb to punch, the one ahead or the one underneath.
  const state = bareArena();
  const player = place(state, 0, 3, 5);
  player.glove = true;
  player.triggers = 1;
  player.dir = RIGHT;

  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];
  // It moves away: its bomb is neither ahead of it nor under its feet any more.
  advanceBy(state, 40, input(0, { dir: RIGHT }));
  assert.ok(cellOnAxis(player.x) > 4, 'it has indeed left');

  step(state, input(0, { detonate: true }));
  assert.equal(events(state, 'punch').length, 0, 'nothing to punch from where it is');
  assert.equal(bomb.flight, null, 'it does not fly off');
  assert.equal(state.bombs.length, 0, 'it went off on command');
  assert.ok(state.flames.length > 0);
  assert.equal(player.triggers, 0, 'the charge was used');
});

test('the bomb button no longer punches: it drops, that is all', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 5);
  player.glove = true;
  player.bombs = 2;
  player.dir = RIGHT;

  // An opponent's bomb right in front of it, the very target of the glove.
  place(state, 1, 4, 5);
  step(state, input(1, { drop: true }));
  const ahead = bombAt(state, 4, 5);

  step(state, input(0, { drop: true }));
  assert.equal(ahead.flight, null, 'it stays on the ground');
  assert.equal(events(state, 'punch').length, 0);
  assert.ok(bombAt(state, 3, 5), 'it dropped its own, as asked');
});

test('without the glove nothing flies, on either button', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 5);
  player.bombs = 2;
  player.dir = RIGHT;
  place(state, 0, 4, 5);
  step(state, input(0, { drop: true }));
  advanceBy(state, DOUBLE_TAP_STEPS + 1, input(0, {}));
  place(state, 0, 3, 5);
  player.dir = RIGHT;
  step(state, input(0, { drop: true, detonate: true }));

  assert.equal(state.bombs.length, 2, 'it drops a second one');
  assert.equal(state.bombs.every((b) => !b.flight), true, 'and nothing flies');
});

test('the punched bomb lands and blocks again', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 5);
  player.glove = true;
  player.dir = RIGHT;
  place(state, 0, 4, 5);
  step(state, input(0, { drop: true }));
  place(state, 0, 3, 5);
  player.dir = RIGHT;
  step(state, input(0, { detonate: true }));

  const bomb = state.bombs[0];
  advanceBy(state, bomb.flight.duration + 1, []);
  assert.equal(bomb.flight, null, 'it has touched down');
  assert.deepEqual([bomb.cx, bomb.cy], [7, 5]);
});

test('its fuse keeps burning during the flight', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 5);
  player.glove = true;
  player.dir = RIGHT;
  place(state, 0, 4, 5);
  step(state, input(0, { drop: true }));
  const before = state.bombs[0].fuse;
  place(state, 0, 3, 5);
  player.dir = RIGHT;
  step(state, input(0, { detonate: true }));
  advanceBy(state, 10, []);
  assert.ok(state.bombs[0].fuse < before - 5, 'the flight does not pause the fuse');
});

test('you punch the bomb under your feet, without having to leave your cell', () => {
  // THE MOST FREQUENT CASE IN PLAY, and the one that made the glove unusable: as
  // long as the box still touches its own bomb, pressing towards it makes you
  // walk back onto it instead of facing it, and there was then nothing to punch.
  const state = bareArena();
  const player = place(state, 0, 3, 5);
  player.glove = true;
  player.dir = RIGHT;

  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];
  assert.deepEqual([bomb.cx, bomb.cy], [3, 5]);

  step(state, input(0, { detonate: true }));
  assert.ok(bomb.flight, 'it has to set off from under its feet');
  assert.deepEqual([bomb.cx, bomb.cy], [6, 5]);
  assert.equal(state.bombs.length, 1);
  assert.equal(events(state, 'punch').length, 1);
});

test('the bomb ahead comes before the one underneath', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 5);
  player.glove = true;
  player.bombs = 2;
  player.dir = RIGHT;

  step(state, input(0, { drop: true }));
  place(state, 1, 4, 5);
  step(state, input(1, { drop: true }));
  const own = bombAt(state, 3, 5);
  const ahead = bombAt(state, 4, 5);
  assert.ok(own && ahead);

  step(state, input(0, { detonate: true }));
  assert.ok(ahead.flight, 'it is the one in front that sets off');
  assert.equal(own.flight, null, 'its own stays on the ground');
});

test('the punch gesture is played even when nothing sets off', () => {
  // Punching thin air has to be visible: with no feedback on screen, the glove
  // passes for inert and you think the key is dead.
  const state = bareArena();
  const player = place(state, 0, 3, 5);
  player.glove = true;
  player.dir = RIGHT;

  step(state, input(0, { detonate: true }));
  assert.equal(state.bombs.length, 0, 'no bomb anywhere');
  assert.equal(player.punchedAt, state.step, 'the gesture is dated all the same');

  const gloveless = place(state, 1, 7, 5);
  step(state, input(1, { detonate: true }));
  assert.equal(gloveless.punchedAt, null, 'without the bonus, no gesture');
});

test('punched upwards from the edge, the bomb comes back from the bottom', () => {
  // Cornered against an edge, you keep a riposte: the bomb flies over the border
  // wall, leaves the screen, and falls back at the bottom of the SAME column.
  const state = bareArena();
  const player = place(state, 0, 3, 1);
  player.glove = true;
  player.dir = UP;

  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];
  step(state, input(0, { detonate: true }));

  assert.ok(bomb.flight, 'it sets off into the air');
  assert.equal(bomb.cx, 3, 'same column');
  assert.equal(bomb.cy, ROWS - 2, 'and the first playable row on the other side');
  // Three cells flown over, not eleven: it is the journey, not the distance as
  // the crow flies, that gives the duration.
  assert.equal(bomb.flight.duration, bomb.flight.left + 1);
  assert.equal(bomb.flight.duration, 3 * FLIGHT_STEPS_PER_CELL);
});

test('the wrapping applies on the sides too', () => {
  const state = bareArena();
  const player = place(state, 0, 1, 5);
  player.glove = true;
  player.dir = LEFT;

  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];
  step(state, input(0, { detonate: true }));

  assert.deepEqual([bomb.cx, bomb.cy], [COLS - 2, 5]);
});

test('away from the edges, the punch does not go round the board', () => {
  // The wrapping must not change the ordinary gesture: three cells ahead, and
  // nothing else.
  const state = bareArena();
  const player = place(state, 0, 5, 5);
  player.glove = true;
  player.dir = UP;

  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];
  step(state, input(0, { detonate: true }));

  assert.deepEqual([bomb.cx, bomb.cy], [5, 2]);
});

test('a wall at the range does not stop it: it looks for the first hole', () => {
  // Row 2 carries the checkerboard pillars, at the even abscissas. Punched from
  // (1,2) to the right, the bomb aims at (4,2) — a pillar — and carries straight
  // on to (5,2).
  const state = bareArena();
  const player = place(state, 0, 1, 2);
  player.glove = true;
  player.dir = RIGHT;

  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];
  step(state, input(0, { detonate: true }));

  assert.deepEqual([bomb.cx, bomb.cy], [5, 2], 'it flies over the pillar');
  assert.equal(bomb.flight.duration, 4 * FLIGHT_STEPS_PER_CELL, 'and its flight lasts the four cells');
});

test('it also flies over bricks and other bombs', () => {
  const state = bareArena();
  brick(state, 6, 5);
  const player = place(state, 0, 3, 5);
  player.glove = true;
  player.dir = RIGHT;

  // An opponent's bomb dropped exactly at the glove's range.
  place(state, 1, 7, 5);
  step(state, input(1, { drop: true }));

  step(state, input(0, { drop: true }));
  const own = bombAt(state, 3, 5);
  step(state, input(0, { detonate: true }));

  // (6,5) is a brick, (7,5) already carries a bomb: it lands at (8,5).
  assert.deepEqual([own.cx, own.cy], [8, 5]);
  assert.equal(bombAt(state, 7, 5).flight, null, 'the one in front has not moved');
});

test('a line taken from end to end lets nothing set off', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 5);
  player.glove = true;
  player.dir = RIGHT;

  // The whole row in bricks, except the bomber's cell.
  for (let x = 0; x < COLS; x += 1) if (x !== 3) brick(state, x, 5);

  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];
  step(state, input(0, { detonate: true }));

  assert.equal(bomb.flight, null, 'it stays where it is');
  assert.deepEqual([bomb.cx, bomb.cy], [3, 5]);
  assert.equal(events(state, 'punch').length, 0);
});

test('the jelly makes the bomb bounce instead of stopping it', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 3);
  player.kick = true;
  player.jelly = true;
  brick(state, 6, 3);

  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];
  assert.equal(bomb.bounce, true, 'the bomb is born mad, it does not become so');

  // We leave to the left, then come back: the bomber kicks it to the right.
  advanceBy(state, 20, input(0, { dir: LEFT }));

  // We advance to the first bounce, and look at where it happens.
  let hit = null;
  for (let i = 0; i < 60 && hit === null; i += 1) {
    step(state, input(0, { dir: i < 40 ? RIGHT : -1 }));
    if (events(state, 'bounce').length > 0) hit = [bomb.cx, bomb.cy];
  }

  // Without the jelly it would have STOPPED there, at (5,3), against the brick.
  assert.deepEqual(hit, [5, 3], 'it bounces off the brick at (6,3)');
  assert.ok(bomb.slide, 'and it is still sliding');
  assert.equal(bomb.slide.dir, LEFT, 'the other way');
});

test('the bounce is announced, once per wall touched', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 3);
  player.kick = true;
  player.jelly = true;
  brick(state, 6, 3);
  brick(state, 1, 3);

  step(state, input(0, { drop: true }));
  advanceBy(state, 20, input(0, { dir: LEFT }));

  let bounces = 0;
  for (let i = 0; i < 200; i += 1) {
    step(state, input(0, { dir: i < 40 ? RIGHT : -1 }));
    bounces += events(state, 'bounce').length;
  }
  // It shuttles between the two bricks: at least one round trip.
  assert.ok(bounces >= 2, `it has to bounce several times (${bounces})`);
  assert.ok(state.bombs.length === 0 || state.bombs[0].slide, 'it did not stall on the way');
});

test('without the jelly, nothing bounces', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 3);
  player.kick = true;
  brick(state, 6, 3);

  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];
  assert.equal(bomb.bounce, false);
  advanceBy(state, 20, input(0, { dir: LEFT }));
  advanceBy(state, 40, input(0, { dir: RIGHT }));

  assert.equal(bomb.cx, 5, 'it stops against the brick');
  assert.equal(bomb.slide, null);
  assert.equal(events(state, 'bounce').length, 0);
});

test('wedged between two walls, it settles instead of shaking', () => {
  const state = bareArena();
  // A one-cell corridor: bricks on either side.
  brick(state, 2, 1);
  brick(state, 4, 1);
  const player = place(state, 0, 3, 1);
  player.kick = true;
  player.jelly = true;

  step(state, input(0, { drop: true }));
  const bomb = state.bombs[0];
  advanceBy(state, 20, input(0, { dir: DOWN }));
  advanceBy(state, 40, input(0, { dir: UP }));

  assert.equal(bomb.slide, null, 'it ends up settling');
  assert.deepEqual([bomb.cx, bomb.cy], [3, 1]);
});

test('a jelly bomb rolls half as fast', () => {
  // It no longer stops: at kick pace, it swept the arena faster than the eye
  // could follow.
  const travel = (jelly) => {
    const state = bareArena();
    const player = place(state, 0, 3, 3);
    player.jelly = jelly;
    step(state, input(0, { drop: true }));
    const bomb = state.bombs[0];
    // Kicked by hand: we measure the run, not how it is set off.
    place(state, 0, 7, 7);
    pushBomb(state, bomb, RIGHT);
    const start = bomb.slide.x;
    advanceBy(state, 4, input(0, {}));
    return bomb.slide.x - start;
  };

  const tame = travel(false);
  const mad = travel(true);
  assert.ok(tame > 0 && mad > 0, 'both have to have moved');
  assert.equal(mad * 2, tame, 'exactly half the distance');
});

test('a fused bomb hitting a waiting bomb sets it off', () => {
  const state = bareArena();
  // The watcher drops its delayed bomb at (6,5) and leaves it there.
  const watcher = place(state, 1, 6, 5);
  watcher.triggers = 1;
  step(state, input(1, { drop: true }));
  const trap = bombAt(state, 6, 5);
  assert.equal(trap.fuse, null, 'it is indeed waiting');
  place(state, 1, 13, 11);

  // The other one kicks an ordinary bomb into it.
  const shooter = place(state, 0, 3, 5);
  shooter.kick = true;
  step(state, input(0, { drop: true }));
  const shot = bombAt(state, 3, 5);
  advanceBy(state, 20, input(0, { dir: LEFT }));
  advanceBy(state, 40, input(0, { dir: RIGHT }));

  assert.equal(state.bombs.includes(trap), false, 'the trap has gone off');
  assert.ok(shot);
});

test('a waiting bomb pushed against another does not light itself', () => {
  // The reverse would be unplayable: a delayed bomb has to be movable without
  // setting off, otherwise it no longer serves to set a trap.
  const state = bareArena();
  const sleeper = place(state, 1, 6, 5);
  sleeper.triggers = 1;
  step(state, input(1, { drop: true }));
  const target = bombAt(state, 6, 5);
  place(state, 1, 13, 11);

  const dropper = place(state, 0, 3, 5);
  dropper.kick = true;
  dropper.triggers = 1;
  step(state, input(0, { drop: true }));
  const pushed = bombAt(state, 3, 5);
  assert.equal(pushed.fuse, null, 'both are waiting');
  advanceBy(state, 20, input(0, { dir: LEFT }));
  advanceBy(state, 40, input(0, { dir: RIGHT }));

  assert.equal(target.fuse, null, 'the one that was sleeping is sleeping still');
  assert.equal(pushed.fuse, null);
  assert.equal(state.bombs.length, 2);
});

test('the double tap lines up every bomb in front of you', () => {
  const state = bareArena();
  const player = place(state, 0, 2, 5);
  player.bombs = 4;
  player.dir = RIGHT;

  // First press: underfoot, as always.
  step(state, input(0, { drop: true }));
  assert.deepEqual([bombAt(state, 2, 5) !== null, state.bombs.length], [true, 1]);

  // Second press straight after: the rest goes out in a queue ahead of it.
  step(state, input(0, { drop: true }));
  assert.equal(state.bombs.length, 4, 'all four bombs are dropped');
  for (const cx of [3, 4, 5]) {
    assert.ok(bombAt(state, cx, 5), `a bomb at (${cx},5)`);
  }
  assert.equal(player.dropped, 4, 'the quota is indeed used up');
});

test('the burst stops at the first obstacle', () => {
  // A queue full of holes bars nothing, and barring is the whole point of the
  // gesture.
  const state = bareArena();
  brick(state, 5, 5);
  const player = place(state, 0, 2, 5);
  player.bombs = 8;
  player.dir = RIGHT;

  step(state, input(0, { drop: true }));
  step(state, input(0, { drop: true }));

  assert.equal(state.bombs.length, 3, 'underfoot, then (3,5) and (4,5)');
  assert.equal(bombAt(state, 6, 5), null, 'nothing jumps over the brick');
  assert.equal(player.dropped, 3, 'the rest of the magazine is kept');
});

test('two presses far apart do not make a burst', () => {
  const state = bareArena();
  const player = place(state, 0, 2, 5);
  player.bombs = 4;
  player.dir = RIGHT;

  step(state, input(0, { drop: true }));
  advanceBy(state, DOUBLE_TAP_STEPS + 1, input(0, {}));
  step(state, input(0, { drop: true }));

  assert.equal(state.bombs.length, 1, 'the second press drops nothing: it is on its bomb');
});

test('a press with no effect does not arm the burst', () => {
  // You hammer the button while fleeing: if those presses armed the gesture, the
  // burst would go off by itself on the next useful press.
  const state = bareArena();
  const player = place(state, 0, 2, 5);
  player.bombs = 3;
  player.dir = RIGHT;

  // Three presses in a row standing on its own bomb: the first drops, the others
  // can do nothing — and arm nothing.
  step(state, input(0, { drop: true }));
  advanceBy(state, DOUBLE_TAP_STEPS + 1, input(0, {}));
  step(state, input(0, { drop: true }));
  step(state, input(0, { drop: true }));
  assert.equal(state.bombs.length, 1, 'no burst out of empty presses');

  // It steps aside, and drops again: a single bomb, under its feet.
  place(state, 0, 4, 5);
  step(state, input(0, { drop: true }));
  assert.equal(state.bombs.length, 2);
  assert.ok(bombAt(state, 4, 5));
  assert.equal(bombAt(state, 5, 5), null, 'and nothing in front of it');
});
