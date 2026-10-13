/**
 * One step of simulation, and the order in which it unfolds.
 *
 * There is no duration parameter, deliberately: a step of variable duration
 * would make physics depend on the display rate, and two machines would never
 * reach the same result. It is `clock.js` that turns wall-clock time into a
 * whole number of calls to `step`.
 *
 * THE ORDER BELOW IS THE ENGINE'S CONTRACT. Three points are decided in it, and
 * each fixes an unfairness you only see while playing:
 *
 * - Dropping BEFORE moving. "Drop then flee" is the game's fundamental gesture.
 *   If you moved first, the bomb would appear on the cell you arrive at and the
 *   player would die of their own reflex.
 * - Kicked bombs BEFORE the bombers. A bomb moving after them would pass
 *   through them in one step, each seeing the other at its previous position.
 * - Burning BEFORE picking up. You do not pick up while dying, and a bonus under
 *   a flame is destroyed, not pocketed.
 */

import { ROUND_END_STEPS, DOUBLE_TAP_STEPS } from './constants.js';
import { EMPTY_INPUT } from './inputs.js';
import { record } from './state.js';
import {
  drop,
  lineUp,
  punch,
  detonate,
  grabBomb,
  throwCarried,
  carriedBy,
  advanceFuses,
  advanceSlides,
  advanceFlights,
  advanceCarried,
  bombDroppedAt,
} from './bombs.js';
import { movePlayers } from './collision.js';
import { cellOnAxis } from './grid.js';
import {
  resolveChain,
  burnItems,
  burnPlayers,
  pickBonuses,
  ageFlames,
  ageRubble,
} from './explosion.js';
import { roundVerdict } from './round.js';

/** The input of a place, or standing still while the network has not said yet. */
function inputOf(inputs, place) {
  const input = inputs[place];
  return input ?? EMPTY_INPUT;
}

/**
 * Is there, under this bomber's feet, a bomb the blue glove could lift?
 *
 * Not the one dropped by the press still held down: see `holdDropped`. And
 * nothing at all without the bonus, which is what keeps every other bomber's
 * bomb key exactly as it was.
 */
function liftableUnder(state, player) {
  if (!player.grab || !player.alive) return false;
  if (carriedBy(state, player.place) !== null) return false;
  const bomb = bombDroppedAt(state, cellOnAxis(player.x), cellOnAxis(player.y));
  return bomb !== null && bomb.id !== player.holdDropped;
}

/**
 * Decides whether the round is over, after a grace period.
 *
 * The pause is not cosmetic: the last flame must have finished burning and the
 * eye must have seen who died. Announcing the verdict on the very step of the
 * last death would feel as if the game had cut out.
 */
function conclude(state) {
  const verdict = roundVerdict(state);
  if (verdict === null) {
    state.endsAt = null;
    return;
  }
  if (state.endsAt === null) {
    state.endsAt = state.step + ROUND_END_STEPS;
    return;
  }
  if (state.step < state.endsAt) return;
  state.phase = 'verdict';
  state.verdict = verdict;
  record(state, ['round', verdict.winningPlace, verdict.draw ? 1 : 0]);
}

/**
 * Advances the game by EXACTLY one step. Mutates `state` and returns it.
 *
 * Same seed + same sequence of inputs = same sequence of states, on any
 * machine: that, and not immutability, is what makes replay and tests possible.
 *
 * @param {import('./state.js').State} state
 * @param {import('./inputs.js').Input[]} inputs indexed by place
 * @returns {import('./state.js').State} the same object
 */
export function step(state, inputs = []) {
  state.events.length = 0;
  if (state.phase === 'verdict') return state;
  state.step += 1;

  for (const player of state.players) {
    const input = inputOf(inputs, player.place);

    // THE BLUE GLOVE IS THE BOMB KEY HELD DOWN, and the order of this block is
    // the whole gesture: press to drop, keep pressing over a bomb to take it in
    // your hands, let go to throw it. One key, three meanings.
    //
    // A BOMB ONE COULD LIFT TAKES THE KEY OVER. Without the blue glove nothing
    // changes; with it, pressing while standing on a bomb means "that one, into
    // my hands", and neither drops nor bursts. The two gestures needed the same
    // second press and could not both have it: dropping on an occupied square
    // was refused anyway, and a burst that went off while one meant to lift
    // emptied the magazine at one's own feet — which is how it was found.
    const liftable = liftableUnder(state, player);

    if (input.drop && !liftable) {
      // DOUBLE TAP = BURST. The first drops under the feet; the second, if it
      // follows closely, lines up everything left in front.
      //
      // ONLY A SUCCESSFUL DROP ARMS THE GESTURE. A press that gives nothing — no
      // bombs left in reserve, or one already underfoot — is common: you hammer
      // the button while fleeing. If it armed the burst, the gesture would go off
      // by itself on the next useful press, and you would empty your magazine
      // without having asked.
      //
      // Hands full, no drop: you are holding the bomb you would be dropping.
      const carrying = carriedBy(state, player.place) !== null;
      const double = player.droppedAt !== null && state.step - player.droppedAt <= DOUBLE_TAP_STEPS;
      const dropped = carrying
        ? null
        : (double ? (lineUp(state, player) > 0 ? state.bombs.at(-1) : null) : drop(state, player));
      if (dropped) {
        player.droppedAt = state.step;
        player.holdDropped = dropped.id;
      }
    }

    if (input.hold) {
      // Taken on a step where the key is merely held: a bomb walked onto with
      // the key already down comes up by itself, which is what "carrying" means.
      grabBomb(state, player);
    } else {
      // LETTING GO THROWS. The hand opens, the bomb goes where a punch would
      // have sent it — over the walls, to the first hole past three cells.
      if (throwCarried(state, player) && player.alive) player.punchedAt = state.step;
      player.holdDropped = null;
    }
  }

  for (const player of state.players) {
    if (!inputOf(inputs, player.place).detonate) continue;

    // THE SAME BUTTON PUNCHES AND DETONATES, and it is the trigger button, not
    // the bomb one. Both commands say "that bomb there, the one at hand, now";
    // dropping says the opposite. Sharing them therefore adds no key to
    // remember — which counts on a two-button pad — and leaves dropping clean:
    // pressing bomb drops a bomb, always.
    //
    // The punch comes first when there is something to punch. Standing on your
    // own bomb with the glove, you therefore send it away instead of blowing it
    // up where you stand: it is the safer reading of the two, since the other
    // kills whoever presses.
    //
    // The GESTURE is played as soon as the button is pressed with the glove,
    // even when no bomb sets off: punching thin air has to be visible, otherwise
    // the bonus looks inert and you think the key is dead.
    if (player.glove && player.alive) player.punchedAt = state.step;
    if (punch(state, player)) continue;

    const bomb = detonate(state, player);
    // A fuse at 1 goes off on this step's collection: the trigger therefore has
    // no path of its own, it borrows that of the fuses and the whole chain with
    // it.
    if (bomb) bomb.fuse = 1;
  }

  advanceSlides(state);
  advanceFlights(state);
  movePlayers(state, inputs);
  // The carried bombs follow AFTER their carriers have moved: a bomb left on the
  // cell behind would burn the one square its owner has just left.
  advanceCarried(state);

  const done = advanceFuses(state);
  const { fresh } = resolveChain(state, done);
  burnItems(state, fresh);
  burnPlayers(state);
  pickBonuses(state);
  ageFlames(state);
  // Bricks fall AFTER the pickups: the one finishing its fall on this step opens
  // its cell and shows its bonus, which will therefore only be pickable on the
  // next step — you do not pick up through a brick that has just fallen.
  ageRubble(state);
  conclude(state);

  return state;
}

/**
 * Plays several steps in a row, with the same inputs. A shortcut for the tests
 * and for catching up.
 *
 * @param {import('./state.js').State} state
 * @param {number} count
 * @param {import('./inputs.js').Input[]} inputs
 */
export function advanceBy(state, count, inputs = []) {
  for (let i = 0; i < count; i += 1) step(state, inputs);
  return state;
}
