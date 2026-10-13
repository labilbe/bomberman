/**
 * Bonuses: codes, draw table, and effect on a bomber.
 *
 * Bonuses are BYTES in a Uint8Array parallel to the grid, not objects in a
 * list. Two reasons: the whole arena then fits in 195 extra bytes, which go out
 * in one block at the start of the round; and a bonus always sits on a cell,
 * never between two, so a list would add nothing but an indirection.
 *
 * The same array carries the VISIBLE bonuses (codes 1 to 7) and those HIDDEN
 * under a brick (HIDDEN + code). A single array, because a revealed bonus then
 * only changes value, with no need to move it from one structure to another —
 * and moving is exactly where a case gets forgotten.
 */

import {
  MAX_BOMBS,
  MAX_RANGE,
  MAX_SPEED,
  SPEED_STEP,
  TRIGGERS_PER_BONUS,
} from './constants.js';

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
};

/**
 * Weighted table.
 *
 * Bomb and flame dominate: they are what makes a round progress, and seeing
 * them often rewards breaking bricks. Kick and triggers are rare because they
 * change the way you play, not just how strong you are.
 *
 * The jelly ranks with the glove: it is useless without the kick, and seeing it
 * too often would fill the arena with mad bombs owned by players who have
 * nothing to throw them with.
 */
export const BONUS_TABLE = [
  [BONUS_CODES.BOMB, 30],
  [BONUS_CODES.FLAME, 30],
  [BONUS_CODES.SPEED, 15],
  [BONUS_CODES.KICK, 12],
  [BONUS_CODES.TRIGGER, 8],
  [BONUS_CODES.GLOVE, 8],
  [BONUS_CODES.JELLY, 8],
];

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
 * playing any more.
 *
 * @param {{ bombs: number, range: number, speed: number, kick: boolean, triggers: number, jelly: boolean }} player
 * @param {number} code
 */
export function apply(player, code) {
  switch (code) {
    case BONUS_CODES.BOMB:
      player.bombs = Math.min(MAX_BOMBS, player.bombs + 1);
      break;
    case BONUS_CODES.FLAME:
      player.range = Math.min(MAX_RANGE, player.range + 1);
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
    default:
      break;
  }
}
