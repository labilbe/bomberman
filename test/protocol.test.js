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
  cleanTerrain,
  randomTerrain,
  preferColour,
  NAME_MAX,
  MAX_PLACES,
  TERRAINS,
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

test('a colour nobody wears is simply taken', () => {
  // Four places show four of the ten colours: the one asked for is often held
  // by nobody at all, and there is then nothing to exchange.
  const colours = cleanColours(null, 4);
  assert.deepEqual(preferColour(colours, 1, 7, () => true), [0, 7, 2, 3]);
});

test('a colour a bot wears changes hands', () => {
  // The bot does not look for itself on the board; the player does.
  const after = preferColour([0, 1, 2, 3], 3, 1, () => false);
  assert.deepEqual(after, [0, 3, 2, 1], 'the two places exchange, nothing is lost');
  assert.equal(new Set(after).size, 4);
});

test('a colour a human wears stays on their back', () => {
  // They were there first, and taking it would move the bearings of somebody
  // who is already playing.
  const colours = [0, 1, 2, 3];
  const after = preferColour(colours, 3, 1, (place) => place === 1);
  assert.deepEqual(after, colours);
});

test('asking for the colour one already wears changes nothing', () => {
  const colours = [4, 1, 2, 3];
  assert.equal(preferColour(colours, 0, 4, () => false), colours);
});

test('a colour that does not exist is ignored', () => {
  // It comes off the wire: -1, 42 and "rouge" must leave the room as it was.
  const colours = [0, 1, 2, 3];
  for (const wanted of [-1, 42, 1.5, 'rouge', null, undefined, NaN]) {
    assert.equal(preferColour(colours, 2, wanted, () => false), colours, String(wanted));
  }
});

test('"au hasard" is never read as board zero', () => {
  // THE BUG AS IT WAS REPORTED: "Au hasard" played Green Acres every single
  // time. The entry carries the EMPTY value, a guest joining sends null, and
  // `Number('')` and `Number(null)` are both zero — so a cast read either as a
  // formal claim to the first board, and the draw was never reached.
  for (const nothing of ['', null, undefined, '  ', 'x', NaN, false, [], {}]) {
    assert.equal(cleanTerrain(nothing), null, `${JSON.stringify(nothing)} is not a board`);
  }
  // A board named as text is not one either: the wire carries numbers, and the
  // screen converts before asking.
  assert.equal(cleanTerrain('3'), null);
  assert.equal(cleanTerrain(3), 3, 'a real index still comes through');
  assert.equal(cleanTerrain(0), 0, 'and zero is a board like the others');
});

test('a board outside the eleven is left to chance', () => {
  // The number comes off the wire, so it comes from a stranger.
  assert.equal(cleanTerrain(TERRAINS), null);
  assert.equal(cleanTerrain(-1), null);
  assert.equal(cleanTerrain(2.5), null);
});

test('the draw reaches every board, and never leaves the eleven', () => {
  // A draw that never showed the last board would be a board nobody ever plays.
  const seen = new Set();
  for (let i = 0; i < TERRAINS; i += 1) {
    // One fixed point per board, taken in the middle of its slice.
    seen.add(randomTerrain(() => (i + 0.5) / TERRAINS));
  }
  assert.equal(seen.size, TERRAINS, 'the eleven are all reachable');
  // And the edges, where a rounding mistake would step outside.
  assert.equal(randomTerrain(() => 0), 0);
  assert.equal(randomTerrain(() => 0.999999), TERRAINS - 1);
});
