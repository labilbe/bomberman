/**
 * The rules the protocol's names have to keep.
 *
 * They are tested because they are INVARIANTS and not a style: a list is edited
 * one day without thinking about the other, and the only thing to notice would
 * be a game where a bot is taken for a human.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HUMAN_NAMES,
  BOT_NAMES,
  botNames,
  cleanName,
  cleanColours,
  NAME_MAX,
  MAX_PLACES,
} from '../src/net/protocol.js';

test('no name is both a human and a bot', () => {
  // In a four-way scrum you have to tell at a glance who is driven by somebody.
  const shared = BOT_NAMES.filter((name) => HUMAN_NAMES.includes(name));
  assert.deepEqual(shared, []);
});

test('each list names everybody differently', () => {
  assert.equal(new Set(HUMAN_NAMES).size, HUMAN_NAMES.length);
  assert.equal(new Set(BOT_NAMES).size, BOT_NAMES.length);
});

test('the names survive being cleaned up', () => {
  // They travel over the wire and come back through `cleanName`: a name longer
  // than the maximum would come back cut, and the scoreboard would show a
  // different one from the waiting room.
  for (const name of [...HUMAN_NAMES, ...BOT_NAMES]) {
    assert.ok(name.length <= NAME_MAX, `${name} is too long`);
    assert.equal(cleanName(name), name);
  }
});

test('an arena of four bots has four different names', () => {
  // Two bots with the same name make the scoreboard illegible, whatever the
  // offset the room draws.
  for (let offset = 0; offset < BOT_NAMES.length; offset += 1) {
    const drawn = botNames(4, offset);
    assert.equal(new Set(drawn).size, 4, `offset ${offset} repeats a name`);
  }
});

test('the colours of a room are all different, whatever is asked for', () => {
  // They come off the wire: a list from a stranger must never hand two bombers
  // the same skin, since two identical bombers cannot be told apart in play.
  for (const asked of [
    null,
    'rouge',
    [],
    [3],
    [2, 2, 2, 2],
    [0, 0, 1, 9],
    [-1, 42, 1.5, 3],
    [9, 8, 7, 6],
  ]) {
    const colours = cleanColours(asked, 4);
    assert.equal(colours.length, 4);
    assert.equal(new Set(colours).size, 4, `${JSON.stringify(asked)} gave a duplicate`);
    for (const colour of colours) {
      assert.ok(Number.isInteger(colour) && colour >= 0 && colour < MAX_PLACES);
    }
  }
});

test('a choice everybody can have is kept as it was made', () => {
  assert.deepEqual(cleanColours([4, 2, 9, 0], 4), [4, 2, 9, 0]);
});

test('with nothing asked for, the place gives the colour', () => {
  // That is how a room worked before anybody could choose, and a room nobody
  // laid out still works that way.
  assert.deepEqual(cleanColours(null, 4), [0, 1, 2, 3]);
});

test('a colour claimed twice goes to the first place that asked', () => {
  // The creation screen swaps rather than refuses, so this list should never
  // arrive — but it is exactly what a stale page or a hand-made client sends.
  assert.deepEqual(cleanColours([5, 5, 5], 3), [5, 0, 1]);
});
