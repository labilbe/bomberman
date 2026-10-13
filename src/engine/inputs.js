/**
 * Bomber inputs: what a player wants on a given step.
 *
 * Two kinds of field, and the distinction matters:
 *
 * - `dir` is a HELD STATE. As long as the key is down the direction stays, and
 *   a lost message changes nothing: the next one states it again.
 * - `drop` and `detonate` are PULSES, true exactly once. The engine consumes
 *   them on the next step. A held state would have dropped one bomb per step
 *   while the key was held; a lost pulse only loses one bomb — and the network
 *   does not lose it, since it is resent until the relay acknowledges it.
 * - `hold` is the bomb key HELD DOWN, and it is the blue glove's whole gesture:
 *   you keep the key pressed to carry a bomb and let go to throw it. A pulse
 *   could not say that — "still holding" is a state, and the only one here that
 *   lasts as long as the player wants it to.
 *
 * `normalise` exists because these objects come off the network: they are built
 * by a stranger, and nothing guarantees they look like this.
 */

/** @typedef {{ dir: -1|0|1|2|3, drop: boolean, detonate: boolean, hold: boolean }} Input */

/** @type {Input} */
export const EMPTY_INPUT = Object.freeze({ dir: -1, drop: false, detonate: false, hold: false });

/**
 * Brings anything back to a usable input. -1 means "standing still".
 *
 * @param {unknown} raw
 * @returns {Input}
 */
export function normalise(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_INPUT };
  const source = /** @type {Record<string, unknown>} */ (raw);
  const dir = Number(source.dir);
  return {
    dir: Number.isInteger(dir) && dir >= 0 && dir <= 3 ? /** @type {0|1|2|3} */ (dir) : -1,
    drop: source.drop === true,
    detonate: source.detonate === true,
    hold: source.hold === true,
  };
}

/**
 * A set of empty inputs, one per place.
 *
 * @param {number} count
 * @returns {Input[]}
 */
export function emptyInputs(count) {
  return Array.from({ length: count }, () => ({ ...EMPTY_INPUT }));
}
