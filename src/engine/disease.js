/**
 * The skull: the illnesses it hands out, what they change, and how they spread.
 *
 * An illness is NOT a bonus turned negative, and that is the whole design here.
 * A bonus is acquired and kept; an illness is a STATE WITH AN END DATE, stored
 * as a name and the step it runs out on. The difference matters at exactly one
 * place — a bomber's powers are never touched. `player.speed` and
 * `player.range` keep what was picked up, and the three readers below return
 * what the illness makes of them for as long as it lasts. Writing the handicap
 * into the powers themselves would have required giving them back on recovery,
 * and a round that ends mid-illness, a death, or a second skull would each have
 * had their own way of losing a bonus for good.
 *
 * The three readers are therefore the ONLY door between an illness and the
 * rules. Anything that wants a pace, a fuse or a blast length goes through
 * them; nothing else in the engine knows that illnesses exist.
 */

import {
  DISEASE_STEPS,
  FUSE_STEPS,
  MAX_SPEED,
  SHORT_FUSE_STEPS,
  SICK_SPEED,
  TINY_RANGE,
  UNITS,
} from './constants.js';
import { drawInt } from './rng.js';

/**
 * The illnesses, by their network names.
 *
 * Five, and each one hits a different thing: how you walk, when your bombs go
 * off, how far they reach, and whether you drop them at all. Two that did the
 * same thing in different words would only make the skull look random.
 */
export const ILLNESSES = {
  /** The runs: a bomb drops by itself at every step it can. */
  COLIC: 'colic',
  /** A fuse of 0.6 s. */
  SHORT: 'short',
  /** A blast of one cell, whatever the flames picked up. */
  TINY: 'tiny',
  /** Leaden legs. */
  SLOW: 'slow',
  /** Mad legs: top speed, and no way to stop short of a wall. */
  RUSH: 'rush',
};

/**
 * Equal weights on purpose.
 *
 * The skull is already rare; making one of its faces rarer on top of that would
 * mean a player could go a whole match without ever meeting it, and an illness
 * nobody has seen is an illness nobody can read on somebody else's screen.
 */
const KINDS = [
  ILLNESSES.COLIC,
  ILLNESSES.SHORT,
  ILLNESSES.TINY,
  ILLNESSES.SLOW,
  ILLNESSES.RUSH,
];

/** True while this bomber is carrying an illness. */
export function isIll(player, step) {
  return player.illness !== null && step < player.illnessUntil;
}

/**
 * Hands an illness to a bomber, drawn from the state's SEEDED generator.
 *
 * Seeded, like the arena and the scattered loot: the relay and a replay have to
 * hand out the same skull, or the two diverge on the first one picked up.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 * @param {string | null} kind the illness to pass on, or null to draw a fresh one
 */
export function infect(state, player, kind = null) {
  player.illness = kind ?? KINDS[drawInt(state, KINDS.length)];
  // Counted from NOW, including when it is passed on: whoever receives it gets
  // the full fifteen seconds. Handing on the three seconds one had left would
  // have made the gesture worthless to the giver and harmless to the receiver.
  player.illnessUntil = state.step + DISEASE_STEPS;
}

/** Cures a bomber. Also what the end of a round and a death go through. */
export function cure(player) {
  player.illness = null;
  player.illnessUntil = 0;
}

/**
 * The pace this bomber actually walks at.
 *
 * @param {import('./state.js').Player} player
 * @param {number} step
 */
export function speedOf(player, step) {
  if (!isIll(player, step)) return player.speed;
  if (player.illness === ILLNESSES.SLOW) return SICK_SPEED;
  if (player.illness === ILLNESSES.RUSH) return MAX_SPEED;
  return player.speed;
}

/**
 * The fuse the bomb being dropped gets.
 *
 * @param {import('./state.js').Player} player
 * @param {number} step
 */
export function fuseOf(player, step) {
  return isIll(player, step) && player.illness === ILLNESSES.SHORT
    ? SHORT_FUSE_STEPS
    : FUSE_STEPS;
}

/**
 * The reach the bomb being dropped gets.
 *
 * Read at the DROP, like the jelly: a bomb already on the ground keeps the
 * blast it was dropped with, and recovering mid-fuse does not lengthen it.
 *
 * @param {import('./state.js').Player} player
 * @param {number} step
 */
export function rangeOf(player, step) {
  return isIll(player, step) && player.illness === ILLNESSES.TINY
    ? TINY_RANGE
    : player.range;
}

/** True when the illness drops bombs in the bomber's place. */
export function dropsByItself(player, step) {
  return isIll(player, step) && player.illness === ILLNESSES.COLIC;
}

/**
 * Clears the illnesses whose time is up.
 *
 * @param {import('./state.js').State} state
 */
export function expireIllnesses(state) {
  for (const player of state.players) {
    if (player.illness !== null && !isIll(player, state.step)) cure(player);
  }
}

/**
 * Distance at which two bombers are touching, in sub-units.
 *
 * Their collision boxes are 0.74 of a tile wide, but contagion on the whole box
 * fired as soon as two bombers brushed past each other in a corridor. Half a
 * tile means they really have to walk into one another.
 */
const TOUCHING = Math.round(0.5 * UNITS);

/**
 * Passes the illnesses on: whoever touches somebody healthy HANDS IT OVER and
 * is cured.
 *
 * It moves, it does not copy. That is Atomic Bomberman's rule, and it is what
 * turns the skull from a punishment into a gesture: an ill bomber stops fleeing
 * and comes hunting, and the healthy one runs from a player who is no longer
 * dangerous for their bombs.
 *
 * Decided on ORDERED PAIRS and applied afterwards, never as we go. Resolving a
 * contact the instant it is found would let an illness cross two bombers in one
 * step whenever the array happened to be in the right order — the classic bug
 * where the result depends on who sits where in the list. Each bomber gives at
 * most once and catches at most once per step.
 *
 * @param {import('./state.js').State} state
 */
export function spreadIllnesses(state) {
  /** @type {{ from: import('./state.js').Player, to: import('./state.js').Player }[]} */
  const handovers = [];
  const given = new Set();
  const caught = new Set();

  for (let i = 0; i < state.players.length; i += 1) {
    for (let j = i + 1; j < state.players.length; j += 1) {
      const a = state.players[i];
      const b = state.players[j];
      if (!a.alive || !b.alive) continue;
      if (Math.abs(a.x - b.x) >= TOUCHING || Math.abs(a.y - b.y) >= TOUCHING) continue;

      const aIll = isIll(a, state.step);
      const bIll = isIll(b, state.step);
      // Two ill bombers swap nothing, and two healthy ones have nothing to swap.
      if (aIll === bIll) continue;
      const from = aIll ? a : b;
      const to = aIll ? b : a;
      if (given.has(from.place) || caught.has(to.place)) continue;
      given.add(from.place);
      caught.add(to.place);
      handovers.push({ from, to });
    }
  }

  for (const { from, to } of handovers) {
    const kind = from.illness;
    cure(from);
    infect(state, to, kind);
  }
}
