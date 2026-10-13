import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMatch,
  roundVerdict,
  recordRound,
  matchOver,
  winner,
  standings,
  roundSeed,
  FORMATS,
  MAX_ROUNDS,
} from '../src/engine/round.js';
import { step, advanceBy } from '../src/engine/step.js';
import { ROUND_END_STEPS, TRIGGERS_PER_BONUS } from '../src/engine/constants.js';
import { bareArena, place, input, events } from './helpers.js';

test('an unknown format falls back on the first one', () => {
  assert.equal(createMatch({ places: 2, total: 4 }).total, FORMATS[0]);
  assert.equal(createMatch({ places: 2, total: 5 }).total, 5);
  assert.equal(createMatch({ places: 2, total: 5 }).toWin, 3);
  assert.equal(createMatch({ places: 2 }).toWin, 2);
});

test('the round is not over while two bombers are left', () => {
  const state = bareArena({ places: 3 });
  assert.equal(roundVerdict(state), null);
  state.players[0].alive = false;
  assert.equal(roundVerdict(state), null);
});

test('the last one alive wins the round', () => {
  const state = bareArena({ places: 3 });
  state.players[0].alive = false;
  state.players[2].alive = false;
  assert.deepEqual(roundVerdict(state), { winningPlace: 1, draw: false });
});

test('simultaneous deaths make a drawn round, and nobody scores', () => {
  const state = bareArena({ places: 2 });
  state.players[0].alive = false;
  state.players[1].alive = false;
  const verdict = roundVerdict(state);
  assert.deepEqual(verdict, { winningPlace: null, draw: true });

  const match = recordRound(createMatch({ places: 2 }), verdict);
  assert.deepEqual(match.scores, [0, 0]);
  assert.equal(match.draws, 1);
  assert.equal(match.round, 2);
  assert.equal(matchOver(match), false);
});

test('alone, the round only ends on your own death', () => {
  const state = bareArena({ places: 1 });
  assert.equal(roundVerdict(state), null, 'a single survivor does not end the round');
  state.players[0].alive = false;
  assert.deepEqual(roundVerdict(state), { winningPlace: null, draw: true });
});

test('two rounds won end a best-of-three match', () => {
  let match = createMatch({ places: 2 });
  match = recordRound(match, { winningPlace: 0, draw: false });
  assert.equal(matchOver(match), false);
  match = recordRound(match, { winningPlace: 0, draw: false });
  assert.equal(matchOver(match), true);
  assert.equal(winner(match), 0);
  assert.deepEqual(match.scores, [2, 0]);
});

test('repeated draws do end the match in the end', () => {
  let match = createMatch({ places: 2 });
  for (let i = 0; i < MAX_ROUNDS + 2 && !matchOver(match); i += 1) {
    match = recordRound(match, { winningPlace: null, draw: true });
  }
  assert.equal(matchOver(match), true);
  assert.equal(winner(match), null, 'nobody wins a match of draws');
});

test('a tied match has no winner', () => {
  let match = createMatch({ places: 2, total: 5 });
  match = recordRound(match, { winningPlace: 0, draw: false });
  match = recordRound(match, { winningPlace: 1, draw: false });
  assert.equal(winner(match), null);
  assert.deepEqual(
    standings(match).map((row) => row.place),
    [0, 1],
    'ties are broken by place number, so that the order is the same everywhere',
  );
});

test('every round has its own seed, derived from the match seed', () => {
  const seeds = new Set();
  for (let round = 1; round <= 9; round += 1) seeds.add(roundSeed(4242, round));
  assert.equal(seeds.size, 9, 'no round must replay the same arena');
  // Reproducible: that is what lets the log replay the evening.
  assert.equal(roundSeed(4242, 3), roundSeed(4242, 3));
  assert.notEqual(roundSeed(4242, 3), roundSeed(4243, 3));
  for (let round = 1; round <= 9; round += 1) {
    assert.notEqual(roundSeed(0, round), 0, 'never a zero seed');
  }
});

test('the engine waits for the flames to be out before announcing the verdict', () => {
  const state = bareArena({ places: 2 });
  const one = place(state, 0, 3, 3);
  place(state, 1, 9, 9);
  one.triggers = TRIGGERS_PER_BONUS;

  step(state, input(0, { drop: true }));
  step(state, input(0, { detonate: true }));
  assert.equal(one.alive, false, 'it dies of its own bomb');
  assert.equal(state.phase, 'play', 'the verdict does not come on the step of the death');

  advanceBy(state, ROUND_END_STEPS - 2, []);
  assert.equal(state.phase, 'play');

  // One step at a time: the `round` event only lives on the step it is emitted
  // on, like every other — it goes out in the broadcast and disappears.
  let announced = 0;
  for (let i = 0; i < 5 && state.phase === 'play'; i += 1) {
    step(state, []);
    announced += events(state, 'round').length;
  }
  assert.equal(state.phase, 'verdict');
  assert.deepEqual(state.verdict, { winningPlace: 1, draw: false });
  assert.equal(announced, 1);
});

test('in the verdict phase, the engine no longer moves', () => {
  const state = bareArena({ places: 2 });
  state.phase = 'verdict';
  const before = state.step;
  step(state, input(0, { drop: true }));
  assert.equal(state.step, before);
  assert.equal(state.bombs.length, 0);
});
