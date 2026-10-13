/**
 * The game's palette.
 *
 * It is saturated and contrasted, in the manner of Atomic Bomberman, because
 * legibility is a rule of the game here: a brick must be told from a hard wall
 * at a glance — one opens, the other never — and you must recognise your bomber
 * among four in a scrum. The player colours are therefore chosen to stay
 * distinct both in hue and in lightness, which also separates them for a
 * colour-blind eye.
 *
 * Colours are attached to the PLACE NUMBER, never to the player: you find your
 * bearings by colour for the whole match, and it must not change because an
 * opponent has left.
 */

export const BACKGROUND = '#120f1c';
export const GROUND_LIGHT = '#2f7d4f';
export const GROUND_DARK = '#276942';
export const GROUND_PATTERN = '#286a44';

export const WALL_FACE = '#8b94a8';
export const WALL_TOP = '#b9c2d4';
export const WALL_BOTTOM = '#5b6377';
export const WALL_LINE = '#3b4150';

export const BRICK_FACE = '#b5563c';
export const BRICK_TOP = '#d4714f';
export const BRICK_JOINT = '#7a3526';

export const BOMB_BODY = '#1b1b2a';
export const BOMB_SHINE = '#9aa4bd';
export const FUSE = '#c9a227';
export const SPARK = ['#fff4c2', '#ffd45e', '#ff9f1c'];

export const FLAME = ['#fffbe8', '#ffe066', '#ff9f1c', '#f4511e'];

export const OUTLINE = '#14121f';
export const SHADOW = 'rgba(0, 0, 0, 0.28)';

/**
 * The ten bomber colours, IN THE GAME'S OWN ORDER.
 *
 * They are not chosen here: they are COMPUTED from the game's tables —
 * `COLOR.PAL` and the ten `.RMP` files — read by `src/extraction/colours.js`,
 * which derives each player's hue, saturation and lightness correction. The
 * three tones below are those values applied at three lightnesses, by the same
 * formula as the sprite recolouring: the dashboard's dot therefore carries
 * exactly the bomber's colour on screen, and not an approximation made by eye.
 *
 * They are HARD-CODED rather than read back on load, because a checkout without
 * the game's assets must show the same colours: the engine, the menu and the
 * dashboard use them before even knowing whether the sprites exist. To
 * recompute them after an extraction, see `playerColours` in the manifest —
 * these are those numbers, at three lightnesses.
 */
export const PLACES = [
  { name: 'Blanc', light: '#c6c6ba', vivid: '#acac9c', dark: '#92927d' },
  { name: 'Noir', light: '#a8a896', vivid: '#7f7f6a', dark: '#505043' },
  { name: 'Rouge', light: '#f08374', vivid: '#ea4b36', dark: '#c72a15' },
  { name: 'Bleu', light: '#5f5ffc', vivid: '#1818fa', dark: '#0404c6' },
  { name: 'Vert', light: '#5cff5c', vivid: '#13ff13', dark: '#00ca00' },
  { name: 'Jaune', light: '#f5f56c', vivid: '#f0f02b', dark: '#c7c70e' },
  { name: 'Cyan', light: '#76e8f1', vivid: '#39deea', dark: '#15beca' },
  { name: 'Magenta', light: '#ff5eff', vivid: '#ff16ff', dark: '#cd00cd' },
  { name: 'Orange', light: '#f99f5e', vivid: '#f77416', dark: '#bb5207' },
  { name: 'Violet', light: '#b766f9', vivid: '#9721f7', dark: '#7207ca' },
];

/** The colour of a place, wrapped so it never returns undefined. */
export function placeColour(place) {
  return PLACES[((place % PLACES.length) + PLACES.length) % PLACES.length];
}

/**
 * Bonus colours.
 *
 * The pack is VIVID and the glyph dark, and not the other way round. A bonus
 * lying on the ground has to leap to the eye in the middle of a green and brown
 * checkerboard, sometimes under a flame: with a dark pack it blended into the
 * scenery and you walked over it without seeing it.
 */
export const BONUS_COLOURS = {
  bomb: { background: '#8d99ae', glyph: '#14121f', glow: '#e2e8f0' },
  flame: { background: '#ff9f1c', glyph: '#7a2e00', glow: '#ffe066' },
  speed: { background: '#48cae4', glyph: '#073b4c', glow: '#caf0f8' },
  kick: { background: '#c77dff', glyph: '#3c096c', glow: '#e9d5ff' },
  trigger: { background: '#70e000', glyph: '#14331f', glow: '#ccff33' },
  // The glove: leather red, the colour you expect of a boxing glove.
  punch: { background: '#e5383b', glyph: '#4a0d10', glow: '#ff9a94' },
  // The other glove, the one that picks a bomb up, is BLUE — and in the game
  // that is the only thing telling the two apart at a glance. Ours says it the
  // same way, because a player reads the colour before the shape.
  grab: { background: '#2d6cdf', glyph: '#0a1f52', glow: '#9ec5ff' },
  // The jelly: the purple of Interplay's own 'jelly', which looks like no other
  // bonus — that is all you ask of sixteen pixels.
  jelly: { background: '#9d4edd', glyph: '#2d0a45', glow: '#e0aaff' },
};
