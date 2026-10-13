/**
 * Transport: where intents and states travel.
 *
 * The game never touches the engine directly. It pushes intents into a
 * transport, and receives arena views through its subscriptions. The game mode
 * picks the implementation, and nothing else in the page knows how the messages
 * travel — that is what made it possible to plug the relay in later without
 * touching the renderer or the keyboard.
 *
 * Common contract:
 *   start()                 -> Promise<{ places, format, mine: number[] }>
 *   intent(place, input)    -> void   last known intent of a place
 *   beat(nowMs)             -> void   advances time (solo only)
 *   onView(f)               -> () => void   f(view)
 *   onEvents(f)             -> () => void   f(events, step)
 *   onTransition(f)         -> () => void   f(transition)   round / score / finished
 *   onNetState(f)           -> () => void   f(state)        waiting, absence, error
 *   close()                 -> void
 *
 * In solo play, `beat` runs the engine inside the page. Online it is the relay
 * that beats, and `beat` does nothing: the page only has to receive. That is the
 * only visible difference between the two, and it is contained here.
 */

import { randomSeed } from '../engine/rng.js';
import { createGame, stepGame } from '../engine/game.js';
import { createClock, advance } from '../engine/clock.js';
import { EMPTY_INPUT } from '../engine/inputs.js';
import { FORMATS } from '../engine/round.js';

/**
 * Solo and local play: the engine runs in the page, with no latency and no
 * network.
 *
 * @param {{
 *   seed?: number, places?: number, humans?: number, format?: number,
 *   pilots?: Record<number, (state: object, place: number) => object>
 * }} options
 */
export function createLocalTransport({
  seed = randomSeed(),
  places = 2,
  humans = 1,
  format = FORMATS[0],
  pilots = {},
} = {}) {
  const game = createGame({ seed, places, format });
  const intents = Array.from({ length: places }, () => ({ ...EMPTY_INPUT }));
  const views = new Set();
  const events = new Set();
  const transitions = new Set();

  let clock = null;
  let stopped = false;

  function broadcast(set, ...args) {
    for (const subscriber of set) subscriber(...args);
  }

  /**
   * The step's inputs: the humans' as they were pushed, the pilots' computed on
   * the spot.
   *
   * Pulses are consumed here, and not when the keyboard is read: a catch-up step
   * must not drop a second bomb with the same intent.
   */
  function stepInputs() {
    const inputs = [];
    for (let place = 0; place < places; place += 1) {
      const pilot = pilots[place];
      if (pilot) {
        inputs[place] = pilot(game.state, place);
        continue;
      }
      const wanted = intents[place];
      inputs[place] = { ...wanted };
      wanted.drop = false;
      wanted.detonate = false;
    }
    return inputs;
  }

  return {
    async start() {
      clock = null;
      const mine = Array.from({ length: Math.min(humans, places) }, (_, i) => i);
      // The first round is already prepared: we announce it as the relay would,
      // so that the page has only one start-up path.
      queueMicrotask(() =>
        broadcast(transitions, {
          type: 'round',
          round: game.round,
          seed: game.state.seed,
        }),
      );
      return { places, format: game.format, mine, names: null };
    },

    intent(place, input) {
      if (!intents[place]) return;
      intents[place] = {
        dir: input.dir,
        // A pulse already waiting is not lost if the next frame arrives before
        // the simulation step.
        drop: intents[place].drop || input.drop,
        detonate: intents[place].detonate || input.detonate,
        // The held key is a state: the latest reading is the truth, and keeping
        // the older one would carry a bomb somebody has let go of.
        hold: input.hold === true,
      };
    },

    beat(now) {
      if (stopped) return;
      if (clock === null) clock = createClock(now);
      const tick = advance(clock, now);
      clock = tick.clock;

      for (let i = 0; i < tick.steps; i += 1) {
        const result = stepGame(game, stepInputs());
        if (result.events.length > 0) {
          broadcast(events, result.events, game.state.step);
        }
        if (result.transition) broadcast(transitions, result.transition);
      }

      broadcast(views, game.state, game.match);
    },

    onView(f) {
      views.add(f);
      return () => views.delete(f);
    },

    onEvents(f) {
      events.add(f);
      return () => events.delete(f);
    },

    onTransition(f) {
      transitions.add(f);
      return () => transitions.delete(f);
    },

    onNetState() {
      // In solo play there is no network, so nothing to tell.
      return () => {};
    },

    close() {
      stopped = true;
      views.clear();
      events.clear();
      transitions.clear();
    },

    /** Reserved for the tests and for debugging: the engine's live state. */
    game,
  };
}
