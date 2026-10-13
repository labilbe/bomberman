/**
 * Sprites drawn in code, once, at start-up.
 *
 * No image file in this project, and that is a structural choice: the repository
 * stays free of dependencies and binary assets, the service worker has nothing
 * heavy to cache, and there is no question of rights over sprites taken from a
 * commercial game. Everything is painted into off-screen canvases, then copied
 * thousands of times a second — drawing on every frame would cost a hundred
 * times more.
 *
 * Everything is painted on a 16 x 16 PIXEL grid, then scaled up by an integer
 * factor with smoothing off. That is what gives crisp edges: a sprite drawn at
 * 32 pixels then shrunk would smear, and a non-integer scale would give pixels
 * of different widths within the same image.
 */

import {
  GROUND_LIGHT,
  GROUND_DARK,
  GROUND_PATTERN,
  WALL_FACE,
  WALL_TOP,
  WALL_BOTTOM,
  WALL_LINE,
  BRICK_FACE,
  BRICK_TOP,
  BRICK_JOINT,
  BOMB_BODY,
  BOMB_SHINE,
  FUSE,
  SPARK,
  FLAME,
  OUTLINE,
  SHADOW,
  BONUS_COLOURS,
  placeColour,
} from './palette.js';

/** Side of a sprite, in art pixels. */
export const SIDE = 16;

/** Number of frames in the walk cycle. */
export const WALK_FRAMES = 4;

function surface(width = SIDE, height = SIDE) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function block(ctx, x, y, width, height, colour) {
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, width, height);
}

function dot(ctx, x, y, colour) {
  block(ctx, x, y, 1, 1, colour);
}

/**
 * A disc traced pixel by pixel.
 *
 * `arc()` would have given a smooth edge, hence a blurred one after scaling up:
 * on a 16-pixel grid, an antialiased outline eats half the silhouette.
 */
function disc(ctx, cx, cy, radius, colour) {
  const limit = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= limit) dot(ctx, x, y, colour);
    }
  }
}

/** The ground: two shades in a checkerboard, so that movement shows. */
function paintGround(even) {
  const { canvas, ctx } = surface();
  block(ctx, 0, 0, SIDE, SIDE, even ? GROUND_LIGHT : GROUND_DARK);
  for (let y = 1; y < SIDE; y += 4) {
    for (let x = even ? 1 : 3; x < SIDE; x += 4) dot(ctx, x, y, GROUND_PATTERN);
  }
  return canvas;
}

/** Indestructible wall: a bevelled block, clearly lighter than the brick. */
function paintHardWall() {
  const { canvas, ctx } = surface();
  block(ctx, 0, 0, SIDE, SIDE, WALL_FACE);
  block(ctx, 0, 0, SIDE, 2, WALL_TOP);
  block(ctx, 0, 0, 2, SIDE, WALL_TOP);
  block(ctx, 0, SIDE - 3, SIDE, 3, WALL_BOTTOM);
  block(ctx, SIDE - 3, 0, 3, SIDE, WALL_BOTTOM);
  block(ctx, 0, 0, SIDE, 1, WALL_LINE);
  block(ctx, 0, 0, 1, SIDE, WALL_LINE);
  block(ctx, 0, SIDE - 1, SIDE, 1, WALL_LINE);
  block(ctx, SIDE - 1, 0, 1, SIDE, WALL_LINE);
  // A highlight at the top left: it gives volume and tells the wall from the
  // brick without depending on hue, hence even for a colour-blind eye.
  block(ctx, 2, 2, 4, 2, '#d7deec');
  return canvas;
}

/** Destructible brick: visible bond, dark joints. */
function paintBrick() {
  const { canvas, ctx } = surface();
  block(ctx, 0, 0, SIDE, SIDE, BRICK_JOINT);
  for (let row = 0; row < 4; row += 1) {
    const y = row * 4;
    const offset = row % 2 === 0 ? 0 : 4;
    for (let x = -4; x < SIDE; x += 8) {
      block(ctx, x + offset, y, 7, 3, BRICK_FACE);
      block(ctx, x + offset, y, 7, 1, BRICK_TOP);
    }
  }
  block(ctx, 0, 0, SIDE, 1, OUTLINE);
  block(ctx, 0, SIDE - 1, SIDE, 1, OUTLINE);
  block(ctx, 0, 0, 1, SIDE, OUTLINE);
  block(ctx, SIDE - 1, 0, 1, SIDE, OUTLINE);
  return canvas;
}

/**
 * Bomb: three pulsing frames.
 *
 * The pulse is not an affectation — it is the only signal that says a bomb is
 * alive, and the player uses it to judge the time left.
 */
function paintBomb(frame) {
  const { canvas, ctx } = surface();
  const radius = 5 + frame * 0.6;
  const cy = 9;
  block(ctx, 4, SIDE - 2, 8, 1, SHADOW);
  disc(ctx, 8, cy, radius + 0.9, OUTLINE);
  disc(ctx, 8, cy, radius, BOMB_BODY);
  dot(ctx, 6, cy - 2, BOMB_SHINE);
  dot(ctx, 5, cy - 1, BOMB_SHINE);
  // Fuse, then spark: it changes colour on every frame, which makes the pulse
  // legible even when the bomb is hidden behind a bomber.
  block(ctx, 9, 3, 1, 2, FUSE);
  block(ctx, 10, 2, 1, 2, FUSE);
  dot(ctx, 11, 1, SPARK[frame % SPARK.length]);
  dot(ctx, 12, 0, SPARK[(frame + 1) % SPARK.length]);
  return canvas;
}

/**
 * Flame: four frames, from white to red.
 *
 * Each layer is a full cross edge to edge, plus a disc in the middle. The cross
 * is not decorative: neighbouring flames have to meet from one cell to the next
 * to form a continuous arm. With discs alone, an explosion of range three looked
 * like a string of separate bubbles, and you could no longer see where the blast
 * stopped — which is precisely what has to be read to survive.
 */
function paintFlame(frame) {
  const { canvas, ctx } = surface();
  const thicknesses = [
    [6, 5, 3.5, 2],
    [7, 5.5, 4, 2.5],
    [5.5, 4, 3, 1.5],
    [3.5, 2.5, 1.5, 1],
  ][frame];

  for (let layer = 0; layer < 4; layer += 1) {
    const half = thicknesses[layer];
    if (half <= 0) continue;
    const colour = FLAME[3 - layer];
    const band = Math.max(1, Math.round(half * 2));
    const from = Math.round(8 - half);
    block(ctx, 0, from, SIDE, band, colour);
    block(ctx, from, 0, band, SIDE, colour);
    disc(ctx, 8, 8, half + 1, colour);
  }
  return canvas;
}

/** Bonus glyphs, drawn inside a pack. */
function paintBonus(name) {
  const { canvas, ctx } = surface();
  const colours = BONUS_COLOURS[name] ?? BONUS_COLOURS.bomb;
  block(ctx, 1, 1, 14, 14, OUTLINE);
  block(ctx, 2, 2, 12, 12, colours.background);
  block(ctx, 2, 2, 12, 2, colours.glow);
  block(ctx, 2, 12, 12, 2, colours.glyph);

  if (name === 'bomb') {
    disc(ctx, 8, 9, 3.2, colours.glyph);
    block(ctx, 9, 5, 1, 2, FUSE);
    dot(ctx, 10, 4, colours.glow);
  } else if (name === 'flame') {
    for (let y = 0; y < 6; y += 1) block(ctx, 6 - Math.floor(y / 2), 5 + y, 4 + y, 1, colours.glyph);
    block(ctx, 7, 8, 2, 3, colours.glow);
  } else if (name === 'speed') {
    // A lightning bolt: three offset segments, legible even at 16 pixels.
    block(ctx, 9, 4, 3, 1, colours.glyph);
    block(ctx, 7, 5, 4, 1, colours.glyph);
    block(ctx, 6, 6, 4, 1, colours.glyph);
    block(ctx, 5, 7, 6, 1, colours.glow);
    block(ctx, 7, 8, 4, 1, colours.glyph);
    block(ctx, 6, 9, 4, 1, colours.glyph);
    block(ctx, 5, 10, 3, 1, colours.glyph);
  } else if (name === 'jelly') {
    // A drop: wide at the bottom, pointed at the top, with its highlight. It is
    // the only round and pointed silhouette of the lot, so it stands out
    // without the colour having to be read.
    block(ctx, 7, 4, 2, 2, colours.glyph);
    block(ctx, 6, 6, 4, 2, colours.glyph);
    disc(ctx, 8, 10, 3.4, colours.glyph);
    dot(ctx, 7, 9, colours.glow);
  } else if (name === 'kick') {
    // The sole of a boot, from the side.
    block(ctx, 5, 5, 3, 5, colours.glyph);
    block(ctx, 5, 9, 7, 2, colours.glyph);
    block(ctx, 5, 5, 3, 1, colours.glow);
  } else {
    // Trigger: a box and its aerial.
    block(ctx, 6, 7, 5, 4, colours.glyph);
    block(ctx, 10, 4, 1, 3, colours.glyph);
    dot(ctx, 11, 3, colours.glow);
    block(ctx, 7, 8, 2, 1, colours.glow);
  }
  return canvas;
}

/**
 * A bomber: place, direction, walk frame.
 *
 * Drawn 16 x 16 with the feet at the bottom. The silhouette is the same in all
 * four directions — a helmeted oval — and only the visor and the swing of the
 * feet change. That is what lets you recognise your character from afar while
 * seeing where it is looking.
 */
function paintBomber(place, dir, frame) {
  const { canvas, ctx } = surface();
  const colour = placeColour(place);
  const foot = [0, 1, 0, -1][frame % WALK_FRAMES];

  block(ctx, 4, 15, 8, 1, SHADOW);

  // Legs, offset in opposition to give the stride.
  block(ctx, 5, 12 + Math.max(0, foot), 3, 3, OUTLINE);
  block(ctx, 8, 12 + Math.max(0, -foot), 3, 3, OUTLINE);
  block(ctx, 5, 13 + Math.max(0, foot), 3, 2, colour.dark);
  block(ctx, 8, 13 + Math.max(0, -foot), 3, 2, colour.dark);

  // Body.
  disc(ctx, 8, 8, 6.4, OUTLINE);
  disc(ctx, 8, 8, 5.6, colour.vivid);
  // Light at the top left, shadow at the bottom right: volume, in two strokes.
  disc(ctx, 6.6, 6.4, 3.2, colour.light);
  for (let y = 10; y < 13; y += 1) block(ctx, 9, y, 3, 1, colour.dark);

  // Helmet: a lighter cap, which separates the head from the body.
  for (let y = 2; y < 5; y += 1) block(ctx, 5 + (y === 2 ? 1 : 0), y, y === 2 ? 6 : 8, 1, colour.light);
  block(ctx, 4, 5, 8, 1, OUTLINE);

  // Visor, facing the right way.
  if (dir === 2) {
    block(ctx, 5, 6, 6, 3, '#eaf2ff');
    block(ctx, 6, 7, 1, 1, OUTLINE);
    block(ctx, 9, 7, 1, 1, OUTLINE);
  } else if (dir === 0) {
    block(ctx, 5, 6, 6, 2, colour.dark);
    block(ctx, 6, 6, 4, 1, OUTLINE);
  } else if (dir === 1) {
    block(ctx, 7, 6, 5, 3, '#eaf2ff');
    block(ctx, 10, 7, 1, 1, OUTLINE);
    block(ctx, 5, 6, 2, 3, colour.dark);
  } else {
    block(ctx, 4, 6, 5, 3, '#eaf2ff');
    block(ctx, 5, 7, 1, 1, OUTLINE);
    block(ctx, 9, 6, 2, 3, colour.dark);
  }

  return canvas;
}

/** A dead bomber: the silhouette sags and loses its colours. */
function paintDead(place, frame) {
  const { canvas, ctx } = surface();
  const colour = placeColour(place);
  const flat = frame;
  block(ctx, 3, 15, 10, 1, SHADOW);
  disc(ctx, 8, 12 + flat, 5.2 - flat, OUTLINE);
  disc(ctx, 8, 12 + flat, 4.4 - flat, colour.dark);
  if (flat < 2) {
    block(ctx, 6, 10, 1, 1, '#eaf2ff');
    block(ctx, 9, 10, 1, 1, '#eaf2ff');
  }
  return canvas;
}

/**
 * Builds every sprite. To call once, after the document has loaded.
 */
export function buildSprites(places = 4) {
  const bombers = [];
  const dead = [];
  for (let place = 0; place < places; place += 1) {
    bombers.push(
      [0, 1, 2, 3].map((dir) =>
        Array.from({ length: WALK_FRAMES }, (_, frame) => paintBomber(place, dir, frame)),
      ),
    );
    dead.push(Array.from({ length: 3 }, (_, frame) => paintDead(place, frame)));
  }

  return {
    ground: [paintGround(true), paintGround(false)],
    hardWall: paintHardWall(),
    brick: paintBrick(),
    bomb: Array.from({ length: 3 }, (_, frame) => paintBomb(frame)),
    flame: Array.from({ length: 4 }, (_, frame) => paintFlame(frame)),
    bonus: {
      bomb: paintBonus('bomb'),
      flame: paintBonus('flame'),
      speed: paintBonus('speed'),
      kick: paintBonus('kick'),
      trigger: paintBonus('trigger'),
      // The glove has its own painter: `paintBonus` falls back on the trigger
      // for any name it does not know, and we would have had two identical packs
      // for two bonuses that do nothing like the same thing.
      punch: paintGlove(),
      grab: paintGrabGlove(),
      jelly: paintBonus('jelly'),
    },
    bombers,
    dead,
  };
}

/**
 * The boxing glove's pack, at whatever size is asked for.
 *
 * It exists because `power punch` is not in every extraction: those made before
 * the bonus was added do not have that sprite, and something has to be shown.
 * All of its measurements are therefore FRACTIONS of the side, and not pixels:
 * it draws just as well on the 16 pixels of the code-drawn sprites as on the 40
 * of an Atomic Bomberman tile, with no scaling and hence no blur.
 *
 * The drawing is a glove seen from the side, fist to the right: a cuff, a
 * rounded fist, and a highlight. At that size you do not recognise a glove, you
 * recognise a compact red shape — which is all it takes to tell it from the five
 * other packs.
 */
export function paintGlove(width = SIDE, height = width, colours = BONUS_COLOURS.punch) {
  const { canvas, ctx } = surface(width, height);
  const u = (f) => Math.round(f * width);
  const v = (f) => Math.round(f * height);

  block(ctx, u(0.06), v(0.06), width - u(0.12), height - v(0.12), OUTLINE);
  block(ctx, u(0.12), v(0.12), width - u(0.24), height - v(0.24), colours.background);
  block(ctx, u(0.12), v(0.12), width - u(0.24), v(0.14), colours.glow);
  block(ctx, u(0.12), height - v(0.26), width - u(0.24), v(0.14), colours.glyph);

  // The silhouette is a lollipop: a round fist at the end of a short cuff. Kept
  // very small, it is the only shape that still reads as a glove — the thumb,
  // the laces and the crescent of light tried before got lost in the mass or
  // punched holes in it.
  const r = Math.max(2, u(0.18));
  const px = width - u(0.24) - r;
  const py = v(0.44);
  const cuff = Math.max(2, u(0.16));
  block(ctx, px - r - cuff + 1, py - v(0.13), cuff, v(0.26), colours.glyph);
  disc(ctx, px, py, r, colours.glyph);
  // The highlight starts on the side the glove strikes from: to the right, like
  // the punch.
  disc(ctx, px + Math.round(r * 0.45), py - Math.round(r * 0.45), r * 0.3, colours.glow);

  return canvas;
}

/**
 * The blue glove's pack: the same glove, the other colour.
 *
 * The same drawing on purpose. These are two gloves, and the game itself only
 * tells them apart by their colour — red throws what is in front of you, blue
 * picks up what is under your feet. Inventing a different shape here would make
 * our packs say something the game's own never did.
 */
export function paintGrabGlove(width = SIDE, height = width) {
  return paintGlove(width, height, BONUS_COLOURS.grab);
}

/**
 * The jelly's pack, at whatever size is asked for.
 *
 * Same reason to exist as `paintGlove`: `power jelly` is missing from
 * extractions made before that bonus, and something has to be shown. All of its
 * measurements are therefore fractions of the side, so that it draws just as
 * well on 16 pixels as on the 40 of an Atomic Bomberman tile.
 *
 * A drop: pointed at the top, wide and round at the bottom. It is the only
 * silhouette of its kind among the packs, so it is recognised without its colour
 * having to be read.
 */
export function paintJelly(width = SIDE, height = width) {
  const { canvas, ctx } = surface(width, height);
  const colours = BONUS_COLOURS.jelly;
  const u = (f) => Math.round(f * width);
  const v = (f) => Math.round(f * height);

  block(ctx, u(0.06), v(0.06), width - u(0.12), height - v(0.12), OUTLINE);
  block(ctx, u(0.12), v(0.12), width - u(0.24), height - v(0.24), colours.background);
  block(ctx, u(0.12), v(0.12), width - u(0.24), v(0.14), colours.glow);
  block(ctx, u(0.12), height - v(0.26), width - u(0.24), v(0.14), colours.glyph);

  const cx = width / 2;
  const r = Math.max(2, u(0.2));
  const cy = height - v(0.38);
  // The point, in two steps widening towards the belly.
  block(ctx, Math.round(cx - u(0.05)), v(0.26), u(0.1), v(0.12), colours.glyph);
  block(ctx, Math.round(cx - u(0.1)), v(0.36), u(0.2), v(0.12), colours.glyph);
  disc(ctx, cx, cy, r, colours.glyph);
  disc(ctx, cx - Math.round(r * 0.4), cy - Math.round(r * 0.35), r * 0.28, colours.glow);

  return canvas;
}
