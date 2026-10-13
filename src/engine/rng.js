/**
 * Seeded pseudo-random generator (xorshift32).
 *
 * The core is purely functional: drawing a number changes nothing, it returns
 * the value AND the next generator. That is what lets the relay, the browser
 * and the tests see the same arena and the same bonuses from the same seed, and
 * what makes replaying a match from its log possible.
 *
 * One convenience is granted to the engine: `draw(state)`, which advances the
 * generator stored inside the state. The mutation is allowed because the engine
 * owns its state, and only there; nothing else in the project may advance a
 * generator in place.
 */

/** @typedef {{ seed: number }} Rng */

/**
 * @param {number} seed initial seed (0 becomes 1, xorshift would be stuck there)
 * @returns {Rng}
 */
export function createRng(seed) {
  const normalised = seed >>> 0;
  return { seed: normalised === 0 ? 1 : normalised };
}

/**
 * Draws a float in [0, 1).
 * @param {Rng} rng
 * @returns {{ rng: Rng, value: number }}
 */
export function nextRandom(rng) {
  let x = rng.seed;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return { rng: { seed: x }, value: x / 0x100000000 };
}

/**
 * Draws an integer in [0, bound). Returns 0 when the bound makes no sense.
 * @param {Rng} rng
 * @param {number} bound
 * @returns {{ rng: Rng, value: number }}
 */
export function nextInt(rng, bound) {
  const drawn = nextRandom(rng);
  if (!Number.isFinite(bound) || bound <= 0) return { rng: drawn.rng, value: 0 };
  return { rng: drawn.rng, value: Math.min(bound - 1, Math.floor(drawn.value * bound)) };
}

/**
 * Advances the generator stored in a holder (the engine state) and returns the
 * float drawn. Only the engine uses this.
 *
 * @param {{ rng: Rng }} holder
 * @returns {number}
 */
export function draw(holder) {
  const drawn = nextRandom(holder.rng);
  holder.rng = drawn.rng;
  return drawn.value;
}

/**
 * Same, for an integer in [0, bound).
 *
 * @param {{ rng: Rng }} holder
 * @param {number} bound
 * @returns {number}
 */
export function drawInt(holder, bound) {
  const drawn = nextInt(holder.rng, bound);
  holder.rng = drawn.rng;
  return drawn.value;
}

/**
 * Shuffles a copy of the array (Fisher-Yates), leaving the original alone.
 * @template T
 * @param {readonly T[]} items
 * @param {Rng} rng
 * @returns {{ rng: Rng, items: T[] }}
 */
export function shuffle(items, rng) {
  const out = items.slice();
  let current = rng;
  for (let i = out.length - 1; i > 0; i -= 1) {
    const drawn = nextInt(current, i + 1);
    current = drawn.rng;
    const j = drawn.value;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return { rng: current, items: out };
}

/** Random seed, for solo play only: online it comes from the relay. */
export function randomSeed() {
  return (Math.random() * 0x100000000) >>> 0;
}
