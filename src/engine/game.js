/**
 * Chaining the rounds: the game above the arena.
 *
 * This module is pure and clockless, like the rest of the engine, and that is
 * deliberate: it will run INSIDE THE RELAY online and in the page in solo play.
 * If the chaining of rounds lived in the browser, solo and network play would
 * have two different end-of-match rules, and that is exactly the kind of gap you
 * only discover in a final.
 *
 * It exposes a single advancing function, `stepGame`, which returns the
 * TRANSITIONS: new round, score, end of match. The caller only has to broadcast
 * or display them, and never decides for itself where the evening stands.
 */

import { createState } from './state.js';
import { DEFAULT_DURATION } from './constants.js';
import { step } from './step.js';
import {
  createMatch,
  recordRound,
  matchOver,
  winner,
  standings,
  roundSeed,
  FORMATS,
} from './round.js';

/** How long the scoreboard is shown between two rounds: 3 seconds. */
export const ROUND_PAUSE_STEPS = 180;

/**
 * How long everything stands still at the START of a round: 1.2 seconds.
 *
 * The arena is laid out, visible and frozen while "Round N" is announced.
 * Without that the announcement appeared over a game already running: the bots
 * had time to drop a bomb before the player had finished reading, and the round
 * started without them.
 *
 * It is the engine that holds this countdown, and not the page hiding its banner
 * after a `setTimeout`. Online, each browser would have had its own delay while
 * the relay simulated: the round would have started at a different instant for
 * everyone.
 */
export const ROUND_START_STEPS = 72;

/**
 * @typedef {{
 *   seed: number, format: number, places: number,
 *   match: import('./round.js').Match,
 *   state: import('./state.js').State,
 *   round: number, pause: number, start: number, counting: boolean, over: boolean
 * }} Game
 */

/**
 * @param {{ seed: number, places: number, format?: number }} options
 * @returns {Game}
 */
export function createGame({ seed, places, format = FORMATS[0], duration = DEFAULT_DURATION }) {
  const match = createMatch({ places, total: format });
  return {
    seed,
    format: match.total,
    places,
    // How long each round of THIS match runs before the arena closes in. Held
    // by the game and not by the state, because every round of a match gets the
    // same one: it is a setting of the table, like the number of rounds.
    duration,
    match,
    state: createState({ seed: roundSeed(seed, 1), places, duration }),
    round: 1,
    pause: 0,
    start: ROUND_START_STEPS,
    counting: false,
    over: false,
  };
}

/** The state of a fresh round, for the game's current round. */
function newRound(game) {
  game.state = createState({
    seed: roundSeed(game.seed, game.round),
    places: game.places,
    duration: game.duration,
  });
  game.start = ROUND_START_STEPS;
  return {
    type: 'round',
    round: game.round,
    seed: game.state.seed,
    // The caller lines its announcement up with this duration rather than
    // choosing its own: two countdowns would end up diverging.
    wait: ROUND_START_STEPS,
  };
}

/**
 * Advances the game by one step.
 *
 * @param {Game} game
 * @param {import('./inputs.js').Input[]} inputs
 * @returns {{ events: unknown[][], transition: Record<string, unknown> | null }}
 */
export function stepGame(game, inputs = []) {
  if (game.over) return { events: [], transition: null };

  // Between two rounds: the arena is frozen, only the scoreboard is alive.
  if (game.pause > 0) {
    game.pause -= 1;
    if (game.pause > 0) return { events: [], transition: null };
    game.round = game.match.round;
    return { events: [], transition: newRound(game) };
  }

  // Start of a round: the arena is in place but nobody moves yet, neither
  // players nor bots. Intents received during that time are ignored, since
  // `step` is not called.
  if (game.start > 0) {
    game.start -= 1;
    return { events: [], transition: null };
  }

  step(game.state, inputs);
  const events = game.state.events;

  if (game.state.phase !== 'verdict' || game.counting) {
    return { events, transition: null };
  }

  // The verdict has just come in: we count it once and once only.
  game.counting = true;
  game.match = recordRound(game.match, game.state.verdict);

  if (matchOver(game.match)) {
    game.over = true;
    return {
      events,
      transition: {
        type: 'finished',
        winner: winner(game.match),
        scores: game.match.scores.slice(),
        standings: standings(game.match),
      },
    };
  }

  game.pause = ROUND_PAUSE_STEPS;
  game.counting = false;
  return {
    events,
    transition: {
      type: 'score',
      verdict: game.state.verdict,
      scores: game.match.scores.slice(),
      round: game.round,
      wait: ROUND_PAUSE_STEPS,
    },
  };
}

/** Is the game waiting between two rounds? */
export function paused(game) {
  return game.pause > 0;
}

/** Is the arena frozen, for one reason or another? */
export function frozen(game) {
  return game.pause > 0 || game.start > 0;
}
