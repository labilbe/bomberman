/**
 * Turning wall-clock time into simulation steps.
 *
 * The engine takes no `dt`: a step of variable duration would make physics
 * depend on the display rate, and two machines would never reach the same
 * result. So this is where, and only where, real time enters the game — to be
 * converted into a WHOLE NUMBER of calls to `step()`.
 *
 * Two very different callers depend on it: the browser's render loop in solo
 * play, and the relay's `setInterval` online. Without this module that
 * computation would be written twice, and wrongly once.
 *
 * The catch-up ceiling is the protection that matters: a tab coming back from
 * the background sometimes announces thirty seconds at once, and replaying 1800
 * steps in a single frame would freeze the page before killing everyone.
 */

import { STEP_MS } from './constants.js';

/** Beyond this, lost time is let go rather than caught up. */
export const MAX_CATCHUP = 6;

/** @typedef {{ carry: number, last: number }} Clock */

/**
 * @param {number} now timestamp in ms (any origin, only the gaps matter)
 * @returns {Clock}
 */
export function createClock(now) {
  return { carry: 0, last: now };
}

/**
 * How many steps to play, and the next clock.
 *
 * @param {Clock} clock
 * @param {number} now
 * @returns {{ clock: Clock, steps: number }}
 */
export function advance(clock, now) {
  const elapsed = now - clock.last;
  // A clock going backwards (daylight saving, a silly timestamp off the
  // network) must not make the game go backwards.
  const useful = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  const total = clock.carry + useful;
  const wanted = Math.floor(total / STEP_MS);
  const steps = Math.min(wanted, MAX_CATCHUP);
  // The remainder is only kept for the steps actually played: past the ceiling
  // lost time is lost for good, otherwise it would come back next frame.
  const carry = wanted > MAX_CATCHUP ? 0 : total - wanted * STEP_MS;
  return { clock: { carry, last: now }, steps };
}
