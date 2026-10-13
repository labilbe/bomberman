/**
 * The rules the protocol's names have to keep.
 *
 * They are tested because they are INVARIANTS and not a style: a list is edited
 * one day without thinking about the other, and the only thing to notice would
 * be a game where a bot is taken for a human.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { HUMAN_NAMES, BOT_NAMES, botNames, cleanName, NAME_MAX } from '../src/net/protocol.js';

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
