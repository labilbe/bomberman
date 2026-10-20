/**
 * Bonuses: codes, draw table, and effect on a bomber.
 *
 * Bonuses are BYTES in a Uint8Array parallel to the grid, not objects in a
 * list. Two reasons: the whole arena then fits in 195 extra bytes, which go out
 * in one block at the start of the round; and a bonus always sits on a cell,
 * never between two, so a list would add nothing but an indirection.
 *
 * The same array carries the VISIBLE bonuses (codes 1 to 12) and those HIDDEN
 * under a brick (HIDDEN + code). A single array, because a revealed bonus then
 * only changes value, with no need to move it from one structure to another —
 * and moving is exactly where a case gets forgotten.
 */

import {
  GOLDFLAME_RANGE,
  MAX_BOMBS,
  MAX_RANGE,
  MAX_SPEED,
  SPEED_STEP,
  TRIGGERS_PER_BONUS,
} from './constants.js';
import { draw } from './rng.js';
import { infect } from './disease.js';

/** Offset of the bonuses still hidden under a brick. */
export const HIDDEN = 128;

/** Bonus codes, as they live in the item array. */
export const BONUS_CODES = {
  BOMB: 1,
  FLAME: 2,
  SPEED: 3,
  KICK: 4,
  TRIGGER: 5,
  GLOVE: 6,
  JELLY: 7,
  GRAB: 8,
  SPOOGER: 9,
  GOLDFLAME: 10,
  RANDOM: 11,
  DISEASE: 12,
};

/** Network names of the bonuses: what the wire carries, and what the sprites are keyed on. */
export const BONUS_NAMES = {
  [BONUS_CODES.BOMB]: 'bomb',
  [BONUS_CODES.FLAME]: 'flame',
  [BONUS_CODES.SPEED]: 'speed',
  [BONUS_CODES.KICK]: 'kick',
  [BONUS_CODES.TRIGGER]: 'trigger',
  [BONUS_CODES.GLOVE]: 'punch',
  [BONUS_CODES.JELLY]: 'jelly',
  [BONUS_CODES.GRAB]: 'grab',
  [BONUS_CODES.SPOOGER]: 'spooger',
  [BONUS_CODES.GOLDFLAME]: 'goldflame',
  [BONUS_CODES.RANDOM]: 'random',
  [BONUS_CODES.DISEASE]: 'disease',
};

/**
 * Weighted table.
 *
 * Bomb and flame dominate: they are what makes a round progress, and seeing
 * them often rewards breaking bricks. Kick and triggers are rare because they
 * change the way you play, not just how strong you are.
 *
 * The jelly ranks with the gloves: it is useless without the kick, and seeing it
 * too often would fill the arena with mad bombs owned by players who have
 * nothing to throw them with.
 *
 * The spooger is the rarest of the lot. It is worth nothing on its own — one
 * bomb lines up no wall — and everything once the magazine is full: found early
 * it is forgotten, found late it condemns a whole corridor in one press. Giving
 * it the weight of the gloves would have made the burst the ordinary way of
 * dropping bombs, which is exactly what the gesture must not become.
 *
 * THE SKULL IS THE COMMONEST OF THE THREE LAST. It has to be met, and feared,
 * for the arena to stop being a place where every pack is good news — picking
 * one up without looking is the mistake the skull exists to punish. The gold
 * flame is the rarest of all: it hands over the whole arena's reach at once, and
 * finding it twice in a round would settle that round on its own.
 */
export const BONUS_TABLE = [
  [BONUS_CODES.BOMB, 30],
  [BONUS_CODES.FLAME, 30],
  [BONUS_CODES.SPEED, 15],
  [BONUS_CODES.KICK, 12],
  [BONUS_CODES.TRIGGER, 8],
  [BONUS_CODES.GLOVE, 8],
  [BONUS_CODES.JELLY, 8],
  [BONUS_CODES.GRAB, 8],
  [BONUS_CODES.SPOOGER, 5],
  [BONUS_CODES.DISEASE, 10],
  [BONUS_CODES.RANDOM, 6],
  [BONUS_CODES.GOLDFLAME, 4],
];

/**
 * Reads the weighted table at a point of [0, 1), and returns the code landed on.
 *
 * Split out of the arena because the RANDOM pack draws from the same table, at
 * pickup time, from another generator. Two copies of this loop would have
 * drifted the day a weight changed, and the pack would have been handing out a
 * distribution nobody had written down.
 *
 * @param {number} value a float in [0, 1)
 * @param {number | null} exclude a code to leave out of the draw
 * @returns {number}
 */
export function fromTable(value, exclude = null) {
  const table = exclude === null
    ? BONUS_TABLE
    : BONUS_TABLE.filter(([code]) => code !== exclude);
  const total = table.reduce((sum, [, weight]) => sum + weight, 0);
  let left = value * total;
  for (const [code, weight] of table) {
    left -= weight;
    if (left < 0) return code;
  }
  return table[table.length - 1][0];
}

/** True when the byte names a bonus still hidden under a brick. */
export function isHidden(value) {
  return value > HIDDEN;
}

/** True when the byte names a bonus lying on the ground, there to be picked up. */
export function isVisible(value) {
  return value > 0 && value < HIDDEN;
}

/** Code of the bonus, hidden or visible. */
export function codeOf(value) {
  return isHidden(value) ? value - HIDDEN : value;
}

/**
 * Applies a bonus to a bomber. Mutates the bomber, which belongs to the state.
 *
 * The ceilings are not caution: without them a long round ends with eight bombs
 * of range fifteen each, the whole arena burns permanently and nobody is
 * playing any more. The gold flame is the one exception, and a deliberate one:
 * it is the rarest pack of the table, and its whole point is that reach.
 *
 * @param {{ bombs: number, range: number, speed: number, kick: boolean, triggers: number, jelly: boolean, grab: boolean, spooger: boolean, goldflame: boolean }} player
 * @param {number} code
 */
export function apply(player, code) {
  switch (code) {
    case BONUS_CODES.BOMB:
      player.bombs = Math.min(MAX_BOMBS, player.bombs + 1);
      break;
    case BONUS_CODES.FLAME:
      // UNDER THE GOLD FLAME THE RANGE NO LONGER MOVES — it is already the whole
      // arena — but the pack is not lost for all that: it is counted on the
      // range held BEFORE the gold one, which is what a corpse gives back.
      // Without this, `Math.min` pulled the gold reach back down to the ordinary
      // ceiling, and one flame picked up undid the gold flame.
      if (player.goldflame) {
        player.goldflameFrom = Math.min(MAX_RANGE, player.goldflameFrom + 1);
      } else {
        player.range = Math.min(MAX_RANGE, player.range + 1);
      }
      break;
    case BONUS_CODES.SPEED:
      player.speed = Math.min(MAX_SPEED, player.speed + SPEED_STEP);
      break;
    case BONUS_CODES.KICK:
      player.kick = true;
      break;
    case BONUS_CODES.TRIGGER:
      player.triggers += TRIGGERS_PER_BONUS;
      break;
    case BONUS_CODES.GLOVE:
      player.glove = true;
      break;
    case BONUS_CODES.JELLY:
      player.jelly = true;
      break;
    case BONUS_CODES.GRAB:
      player.grab = true;
      break;
    case BONUS_CODES.SPOOGER:
      player.spooger = true;
      break;
    case BONUS_CODES.GOLDFLAME:
      // The range BEFORE is kept, and it is the only pickup the engine
      // remembers. Everywhere else the loot of a corpse is read off the gap from
      // the starting kit — but that gap cannot tell one gold flame from six
      // ordinary flames, and a corpse would have given back six packs for one.
      if (!player.goldflame) {
        player.goldflame = true;
        player.goldflameFrom = player.range;
      }
      player.range = GOLDFLAME_RANGE;
      break;
    default:
      break;
  }
}

/**
 * Turns a PICKED UP bonus into its effect, drawing lots where the pack asks for
 * it.
 *
 * It exists because two packs cannot be resolved on the bomber alone: the random
 * one has to draw, and the skull has to draw and to date its illness. Both need
 * the state's seeded generator, which `apply` has no business knowing about —
 * and both must go through the SAME generator as the arena, or the relay and a
 * replay would hand out two different things.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 * @param {number} code
 * @returns {number} the code actually granted, which is not the one picked up
 *   when the pack was a random one
 */
export function grant(state, player, code) {
  // The random pack never draws itself: without that, a run of them could turn
  // one pickup into any number of draws, and the generator would no longer be
  // at the same point on two machines that had seen the same round.
  const granted = code === BONUS_CODES.RANDOM
    ? fromTable(draw(state), BONUS_CODES.RANDOM)
    : code;

  if (granted === BONUS_CODES.DISEASE) infect(state, player);
  else apply(player, granted);
  return granted;
}
