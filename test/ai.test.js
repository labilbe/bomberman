import test from 'node:test';
import assert from 'node:assert/strict';

import { decide, createMemory, createPilot, REFLEX_STEPS } from '../src/ai/pilot.js';
import { dangerMap, escape, walk, SAFE } from '../src/ai/danger.js';
import { createGame, stepGame } from '../src/engine/game.js';
import { drop } from '../src/engine/bombs.js';
import { step } from '../src/engine/step.js';
import { index, cellOnAxis, cellAt, isFree } from '../src/engine/grid.js';
import { FUSE_STEPS, VECTORS } from '../src/engine/constants.js';
import { bareArena, brick, place, input } from './helpers.js';

test('the danger map covers the blast and stops at the walls', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 3);
  player.range = 2;
  drop(state, player);
  const danger = dangerMap(state);

  assert.equal(danger[index(3, 3)], FUSE_STEPS, 'the bomb cell');
  assert.equal(danger[index(5, 3)], FUSE_STEPS, 'two cells away, within range');
  assert.equal(danger[index(6, 3)], SAFE, 'beyond the range');
  // (2,2) is a checkerboard pillar: nothing gets through it.
  assert.equal(danger[index(1, 1)], SAFE);
});

test('a brick stops the blast, hence the danger', () => {
  const state = bareArena();
  brick(state, 4, 3);
  const player = place(state, 0, 3, 3);
  player.range = 4;
  drop(state, player);
  const danger = dangerMap(state);
  assert.equal(danger[index(5, 3)], SAFE, 'behind the brick you are sheltered');
});

test('a shelter is a cell nothing threatens, not one you reach in time', () => {
  // The historic trap: the bomb's own cell is reachable "in time" since you are
  // already there, and a fuse lasts two and a half seconds.
  const state = bareArena();
  const player = place(state, 0, 3, 3);
  drop(state, player);
  const wayOut = escape(state, player, dangerMap(state));
  assert.ok(wayOut, 'a way out must exist in a bare arena');
  assert.equal(wayOut.safe, true);
  assert.ok(wayOut.distance > 0, 'staying on your bomb is not an escape');
  assert.ok(wayOut.dir >= 0);
});

test('the walk avoids threatened cells when asked to', () => {
  const state = bareArena();
  const player = place(state, 0, 3, 3);
  player.range = 2;
  drop(state, player);
  const danger = dangerMap(state);

  const free = walk(state, 3, 5);
  const careful = walk(state, 3, 5, { avoid: danger });
  assert.ok(free.distance[index(3, 1)] > 0, 'with no guard, we go through the blast');
  assert.equal(careful.distance[index(3, 1)], -1, 'with the guard, the way is cut');
});

test('a bot standing on a threatened cell moves away from it', () => {
  const state = bareArena({ places: 2 });
  const player = place(state, 0, 3, 3);
  drop(state, player);

  const { input: intent } = decide(state, 0, createMemory());
  assert.ok(intent.dir >= 0, 'it has to choose a direction');
  const v = VECTORS[intent.dir];
  const danger = dangerMap(state);
  // The direction chosen has to lead out of the blast, or towards a safer cell.
  const neighbour = danger[index(3 + v.dx, 3 + v.dy)];
  assert.ok(neighbour >= danger[index(3, 3)], 'it must not head for the worse');
});

test('a bot does not drop a bomb in a dead end it is at the bottom of', () => {
  // A one-cell corridor, closed: dropping here is dying.
  const state = bareArena({ places: 2 });
  brick(state, 1, 2);
  brick(state, 2, 1);
  const player = place(state, 0, 1, 1);

  const { input: intent } = decide(state, 0, createMemory());
  assert.equal(intent.drop, false, 'no way out: no bomb');
});

test('a bot drops when a brick is within range and it can flee', () => {
  const state = bareArena({ places: 2 });
  brick(state, 4, 3);
  place(state, 0, 3, 3);
  const { input: intent } = decide(state, 0, createMemory());
  assert.equal(intent.drop, true);
});

test('decide is pure: it does not touch the state and it repeats', () => {
  const state = bareArena({ places: 2 });
  brick(state, 5, 3);
  place(state, 0, 3, 3);
  const before = JSON.stringify({
    tiles: [...state.tiles],
    items: [...state.items],
    players: state.players,
    bombs: state.bombs,
    rng: state.rng,
  });

  const memory = createMemory();
  const one = decide(state, 0, memory);
  const two = decide(state, 0, memory);

  assert.deepEqual(one.input, two.input, 'same state and same memory, same intent');
  assert.deepEqual(one.memory, two.memory);
  assert.equal(
    JSON.stringify({
      tiles: [...state.tiles],
      items: [...state.items],
      players: state.players,
      bombs: state.bombs,
      rng: state.rng,
    }),
    before,
    'the state must not have moved',
  );
});

test('between two decisions, the bot holds its course without dropping again', () => {
  const state = bareArena({ places: 2 });
  brick(state, 4, 3);
  place(state, 0, 3, 3);
  let memory = createMemory();
  const first = decide(state, 0, memory);
  memory = first.memory;
  assert.equal(first.input.drop, true);

  for (let i = 1; i < REFLEX_STEPS; i += 1) {
    step(state, input(0, {}));
    const next = decide(state, 0, memory);
    assert.equal(next.input.drop, false, 'the drop is a pulse, never held');
    assert.equal(next.input.dir, memory.dir, 'the course is held');
  }
});

test('a dead bot asks for nothing any more', () => {
  const state = bareArena({ places: 2 });
  state.players[0].alive = false;
  const { input: intent } = decide(state, 0, createMemory());
  assert.deepEqual(intent, { dir: -1, drop: false, detonate: false, hold: false });
});

test('four bots play a whole game without bogging down', () => {
  // The real judge of the AI: complete, reproducible matches where what happens
  // is counted. The thresholds are deliberately wide — this is a guard against
  // gross regressions, not a contest of strength.
  let finished = 0;
  let bricksBroken = 0;
  let deaths = 0;
  let own = 0;
  let draws = 0;
  let rounds = 0;

  const MATCHES = 40;
  for (let n = 0; n < MATCHES; n += 1) {
    const game = createGame({ seed: 5000 + n * 13, places: 4, format: 3 });
    const pilots = [0, 1, 2, 3].map((i) =>
      createPilot({ level: ['quiet', 'normal', 'nasty', 'normal'][i] }),
    );
    for (let i = 0; i < 60 * 240 && !game.over; i += 1) {
      const owners = new Map(game.state.bombs.map((bomb) => [bomb.id, bomb.place]));
      const result = stepGame(
        game,
        pilots.map((pilot, place) => pilot(game.state, place)),
      );
      const explosions = result.events
        .filter((event) => event[0] === 'boom')
        .map((event) => owners.get(event[1]));
      for (const event of result.events) {
        if (event[0] === 'brick') bricksBroken += 1;
        if (event[0] !== 'death') continue;
        deaths += 1;
        if (explosions.length > 0 && explosions.every((place) => place === event[1])) {
          own += 1;
        }
      }
      if (result.transition?.type === 'score') {
        rounds += 1;
        if (result.transition.verdict.draw) draws += 1;
      }
    }
    if (game.over) finished += 1;
  }

  // Not "all", but "almost all", and the threshold comes from measurement: over
  // 100 simulated matches, 98 finish. The two that remain are two cautious
  // survivors circling each other until time runs out — an unstable balance,
  // very sensitive to the seed. Demanding 12 out of 12 therefore made the test
  // fail on a single unlucky seed.
  //
  // For the record: with the starting range at ONE cell, 100 matches out of 100
  // finished. Moving to two — Atomic Bomberman's value — costs those 2 %.
  assert.ok(finished / MATCHES >= 0.9, `too many matches bogged down: ${MATCHES - finished}/${MATCHES}`);
  assert.ok(bricksBroken > MATCHES * 20, `too few bricks broken: ${bricksBroken}`);
  assert.ok(own / deaths < 0.25, `too many bots killed by their own bomb: ${own}/${deaths}`);
  assert.ok(draws / Math.max(1, rounds) < 0.5, `too many drawn rounds: ${draws}/${rounds}`);
});

test('the escape does not cross a cell that will burn before we leave it', () => {
  // A long corridor, a bomb underfoot: the only shelter is at the end, and the
  // whole way runs through the blast. The bot has to refuse to go rather than set
  // off and explode on the way — that is the flaw that caused one death in five,
  // the escape looking for the nearest shelter without ever checking that it got
  // there in time.
  const state = bareArena();
  const player = place(state, 0, 1, 1);
  player.range = 9;
  // A tortoise's speed: even the neighbouring cell is no longer reachable in
  // time.
  player.speed = 8;
  drop(state, player);

  const wayOut = escape(state, player, dangerMap(state));
  assert.equal(wayOut, null, 'no escape must be offered');
});

test('the escape returns a shelter when it is reachable in time', () => {
  const state = bareArena();
  const player = place(state, 0, 1, 1);
  player.range = 1;
  drop(state, player);

  const wayOut = escape(state, player, dangerMap(state));
  assert.ok(wayOut, 'a way out exists');
  assert.equal(wayOut.safe, true, 'and it leads out of danger');
  const stepsPerCell = Math.ceil(1024 / player.speed);
  assert.ok(wayOut.distance * stepsPerCell < FUSE_STEPS, 'reachable before the explosion');
});

test('a bot almost never dies of its own bomb', () => {
  // The check that really counts: four bots are made to play and the deaths on
  // one's own bomb are counted. Before the dated escape, there was ONE IN FIVE —
  // it was this AI's most visible flaw.
  let suicides = 0;
  let deaths = 0;

  /** Is the cell (x, y) in a bomb's cross, walls included? */
  const inTheCross = (state, bomb, x, y) => {
    if (bomb.x === x && bomb.y === y) return true;
    for (const v of VECTORS) {
      for (let k = 1; k <= bomb.range; k += 1) {
        const cx = bomb.x + v.dx * k;
        const cy = bomb.y + v.dy * k;
        if (!isFree(cellAt(state, cx, cy))) break;
        if (cx === x && cy === y) return true;
      }
    }
    return false;
  };

  for (let seed = 1; seed <= 60; seed += 1) {
    const state = createGame({ seed, places: 4 }).state;
    const pilots = [0, 1, 2, 3].map(() => createPilot({ level: 'normal' }));
    const last = [null, null, null, null];

    for (let t = 0; t < 60 * 60 && state.players.filter((j) => j.alive).length > 1; t += 1) {
      const inputs = state.players.map((j, k) => (j.alive ? pilots[k](state, k) : undefined));
      step(state, inputs);
      for (const ev of state.events) {
        if (ev[0] === 'bomb') {
          const owner = state.players.find((j) => j.place === ev[3]);
          last[ev[3]] = { x: ev[1], y: ev[2], range: owner.range, step: state.step };
        }
        if (ev[0] !== 'death') continue;
        deaths += 1;
        const mine = last[ev[1]];
        const dead = state.players.find((j) => j.place === ev[1]);
        if (!mine || state.step - mine.step > FUSE_STEPS + 30) continue;
        if (inTheCross(state, mine, cellOnAxis(dead.x), cellOnAxis(dead.y))) suicides += 1;
      }
    }
  }

  assert.ok(deaths > 100, `sample too thin: ${deaths} deaths`);
  // The threshold is not zero, and the reason is written in danger.js: the danger
  // map does not simulate CHAINS. A bomb caught in another's explosion goes off
  // before the end of its fuse, and the bot that counted on that delay gets
  // caught. It is an accepted choice — simulating chains would cost a queue per
  // call, sixty times a second and per bot.
  //
  // The measurements: 21 % before the dated escape, 2.6 % after over 600 deaths,
  // and 4.3 % on this test's shorter sample. So the threshold sits at 8 % — high
  // enough not to flicker from one seed to the next, low enough for a return to
  // the old escape to fail it by a wide margin.
  const share = suicides / deaths;
  assert.ok(share < 0.08, `${suicides} deaths on one's own bomb out of ${deaths} (${Math.round(share * 100)} %)`);
});

test('a memory kept from the previous round does not freeze the bot', () => {
  // The round restarts `state.step` at zero while the pilot keeps its memory
  // from one round to the next: the survivor of a round arrived in the next one
  // with a `since` in the thousands, and `step - since` stayed negative for the
  // whole round. It held its last direction, dropped nothing, and only woke up
  // when a blast finally reached its cell.
  const state = bareArena();
  brick(state, 4, 3);
  place(state, 0, 3, 3);
  const stale = { dir: -1, drop: false, since: 2000 };

  const { input: intent } = decide(state, 0, stale);
  assert.ok(intent.drop || intent.dir >= 0, 'the bot must decide, not hold a dead course');
});
