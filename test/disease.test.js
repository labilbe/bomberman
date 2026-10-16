import test from 'node:test';
import assert from 'node:assert/strict';

import { step, advanceBy } from '../src/engine/step.js';
import { bombAt, drop } from '../src/engine/bombs.js';
import { index, centreOfCell } from '../src/engine/grid.js';
import {
  BASE_SPEED,
  DISEASE_STEPS,
  MAX_RANGE,
  MAX_SPEED,
  RANGE_AT_START,
  RIGHT,
  SHORT_FUSE_STEPS,
  SICK_SPEED,
  TINY_RANGE,
  UNITS,
} from '../src/engine/constants.js';
import { BONUS_CODES, apply, fromTable, grant } from '../src/engine/bonus.js';
import { ILLNESSES, infect, isIll, speedOf } from '../src/engine/disease.js';
import { bareArena, item, place, input } from './helpers.js';

test('a skull hands out an illness, and it runs out by itself', () => {
  const state = bareArena();
  const player = place(state, 0, 5, 5);
  item(state, 5, 5, BONUS_CODES.DISEASE);

  step(state, input(0, {}));
  assert.notEqual(player.illness, null, 'it has to catch something');
  assert.equal(isIll(player, state.step), true);
  assert.equal(state.items[index(5, 5)], 0, 'the skull is picked up like any pack');

  advanceBy(state, DISEASE_STEPS);
  assert.equal(isIll(player, state.step), false, 'fifteen seconds and it is over');
  assert.equal(player.illness, null, 'and nothing is left behind');
});

test('the illness changes nothing that was picked up', () => {
  // The whole design of disease.js: the handicap is read over the powers, never
  // written into them. Recovering therefore gives back exactly what was owned.
  const state = bareArena();
  const player = place(state, 0, 5, 5);
  apply(player, BONUS_CODES.SPEED);
  apply(player, BONUS_CODES.FLAME);
  const speed = player.speed;
  const range = player.range;

  infect(state, player, ILLNESSES.SLOW);
  assert.equal(player.speed, speed, 'the skates are still there');
  assert.equal(speedOf(player, state.step), SICK_SPEED, 'only the legs are read differently');

  advanceBy(state, DISEASE_STEPS + 1);
  assert.deepEqual([player.speed, player.range], [speed, range], 'everything comes back');
  assert.equal(speedOf(player, state.step), speed);
});

test('leaden legs and mad legs are both read off the same powers', () => {
  const state = bareArena();
  const player = place(state, 0, 5, 5);

  infect(state, player, ILLNESSES.SLOW);
  assert.equal(speedOf(player, state.step), SICK_SPEED, 'slower than a bomber with nothing');
  assert.ok(SICK_SPEED < BASE_SPEED);

  infect(state, player, ILLNESSES.RUSH);
  assert.equal(speedOf(player, state.step), MAX_SPEED, 'and the other way round, at top speed');
});

test('the short fuse and the tiny flame are taken at the drop', () => {
  const state = bareArena();
  const player = place(state, 0, 5, 5);
  player.range = 5;
  player.bombs = 2;

  infect(state, player, ILLNESSES.SHORT);
  step(state, input(0, { drop: true }));
  const short = bombAt(state, 5, 5);
  assert.equal(short.fuse, SHORT_FUSE_STEPS - 1, 'a fuse of 0.6 s, not 2.4');
  assert.equal(short.range, 5, 'the reach is untouched by this one');

  // A bomb already on the ground keeps what it was dropped with: catching
  // another illness must change nothing about a fuse already burning.
  infect(state, player, ILLNESSES.TINY);
  step(state, input(0, {}));
  assert.equal(short.fuse, SHORT_FUSE_STEPS - 2, 'it burns down at its own pace');
  assert.equal(short.range, 5, 'and keeps the reach it was dropped with');

  place(state, 0, 7, 5);
  step(state, input(0, { drop: true }));
  assert.equal(bombAt(state, 7, 5).range, TINY_RANGE, 'the blast falls back to one cell');
});

test('the runs drop bombs by themselves, without ever bursting', () => {
  // The press is involuntary, so it must not arm the double tap: a spooger
  // carrier who catches this would otherwise empty the magazine in front of them
  // on the step they caught it.
  const state = bareArena();
  const player = place(state, 0, 5, 5);
  player.bombs = 4;
  player.spooger = true;
  player.dir = RIGHT;

  infect(state, player, ILLNESSES.COLIC);
  step(state, input(0, {}));
  assert.ok(bombAt(state, 5, 5), 'a bomb falls with no key pressed');
  assert.equal(state.bombs.length, 1, 'one, and one only');
  assert.equal(player.droppedAt, null, 'the burst is not armed');

  // It keeps dropping as it walks, one per cell, until the magazine is empty.
  advanceBy(state, 60, input(0, { dir: RIGHT }));
  assert.equal(player.dropped, 4, 'the magazine empties by itself');
  assert.equal(state.bombs.every((bomb) => bomb.fuse !== null), true, 'all of them fused');
});

test('touching somebody healthy hands the illness over, and cures the giver', () => {
  const state = bareArena({ places: 2 });
  const ill = place(state, 0, 5, 5);
  const healthy = place(state, 1, 5, 5);
  infect(state, ill, ILLNESSES.TINY);

  step(state, input(0, {}));

  assert.equal(ill.illness, null, 'the giver is cured');
  assert.equal(healthy.illness, ILLNESSES.TINY, 'and the other one has it');
  assert.equal(
    healthy.illnessUntil,
    state.step + DISEASE_STEPS,
    'with the full fifteen seconds, not what was left of them',
  );
});

test('an illness does not cross two bombers in the same step', () => {
  // Three in a row, all touching. Resolving contacts as they are found would let
  // the skull run down the line in one step, and which way it ran would depend
  // on the order of the player array.
  const state = bareArena({ places: 3 });
  const ill = place(state, 0, 5, 5);
  const middle = place(state, 1, 5, 5);
  const far = place(state, 2, 5, 5);
  infect(state, ill, ILLNESSES.COLIC);

  step(state, input(0, {}));

  const caught = [middle, far].filter((player) => player.illness !== null);
  assert.equal(caught.length, 1, 'exactly one bomber catches it');
  assert.equal(ill.illness, null, 'and the first one is rid of it');
});

test('two bombers far enough apart swap nothing', () => {
  const state = bareArena({ places: 2 });
  const ill = place(state, 0, 5, 5);
  const other = state.players[1];
  const centre = centreOfCell(5, 5);
  other.x = centre.x + UNITS;
  other.y = centre.y;
  infect(state, ill, ILLNESSES.RUSH);

  step(state, input(0, {}));

  assert.equal(other.illness, null, 'a whole tile away is not touching');
  assert.equal(ill.illness, ILLNESSES.RUSH, 'and the carrier keeps it');
});

test('the gold flame gives the whole reach at once', () => {
  const state = bareArena();
  const player = place(state, 0, 5, 5);

  apply(player, BONUS_CODES.GOLDFLAME);
  assert.equal(player.range, MAX_RANGE, 'everything, in one pack');
  assert.equal(player.goldflame, true);
  assert.equal(player.goldflameFrom, RANGE_AT_START, 'what was owned before it is kept');

  // A second one changes nothing and must not forget the first reading.
  apply(player, BONUS_CODES.GOLDFLAME);
  assert.equal(player.goldflameFrom, RANGE_AT_START, 'the first reading stands');
});

test('the gold flame keeps the flames owned before it', () => {
  const state = bareArena();
  const player = place(state, 0, 5, 5);
  apply(player, BONUS_CODES.FLAME);
  apply(player, BONUS_CODES.FLAME);
  apply(player, BONUS_CODES.GOLDFLAME);

  assert.equal(player.goldflameFrom, RANGE_AT_START + 2, 'two flames, and then the gold one');
  assert.equal(player.range, MAX_RANGE);
});

test('a random pack gives something else, and never itself', () => {
  const state = bareArena();
  const player = place(state, 0, 5, 5);

  // Over many draws, from the state's own generator: the pack has to be able to
  // give anything in the table except a second random one.
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) {
    seen.add(grant(state, { ...player }, BONUS_CODES.RANDOM));
  }
  assert.equal(seen.has(BONUS_CODES.RANDOM), false, 'never a random pack again');
  assert.ok(seen.size > 5, 'and not always the same thing either');
});

test('the weighted table is read the same way at both ends', () => {
  // The arena and the random pack share one reader; a draw at 0 gives the first
  // line, a draw just under 1 the last.
  assert.equal(fromTable(0), BONUS_CODES.BOMB);
  assert.equal(fromTable(0.999999), BONUS_CODES.GOLDFLAME);
  assert.equal(
    fromTable(0.999999, BONUS_CODES.GOLDFLAME),
    BONUS_CODES.RANDOM,
    'leaving one out shortens the table rather than leaving a hole',
  );
});

test('a skull picked up is heard apart from the pack', () => {
  const state = bareArena();
  place(state, 0, 5, 5);
  item(state, 5, 5, BONUS_CODES.DISEASE);

  step(state, input(0, {}));

  const names = state.events.map((event) => event[0]);
  assert.ok(names.includes('pick'), 'the cell has to be cleared on the clients');
  assert.ok(names.includes('sick'), 'and the ear told it went wrong');
});

test('a corpse sows no skull: an illness is not a thing one owns', () => {
  const state = bareArena({ places: 3 });
  const sick = place(state, 0, 7, 7);
  sick.kick = true; // one real bonus, so that the corpse does sow something
  infect(state, sick, ILLNESSES.COLIC);

  const killer = place(state, 1, 7, 5);
  killer.range = 1;
  place(state, 2, 13, 11);
  drop(state, killer);
  place(state, 1, 13, 1);
  place(state, 0, 7, 6);
  const theirs = state.bombs.filter((bomb) => bomb.place === 1).sort((a, b) => a.id - b.id)[0];
  theirs.fuse = 1;
  step(state, input(1, {}));

  assert.equal(sick.alive, false, 'it has to die');
  const sown = state.events.filter((event) => event[0] === 'item').map((event) => event[3]);
  assert.deepEqual(sown, ['kick'], 'the kick comes back, the illness does not');
});
