/**
 * Tests for the room, with neither Cloudflare nor WebSocket.
 *
 * `createRoom` knows nothing but decoded messages and returns outgoing ones: so
 * everything happens in Node, clock included, since time is handed to it. That
 * is what lets us try out here what a real game only produces one time in a
 * hundred — a player coming back in the last second, two departures on the same
 * step, a room emptying mid-round.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRoom } from '../worker/room.js';
import { CLIENT, SERVER, RESUME_MS } from '../src/net/protocol.js';
import { STEP_MS } from '../src/engine/constants.js';
import { ROUND_START_STEPS } from '../src/engine/game.js';

/** The messages of a given type in a list of outgoing ones. */
const of = (outgoing, type) => outgoing.filter((e) => e.message.type === type).map((e) => e.message);

/** Who the first message of a given type goes to. */
const to = (outgoing, type) => outgoing.find((e) => e.message.type === type)?.to;

/**
 * A room where two players have sat down, so the game has started.
 *
 * Neither of them laid the table — both come through "join" — and such a room
 * sets off by itself once full.
 */
function startedRoom(now = 0) {
  const room = createRoom({ code: 'TEST', now, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, format: 3 }, now);
  const outgoing = room.join('b', { type: CLIENT.JOIN, name: 'Bob' }, now);
  return { room, outgoing };
}

/** Advances the room by `ms`, in regular beats. */
function beat(room, ms, start = 0, step = 16) {
  const collected = [];
  for (let t = start + step; t <= start + ms; t += step) {
    for (const sent of room.beat(t)) collected.push(sent);
  }
  return collected;
}

test('the first to arrive is announced as waiting, not as playing', () => {
  const room = createRoom({ code: 'TEST', now: 0, seed: 1 });
  const outgoing = room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2 }, 0);

  const [waiting] = of(outgoing, SERVER.WAITING);
  assert.ok(waiting, 'a waiting message has to go out');
  assert.equal(waiting.places, 1);
  assert.equal(waiting.max, 2);
  assert.deepEqual(waiting.names[0], 'Alice');
  assert.equal(room.started, false);
});

test('a room laid out by somebody waits for them, full or not', () => {
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, format: 3, host: true }, 0);
  const onArrival = room.join('b', { type: CLIENT.JOIN, name: 'Bob' }, 0);

  assert.equal(room.started, false, 'an arrival is not a signal');
  assert.equal(of(onArrival, SERVER.START).length, 0);

  // The guest's click is ignored: the room belongs to whoever opened it.
  assert.equal(room.message('b', { type: CLIENT.BEGIN }, 0).length, 0);
  assert.equal(room.started, false);

  room.message('a', { type: CLIENT.BEGIN }, 0);
  assert.equal(room.started, true);
});

test('each one is told whether it is up to them to start', () => {
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 4, host: true }, 0);
  const outgoing = room.join('b', { type: CLIENT.JOIN, name: 'Bob' }, 0);

  const waiting = outgoing.filter((e) => e.message.type === SERVER.WAITING);
  assert.equal(waiting.length, 2, 'one message per member, since they differ');
  assert.equal(waiting.find((e) => e.to === 'a').message.host, true);
  assert.equal(waiting.find((e) => e.to === 'b').message.host, false);
});

test('a room nobody laid out belongs to nobody', () => {
  // Two players who agreed on a code and both came through "join": neither is
  // offered the start, so the room has to set off by itself once full — waiting
  // for a signal nothing would ever give.
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  const alone = room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2 }, 0);
  assert.equal(of(alone, SERVER.WAITING)[0].host, false, 'joining lays no table');
  assert.equal(room.message('a', { type: CLIENT.BEGIN }, 0).length, 0, 'and gives no signal');

  room.join('b', { type: CLIENT.JOIN, name: 'Bob' }, 0);
  assert.equal(room.started, true, 'full, it sets off on its own');
});

test('the host leaving leaves a room nobody laid out', () => {
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, host: true }, 0);
  room.join('b', { type: CLIENT.JOIN, name: 'Bob' }, 0);
  const outgoing = room.leave('a', 0, { voluntary: true });

  const [waiting] = of(outgoing, SERVER.WAITING);
  assert.equal(waiting.host, false, 'Bob does not inherit a table he did not lay');

  // And the room goes back to the only rule left to it: full, it sets off.
  room.join('c', { type: CLIENT.JOIN, name: 'Carol' }, 0);
  assert.equal(room.started, true);
});

test('the host starts the game, and each one is sent their place', () => {
  const { room, outgoing } = startedRoom();

  assert.equal(room.started, true);
  const starts = of(outgoing, SERVER.START);
  assert.equal(starts.length, 2, 'one start per human, each with their place');
  assert.deepEqual(starts.map((d) => d.mine).flat().sort(), [0, 1]);

  const [round] = of(outgoing, SERVER.ROUND);
  assert.ok(round, 'the first round is announced');
  assert.equal(round.round, 1);
  assert.equal(round.tiles.length, 15 * 13, 'the grid goes out whole');
  assert.equal(typeof round.v, 'number');
});

test('the start is only sent to its addressee', () => {
  const { outgoing } = startedRoom();
  for (const sent of outgoing.filter((e) => e.message.type === SERVER.START)) {
    assert.notEqual(sent.to, null, 'a start is not broadcast to everybody');
  }
});

test('you can start without waiting, the empty places go to bots', () => {
  const room = createRoom({ code: 'TEST', now: 0, seed: 1 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 4, host: true }, 0);
  const outgoing = room.message('a', { type: CLIENT.BEGIN }, 0);

  assert.equal(room.started, true);
  const [start] = of(outgoing, SERVER.START);
  assert.equal(start.places, 4);
  assert.deepEqual(start.mine, [0]);
  // Three bots, all named, and all different.
  const botNames = start.names.slice(1);
  assert.equal(botNames.length, 3);
  assert.equal(new Set(botNames).size, 3, 'two bots with the same name would make the scores illegible');
});

test('a bot can be added before the start', () => {
  const room = createRoom({ code: 'TEST', now: 0, seed: 1 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 4, host: true }, 0);
  const outgoing = room.message('a', { type: CLIENT.BOT }, 0);

  const [waiting] = of(outgoing, SERVER.WAITING);
  assert.equal(waiting.places, 2, 'one human and one bot');
  assert.equal(room.started, false, 'two places are left');
});

test('a bot asks for a precise seat and gets it', () => {
  // Whoever creates the room lays the table: a seat is a corner and a colour, so
  // a bot asked for at place 2 must not land at place 1 — the board shown while
  // waiting would not be the one played.
  const room = createRoom({ code: 'TEST', now: 0, seed: 1 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 4, host: true }, 0);
  const outgoing = room.message('a', { type: CLIENT.BOT, seat: 2 }, 0);

  const [waiting] = of(outgoing, SERVER.WAITING);
  assert.equal(waiting.names[0], 'Alice');
  assert.equal(waiting.names[1], null, 'place 1 awaits a human');
  assert.ok(waiting.names[2], 'the bot sat where it was asked to');
  assert.equal(waiting.names[3], null);
});

test('a seat already held sends the bot to the first free one', () => {
  // The seat comes off the network: asking for a place that is taken, or for one
  // that does not exist, must seat the bot rather than lose it.
  const room = createRoom({ code: 'TEST', now: 0, seed: 1 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 4, host: true }, 0);
  const onMine = of(room.message('a', { type: CLIENT.BOT, seat: 0 }, 0), SERVER.WAITING)[0];
  assert.ok(onMine.names[1], 'it falls back on the first free place');

  const outOfRange = of(room.message('a', { type: CLIENT.BOT, seat: 99 }, 0), SERVER.WAITING)[0];
  assert.ok(outOfRange.names[2], 'and so does a place that does not exist');
});

test('adding bots until it is full starts the game', () => {
  // The host's own gesture, and the last seat is theirs to fill: no need to then
  // ask them to press start in front of a room nobody else can enter.
  const room = createRoom({ code: 'TEST', now: 0, seed: 1 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, host: true }, 0);
  const outgoing = room.message('a', { type: CLIENT.BOT }, 0);
  assert.equal(room.started, true);
  assert.equal(of(outgoing, SERVER.START).length, 1);
});

test('a room being played in refuses the next comer, and says so', () => {
  const { room } = startedRoom();
  const outgoing = room.join('c', { type: CLIENT.JOIN, name: 'Carol' }, 0);
  const [error] = of(outgoing, SERVER.ERROR);
  assert.ok(error);
  assert.match(error.message, /en cours/);
});

test('a finished match frees the room, and its code serves again', () => {
  // Without that, playing once in a room condemned it: the page keeps the last
  // code, and there was no starting again without changing it.
  // A room of four started with a single human: so places are left.
  const room = createRoom({ code: 'TEST', now: 0, seed: 1 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 4, host: true }, 0);
  room.message('a', { type: CLIENT.BEGIN }, 0);
  assert.equal(room.started, true);

  // Mid-game, we refuse.
  const during = room.join('c', { type: CLIENT.JOIN, name: 'Carol' }, 500);
  assert.match(of(during, SERVER.ERROR)[0].message, /en cours/);

  // The match over, the room reopens and the bots leave.
  room.game.over = true;
  const after = room.join('c', { type: CLIENT.JOIN, name: 'Carol', places: 4 }, 1000);
  assert.equal(of(after, SERVER.ERROR).length, 0, 'no more refusal');
  const [waiting] = of(after, SERVER.WAITING);
  assert.ok(waiting, 'we are back in the waiting room');
  assert.equal(waiting.places, 2, 'Alice and Carol, without the bots of the past game');
});

test('the room format is set by the first to arrive', () => {
  const room = createRoom({ code: 'TEST', now: 0, seed: 1 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, format: 7 }, 0);
  const outgoing = room.join('b', { type: CLIENT.JOIN, name: 'Bob', places: 4, format: 3 }, 0);

  const [start] = of(outgoing, SERVER.START);
  assert.equal(start.places, 2, 'the second does not resize the room');
  assert.equal(start.format, 7, 'nor change the format');
});

test('the game advances and broadcasts snapshots', () => {
  const { room } = startedRoom();
  // We pass the pause at the start of the round, during which nothing moves.
  const outgoing = beat(room, ROUND_START_STEPS * STEP_MS + 500);

  const states = of(outgoing, SERVER.STATE);
  assert.ok(states.length > 0, 'snapshots have to go out');
  const last = states[states.length - 1];
  assert.equal(last.j.length, 2, 'two bombers');
  assert.equal(typeof last.t, 'number');
  assert.equal(typeof last.v, 'number');
  assert.ok(Array.isArray(last.b));
  assert.ok(Array.isArray(last.f));
});

test('nothing is broadcast while the arena is frozen', () => {
  const { room } = startedRoom();
  // The start of the round freezes the arena: no snapshot makes sense.
  const outgoing = beat(room, (ROUND_START_STEPS - 10) * STEP_MS);
  assert.equal(of(outgoing, SERVER.STATE).length, 0);
});

test('a late intent is ignored', () => {
  const { room } = startedRoom();
  beat(room, ROUND_START_STEPS * STEP_MS);

  room.message('a', { type: CLIENT.INPUT, seq: 5, dir: 1 }, 2000);
  room.message('a', { type: CLIENT.INPUT, seq: 3, dir: 3 }, 2001);
  // The second one is older: it must not go backwards.
  beat(room, 200, 2001);
  const player = room.game.state.players[0];
  assert.ok(player.x > 0);
});

test('a cut leaves time to come back, and says so', () => {
  const { room } = startedRoom();
  const outgoing = room.leave('a', 1000);

  const [away] = of(outgoing, SERVER.AWAY);
  assert.ok(away);
  assert.equal(away.place, 0);
  assert.equal(away.seconds, Math.round(RESUME_MS / 1000));
  assert.equal(of(outgoing, SERVER.LEFT).length, 0, 'no immediate elimination');
});

test('whoever comes back in time finds their place and their arena', () => {
  const { room } = startedRoom();
  room.leave('a', 1000);
  const outgoing = room.join('a2', { type: CLIENT.JOIN, name: 'Alice', resume: 'a' }, 5000);

  assert.ok(of(outgoing, SERVER.BACK)[0], 'the others are told of the return');
  const [start] = of(outgoing, SERVER.START);
  assert.deepEqual(start.mine, [0], 'they find their place again');
  const [round] = of(outgoing, SERVER.ROUND);
  assert.ok(round.tiles, 'and the arena as it is now');
  assert.equal(round.wait, 0, 'without replaying the start-of-round announcement');
});

test('whoever does not come back is eliminated, once the delay has passed', () => {
  const { room } = startedRoom();
  room.leave('a', 1000);

  const before = beat(room, RESUME_MS - 2000, 1000);
  assert.equal(of(before, SERVER.LEFT).length, 0, 'not before time');

  const after = room.beat(1000 + RESUME_MS + 1);
  const [left] = of(after, SERVER.LEFT);
  assert.ok(left, 'then they go');
  assert.equal(left.place, 0);
  assert.equal(room.game.state.players[0].alive, false);
});

test('a voluntary departure does not keep the others waiting', () => {
  const { room } = startedRoom();
  const outgoing = room.message('a', { type: CLIENT.LEAVE }, 1000);

  assert.equal(of(outgoing, SERVER.AWAY).length, 0, 'we do not wait for whoever slammed the door');
  const [left] = of(outgoing, SERVER.LEFT);
  assert.ok(left);
  assert.equal(room.game.state.players[0].alive, false);
});

test('a resynchronisation sends the grid back to whoever asks for it', () => {
  const { room } = startedRoom();
  const outgoing = room.message('b', { type: CLIENT.RESYNC, v: 0 }, 100);

  const [arena] = of(outgoing, SERVER.ARENA);
  assert.ok(arena);
  assert.equal(arena.tiles.length, 15 * 13);
  assert.equal(to(outgoing, SERVER.ARENA), 'b', 'and to them alone');
});

test('a room empties and declares itself dead', () => {
  const room = createRoom({ code: 'TEST', now: 0, seed: 1 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2 }, 0);
  assert.equal(room.alive, true);
  room.leave('a', 100);
  assert.equal(room.alive, false, 'an empty room closes');
});

test('a stranger who speaks does nothing', () => {
  const { room } = startedRoom();
  assert.deepEqual(room.message('zzz', { type: CLIENT.INPUT, seq: 1, dir: 0 }, 100), []);
  assert.deepEqual(room.leave('zzz', 100), []);
});

test('a free place is null, not a filler label', () => {
  // The waiting room has to tell an empty seat from a seated player: a "Place 3"
  // would show there as somebody already waiting.
  const room = createRoom({ code: 'TEST', now: 0, seed: 1 });
  const outgoing = room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 4, host: true }, 0);

  const [waiting] = of(outgoing, SERVER.WAITING);
  assert.equal(waiting.names[0], 'Alice');
  assert.deepEqual(waiting.names.slice(1), [null, null, null]);
});

test('at the start, no place is free any more', () => {
  const room = createRoom({ code: 'TEST', now: 0, seed: 1 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 4, host: true }, 0);
  const outgoing = room.message('a', { type: CLIENT.BEGIN }, 0);

  const [start] = of(outgoing, SERVER.START);
  assert.equal(start.names.filter((n) => n === null).length, 0, 'the bots all have a first name');
});

test('the snapshot carries the date of the death, not only the fact', () => {
  // The renderer plays the fall frame by frame from that step on. Without it, it
  // stayed on the first frame — a frozen corpse, arms up.
  const { room } = startedRoom();
  beat(room, ROUND_START_STEPS * STEP_MS + 200);

  const victim = room.game.state.players[1];
  victim.alive = false;
  victim.diedAt = room.game.state.step;

  const outgoing = beat(room, 100, 5000);
  const states = of(outgoing, SERVER.STATE);
  assert.ok(states.length > 0);
  const dead = states.at(-1).j.find((j) => j.p === 1);
  assert.equal(dead.e, 0, 'it is indeed announced dead');
  assert.equal(dead.o, victim.diedAt, 'and with the step it fell on');
});

test('the snapshot reports a player cut off but not eliminated yet', () => {
  const { room } = startedRoom();
  beat(room, ROUND_START_STEPS * STEP_MS + 200);
  room.leave('a', 5000);

  const outgoing = beat(room, 100, 5000);
  const last = of(outgoing, SERVER.STATE).at(-1);
  assert.equal(last.j.find((j) => j.p === 0).a, 1, 'the one cut off is reported');
  assert.equal(last.j.find((j) => j.p === 1).a, 0, 'the other one is not');
});

test('the snapshot carries the glove and the date of the punch', () => {
  // Without them, the client did not know it had picked the glove up: the HUD did
  // not show it, and the punch was never seen.
  const { room } = startedRoom();
  beat(room, ROUND_START_STEPS * STEP_MS + 200);

  const player = room.game.state.players[0];
  player.glove = true;
  player.punchedAt = room.game.state.step;

  const last = of(beat(room, 100, 5000), SERVER.STATE).at(-1);
  const seen = last.j.find((j) => j.p === 0);
  assert.equal(seen.n, 1, 'the glove is announced');
  assert.equal(seen.u, player.punchedAt, 'and the step of its punch');
});

test('the colours of whoever laid the table are announced to everybody', () => {
  // A colour is how you find your bomber among ten: the room settles it once,
  // and every screen is handed the same list. A guest who drew their own would
  // be aiming at a green bomber the host sees as red.
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, colours: [4, 7], host: true }, 0);
  const onArrival = room.join('b', { type: CLIENT.JOIN, name: 'Bob', colours: [1, 2] }, 0);

  const waiting = of(onArrival, SERVER.WAITING);
  assert.equal(waiting.length, 2, 'one message per member');
  for (const message of waiting) {
    assert.deepEqual(message.colours, [4, 7], 'the guest does not get a say');
  }
});

test('the start hands out the colours too', () => {
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, colours: [9, 3], host: true }, 0);
  const outgoing = room.join('b', { type: CLIENT.JOIN, name: 'Bob' }, 0);
  assert.equal(of(outgoing, SERVER.START).length, 0);

  const starting = room.message('a', { type: CLIENT.BEGIN }, 0);
  const starts = of(starting, SERVER.START);
  assert.equal(starts.length, 2, 'one per human');
  for (const start of starts) assert.deepEqual(start.colours, [9, 3]);
});

test('a room nobody laid out wears the colours of its places', () => {
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  const alone = room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 3 }, 0);
  assert.deepEqual(of(alone, SERVER.WAITING)[0].colours, [0, 1, 2]);
});

test('coming back finds the same colours', () => {
  // The grace period hands the seat back, and the colours with it: a bomber that
  // changed colour on reconnecting would have to be looked for all over again.
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, colours: [6, 2], host: true }, 0);
  room.join('b', { type: CLIENT.JOIN, name: 'Bob' }, 0);
  room.message('a', { type: CLIENT.BEGIN }, 0);

  room.leave('a', 1000);
  const back = room.join('a2', { type: CLIENT.JOIN, name: 'Alice', resume: 'a' }, 2000);
  assert.deepEqual(of(back, SERVER.START)[0].colours, [6, 2]);
});

test('whoever joins gets the colour they prefer, when nobody wears it', () => {
  // The room is laid out for four, two seats await a human: the colour of a
  // free place is nobody's, so it changes hands without a word.
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 4, colours: [0, 1, 2, 3], host: true }, 0);
  const outgoing = room.join('b', { type: CLIENT.JOIN, name: 'Bob', colour: 3 }, 0);

  const waiting = of(outgoing, SERVER.WAITING)[0];
  assert.deepEqual(waiting.colours, [0, 3, 2, 1], 'Bob takes his colour, place 3 takes his');
  assert.equal(new Set(waiting.colours).size, 4, 'and nobody ends up doubled');
});

test('a colour a human already wears stays on their back', () => {
  // Alice laid the table and sits in red: Bob, who prefers red, keeps his own.
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 4, colours: [2, 1, 0, 3], host: true }, 0);
  const outgoing = room.join('b', { type: CLIENT.JOIN, name: 'Bob', colour: 2 }, 0);

  assert.deepEqual(of(outgoing, SERVER.WAITING)[0].colours, [2, 1, 0, 3]);
});

test('a colour a bot wears changes hands', () => {
  // The host seats a bot at place 1, in blue; Bob arrives preferring blue and
  // lands at place 2. The bot gives way — it does not look for itself.
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 4, colours: [0, 1, 2, 3], host: true }, 0);
  room.message('a', { type: CLIENT.BOT, seat: 1 }, 0);
  const outgoing = room.join('b', { type: CLIENT.JOIN, name: 'Bob', colour: 1 }, 0);

  const waiting = of(outgoing, SERVER.WAITING)[0];
  assert.deepEqual(waiting.colours, [0, 2, 1, 3], 'Bob sits at place 2, the bot takes his colour');
});

test('coming back after a cut does not play the preference again', () => {
  // The seat is held, the colours are settled: a reconnection asks for nothing,
  // otherwise a cut would reshuffle the arena under the other players' eyes.
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, colours: [4, 5], host: true }, 0);
  room.join('b', { type: CLIENT.JOIN, name: 'Bob' }, 0);
  room.message('a', { type: CLIENT.BEGIN }, 0);

  room.leave('b', 1000);
  const back = room.join('b2', { type: CLIENT.JOIN, name: 'Bob', resume: 'b', colour: 4 }, 2000);
  assert.deepEqual(of(back, SERVER.START)[0].colours, [4, 5]);
});

test('the creator lays the table even when a guest got in first', () => {
  // The friend clicked the invitation while the creator was still picking
  // colours. The guest chose nothing: they took a seat, they did not lay out
  // the room — and the creator must not find their own arena in the place
  // order's colours.
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('b', { type: CLIENT.JOIN, name: 'Bob', places: 2 }, 0);
  const outgoing = room.join('a', {
    type: CLIENT.JOIN, name: 'Alice', places: 4, format: 5, colours: [7, 1, 2, 3], host: true,
  }, 0);

  const mine = of(outgoing, SERVER.WAITING).find(() => true);
  assert.ok(mine, 'the room answers');
  assert.equal(mine.max, 4, 'the room is the size the creator asked for');
  // Alice sits at place 1, Bob having taken place 0: her own row's colour
  // follows her there, and Bob takes the one she had laid for that seat.
  assert.deepEqual(mine.colours, [1, 7, 2, 3]);
  assert.equal(outgoing.find((e) => e.to === 'a').message.host, true);
});

test('the room is never shrunk under the players already seated', () => {
  // The creator wants a duel, three players are already sitting down: throwing
  // one out to honour the layout would be worse than a room of three.
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('b', { type: CLIENT.JOIN, name: 'Bob', places: 4 }, 0);
  room.join('c', { type: CLIENT.JOIN, name: 'Carol' }, 0);
  const outgoing = room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, host: true }, 0);

  assert.equal(of(outgoing, SERVER.WAITING)[0].max, 3);
});

test('the room follows its owner back after a cut', () => {
  // A creator who loses their Wi-Fi for two seconds used to come back as a
  // guest: the host was named by the id they no longer had, and the role was
  // dropped as soon as it was looked for.
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 4, colours: [5, 1, 2, 3], host: true }, 0);
  room.join('b', { type: CLIENT.JOIN, name: 'Bob' }, 0);
  room.leave('a', 1000);

  const back = room.join('a2', { type: CLIENT.JOIN, name: 'Alice', resume: 'a', host: true }, 2000);
  const mine = back.find((e) => e.to === 'a2' && e.message.type === SERVER.WAITING);
  assert.ok(mine, 'the waiting room is announced again');
  assert.equal(mine.message.host, true, 'and the room is still theirs');

  room.message('a2', { type: CLIENT.BEGIN }, 2000);
  assert.equal(room.started, true, 'so they can start it');
});

test('the waiting room tells each one its own seat', () => {
  // Without it a page reloaded while waiting cannot ask for its seat back, and
  // sits down next to its own ghost.
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, host: true }, 0);
  const outgoing = room.join('b', { type: CLIENT.JOIN, name: 'Bob' }, 0);

  for (const sent of outgoing.filter((e) => e.message.type === SERVER.WAITING)) {
    assert.equal(sent.message.myId, sent.to);
  }
});

test('a room nobody is in belongs to nobody, and can be opened again', () => {
  // The last to leave takes the announcement with them — nobody is left to
  // announce to — so the host role used to stay pinned to an id that had gone,
  // and the creator coming back found their own room held by a ghost.
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, colours: [7, 1], host: true }, 0);
  room.leave('a', 1000);

  const again = room.join('a2', {
    type: CLIENT.JOIN, name: 'Alice', places: 2, colours: [4, 1], host: true,
  }, 2000);
  const waiting = of(again, SERVER.WAITING)[0];
  assert.equal(waiting.places, 1, 'and nobody is sitting next to them');
  assert.equal(waiting.host, true, 'the room is theirs again');
  assert.deepEqual(waiting.colours, [4, 1], 'laid out as they say now');
});

test('a frame sent to keep the line open does nothing at all', () => {
  // The waiting room says nothing for minutes on end, and an idle connection is
  // closed from the outside — the page therefore sends a ping. The room has
  // nothing to do with it: receiving it is the whole point.
  const room = createRoom({ code: 'TEST', now: 0, seed: 7 });
  room.join('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, host: true }, 0);

  const outgoing = room.message('a', { type: CLIENT.PING }, 0);
  assert.deepEqual(outgoing, [], 'not a word in reply');
  assert.equal(room.started, false, 'and nothing set off');
});
