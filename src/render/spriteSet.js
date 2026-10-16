/**
 * The contract the renderer expects of a sprite set, and its two providers.
 *
 * The scene must not know where its images come from. It asks for them by role —
 * the ground, an arm of flame pointing right, the bomber of place 2 walking
 * downwards — and two providers answer: the one that paints everything in code,
 * and the one that rasterises the SVGs extracted from Atomic Bomberman.
 *
 * Every sprite is a CANVAS plus an ANCHOR POINT. It is the anchor that matters:
 * the original game's sprites are not the size of a cell — a bomber is 110
 * pixels tall for a 36-pixel cell — and they stand on their feet, not on their
 * corner. Without an anchor, every sprite would need its own alignment by hand
 * in the scene.
 */

import {
  buildSprites,
  paintGlove,
  paintGoldflame,
  paintGrabGlove,
  paintJelly,
  paintRandom,
  paintSkull,
  paintSpooger,
  SIDE,
  WALK_FRAMES,
} from './sprites.js';
import { PLACES } from './palette.js';

/** Number of frames in the walk cycle, for both providers. */
export { WALK_FRAMES };

/** The engine's four directions: UP, RIGHT, DOWN, LEFT. */
const DIRS = [0, 1, 2, 3];

/**
 * An array of one entry per place, BUILT ON DEMAND.
 *
 * The game offers ten colours and a game never shows more than four. Assembling
 * them all on load would recolour six series nobody looks at — some sixty
 * milliseconds each. So each slot builds its own on first access, then replaces
 * itself with the result.
 *
 * The counterpart of `lazySeries` in vectors.js: that one recolours the images,
 * this one assembles them into roles. Both are needed, otherwise the assembly
 * would wake the recolouring of every colour.
 *
 * @param {number} places
 * @param {(place: number) => unknown} build
 */
function lazyPerPlace(places, build) {
  const array = [];
  for (let place = 0; place < places; place += 1) {
    Object.defineProperty(array, place, {
      configurable: true,
      enumerable: true,
      get() {
        const built = build(place);
        Object.defineProperty(array, place, {
          configurable: true,
          enumerable: true,
          value: built,
          writable: true,
        });
        return built;
      },
    });
  }
  return array;
}

/** A canvas drawn at tile size, anchored by its bottom centre. */
function tileSprite(canvas, tile) {
  return {
    canvas,
    width: tile.width,
    height: tile.height,
    anchorX: tile.width / 2,
    anchorY: tile.height,
  };
}

/** Half-thickness of the band, as a fraction of the sprite's height. */
const BAND = 0.13;

/** What is written on the band, and in which colour. */
const TRIGGER_WORD = 'BOOM';
const TRIGGER_TEXT = '#ff2d2d';

/**
 * Fallback tilt, should the cap prove impossible to find.
 *
 * The band normally follows the axis of the YELLOW CAP on top of the bomb,
 * because that is what sets the drawing's attitude: a horizontal band on a
 * leaning bomb reads as a mounting mistake. So we measure the cap rather than
 * hard-coding an angle, which has the advantage of staying right if the sprites
 * change.
 */
const TILT = (-14 * Math.PI) / 180;

/** Is a pixel the brass of the cap? Clear yellow: blue clearly behind. */
function isCap(r, g, b) {
  const min = Math.min(r, g);
  return min > 90 && b < min * 0.62;
}

/**
 * Axis of the yellow cap, in radians, or `null` when it cannot be found.
 *
 * We take the principal axis of the cloud of yellow pixels — the direction in
 * which they spread furthest. It is a covariance computation, not shape
 * recognition: the cap is a small leaning cylinder, and its spread follows its
 * slope.
 */
function capAxis(data, width, height) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      if (!isCap(data[i], data[i + 1], data[i + 2])) continue;
      n += 1;
      sx += x;
      sy += y;
    }
  }
  if (n < 8) return null;

  const mx = sx / n;
  const my = sy / n;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      if (!isCap(data[i], data[i + 1], data[i + 2])) continue;
      const dx = x - mx;
      const dy = y - my;
      xx += dx * dx;
      yy += dy * dy;
      xy += dx * dy;
    }
  }
  if (xx === 0 && yy === 0) return null;
  return 0.5 * Math.atan2(2 * xy, xx - yy);
}

/**
 * The same bomb, girt with a black band: the one waiting for a trigger.
 *
 * We do NOT take the game's TRIGBOMB sprite, although it exists and the
 * extraction brings it back. It is not a bomb: it is a flattened dome with a red
 * button and a turning aerial — the receiver, not the device. Atomic Bomberman's
 * trigger bomb is the ordinary bomb, crossed by a band.
 *
 * The band is laid at the EQUATOR, in the middle of the widest rows of pixels. A
 * fixed fraction of the height would not do: the fuse takes up the top of the
 * sprite, its length varies from one frame to the next, and the band would slide
 * along the bomb during the animation. The largest diameter, on the other hand,
 * is always the middle of the sphere.
 *
 * It also follows the silhouette, since we only repaint pixels that are already
 * opaque — otherwise it would stick out as a rectangle on either side.
 */
function withBand(source, tilt = TILT) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  const opaque = (x, y) => d[(y * canvas.width + x) * 4 + 3] > 32;

  // Width of each row, then the MIDDLE of the widest plateau.
  //
  // The middle, and not the first row to reach the maximum: a sphere drawn in
  // pixels has the top of its flank flat, and the bomb counts seven rows of the
  // same width. Keeping the first, the band sat three pixels too high — enough
  // for it to cut the bomb above its largest diameter, which shows at once.
  const widths = [];
  for (let y = 0; y < canvas.height; y += 1) {
    let count = 0;
    for (let x = 0; x < canvas.width; x += 1) if (opaque(x, y)) count += 1;
    widths.push(count);
  }
  const widest = Math.max(...widths);
  if (widest === 0) return canvas;
  const equator = Math.round(
    (widths.indexOf(widest) + widths.lastIndexOf(widest)) / 2,
  );

  let left = canvas.width;
  let right = 0;
  for (let x = 0; x < canvas.width; x += 1) {
    if (!opaque(x, equator)) continue;
    if (x < left) left = x;
    if (x > right) right = x;
  }
  const span = right - left;
  if (span <= 6) return canvas;

  const half = Math.max(2, Math.round(canvas.height * BAND));

  // `source-atop` only paints where something is already there: the band
  // therefore clips itself to the bomb's silhouette, even on the slant. That is
  // what lets it be laid ACROSS without sticking out as a rectangle, which a
  // row-by-row pass could not do.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.translate((left + right) / 2, equator + 0.5);
  ctx.rotate(tilt);

  const long = canvas.width + canvas.height;
  ctx.fillStyle = '#14141a';
  ctx.fillRect(-long, -half, long * 2, half * 2);
  // A lighter edging top and bottom: without it the band blends into the bottom
  // of the bomb, which is already dark.
  ctx.fillStyle = '#56565f';
  ctx.fillRect(-long, -half, long * 2, 1);
  ctx.fillRect(-long, half - 1, long * 2, 1);

  // The word. At this size it does not really READ, and that was already true in
  // the original game: what you recognise is that there is red writing across
  // the bomb.
  ctx.font = `bold ${Math.max(5, half * 2)}px 'Arial Narrow', Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = TRIGGER_TEXT;
  const measure = ctx.measureText(TRIGGER_WORD).width;
  // The word fills the band from edge to edge, even stretched: on the game's
  // bomb it crosses the whole sphere, it does not float in the middle.
  ctx.scale((span - 2) / measure, 1);
  ctx.fillText(TRIGGER_WORD, 0, 0);
  ctx.restore();

  return canvas;
}

/** The same run of sprites, each girt with its band. */
const runWithBand = (run) => {
  const tilt = runAngle(run);
  return run.map((sprite) => ({ ...sprite, canvas: withBand(sprite.canvas, tilt) }));
};

/**
 * Reads the cap's angle on the first frame that shows one.
 *
 * The angle is measured ONCE and serves for the whole run. Measuring it frame by
 * frame would make the band shake during the pulse: the cap counts only a few
 * dozen pixels, and a single one tipping from one frame to the next moves its
 * axis by a degree.
 */
function runAngle(run) {
  for (const { canvas: source } of run) {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const angle = capAxis(data, canvas.width, canvas.height);
    if (angle !== null) return angle;
  }
  return TILT;
}

/**
 * Duration of one bomb beat, in milliseconds, failing anything better.
 *
 * Atomic Bomberman gives its own — eighteen frames of 30 ms, that is 540 — and
 * that is the one we take when the game's sprites are there. The sprites drawn
 * in code have no duration of their own, hence this value: three frames at this
 * pace make a beat that reads, without flickering.
 */
const DEFAULT_BOMB_CYCLE = 660;

/**
 * Duration of one walk cycle, in milliseconds, failing anything better.
 *
 * Atomic Bomberman gives its own: fifteen frames of 30 ms, that is 450. The
 * sprites drawn in code have none, hence this value — their four frames over
 * that duration give a stride of comparable pace.
 */
const DEFAULT_WALK_CYCLE = 450;

/**
 * Sprite set painted in code.
 *
 * The drawn sprites are all 16 x 16 and stand on their bottom centre, so the
 * anchor is the same everywhere. This provider serves mostly as a fallback, and
 * as a reference: if the scene renders right with it, it will render right with
 * the other.
 */
export function fromDrawings(places = PLACES.length) {
  const raw = buildSprites(places);
  const sprite = (canvas) => ({ canvas, width: SIDE, height: SIDE, anchorX: SIDE / 2, anchorY: SIDE });
  const perPlace = (build) => Array.from({ length: places }, (_, p) => build(p));

  return {
    tile: { width: SIDE, height: SIDE },
    // No painted background here: the checkerboard of two ground shades does the
    // job.
    background: null,
    bombCycle: DEFAULT_BOMB_CYCLE,
    walkCycle: DEFAULT_WALK_CYCLE,
    ground: raw.ground.map(sprite),
    wall: sprite(raw.hardWall),
    brick: sprite(raw.brick),
    brickBroken: null,
    bonus: Object.fromEntries(Object.entries(raw.bonus).map(([name, t]) => [name, sprite(t)])),
    // The drawn bombs do not carry the player's colour: the same sequence serves
    // every place.
    bomb: perPlace(() => raw.bomb.map(sprite)),
    // Same rule as for the extracted sprites: the ordinary bomb, crossed.
    bombTrigger: perPlace(() => runWithBand(raw.bomb.map(sprite))),
    // The menu's: the same, with no player colour — here they all are, since the
    // code drawing does not tint its bombs.
    menuBomb: runWithBand(raw.bomb.map(sprite)),
    // A single set of flames, reused for the centre, the middles and the ends:
    // the code drawing makes a full cross, which joins up from one cell to the
    // next without needing separate pieces.
    flame: perPlace(() => ({
      centre: raw.flame.map(sprite),
      mid: DIRS.map(() => raw.flame.map(sprite)),
      end: DIRS.map(() => raw.flame.map(sprite)),
    })),
    bombers: perPlace((p) => DIRS.map((d) => raw.bombers[p][d].map(sprite))),
    idle: perPlace((p) => DIRS.map((d) => sprite(raw.bombers[p][d][0]))),
    // The sprites drawn in code have no punch sequence: the scene plays its own
    // over the bomber.
    punches: null,
    // Nor a carrying pose: the scene lays the bomb on the head by hand.
    carry: null,
    dead: perPlace((p) => raw.dead[p].map(sprite)),
  };
}

/**
 * Vector sprite set, from what `loadVectors` returns.
 *
 * The ground arrives in two forms. `background` is the painted band of the
 * field, as wide as the whole arena, which the scene prefers when it is there:
 * it is Atomic Bomberman's real ground, with its alternating light and dark
 * rows. `ground` stays the "blank" tile of the .ANI files, kept as a fallback —
 * it does the job if the field's file is missing, but it is another grass,
 * spotted, whose repetition from cell to cell shows at once.
 */
export function fromVectors(loaded, places = PLACES.length) {
  const { tile, ground: background, roles, cycles } = loaded;
  const one = (name) => roles[name]?.[0] ?? null;

  return {
    tile,
    background,
    // The pulse rate comes from the original game, not from a setting of ours.
    bombCycle: cycles?.bomb ?? DEFAULT_BOMB_CYCLE,
    walkCycle: cycles?.walk0 ?? DEFAULT_WALK_CYCLE,
    ground: [one('ground'), one('ground')],
    wall: one('wall'),
    brick: one('brick'),
    brickBroken: roles.brickBroken ?? null,
    bonus: {
      bomb: one('bonusBomb'),
      flame: one('bonusFlame'),
      speed: one('bonusSpeed'),
      kick: one('bonusKick'),
      trigger: one('bonusTrigger'),
      // The glove is missing from extractions made before it was added. We then
      // draw it AT TILE SIZE, rather than scaling the 16-pixel pack up: from 16
      // to 40 the scale is not an integer, and every pixel would be a different
      // width from its neighbour.
      punch: roles.bonusGlove
        ? one('bonusGlove')
        : tileSprite(paintGlove(tile.width, tile.height), tile),
      // The jelly, same story: absent from extractions made before it.
      jelly: roles.bonusJelly
        ? one('bonusJelly')
        : tileSprite(paintJelly(tile.width, tile.height), tile),
      // The blue glove, same story again.
      grab: roles.bonusGrab
        ? one('bonusGrab')
        : tileSprite(paintGrabGlove(tile.width, tile.height), tile),
      // And the spooger, the last one added: same story again.
      spooger: roles.bonusSpooger
        ? one('bonusSpooger')
        : tileSprite(paintSpooger(tile.width, tile.height), tile),
      // The gold flame, the random pack and the skull: same story again, and
      // their sequence names in POWERS.ANI are the likeliest guess rather than
      // something read off a file — all the more reason to keep the fallback.
      goldflame: roles.bonusGoldflame
        ? one('bonusGoldflame')
        : tileSprite(paintGoldflame(tile.width, tile.height), tile),
      random: roles.bonusRandom
        ? one('bonusRandom')
        : tileSprite(paintRandom(tile.width, tile.height), tile),
      disease: roles.bonusDisease
        ? one('bonusDisease')
        : tileSprite(paintSkull(tile.width, tile.height), tile),
    },
    bomb: lazyPerPlace(places, (p) => roles.bomb[p % roles.bomb.length]),
    bombTrigger: lazyPerPlace(places, (p) => runWithBand(roles.bomb[p % roles.bomb.length])),
    // The MENU's bomb is green: it is the colour in the file, that of the bomber
    // on the home screen, and not one of the ten player tints.
    menuBomb: roles.rawBomb ? runWithBand(roles.rawBomb) : null,
    // An explosion takes the colour of whoever dropped the bomb: each piece
    // therefore exists in as many copies as there are places.
    flame: lazyPerPlace(places, (p) => ({
      centre: roles.flameCentre[p],
      mid: DIRS.map((d) => roles[`flameMid${d}`][p]),
      end: DIRS.map((d) => roles[`flameEnd${d}`][p]),
    })),
    bombers: lazyPerPlace(places, (p) => DIRS.map((d) => roles[`walk${d}`][p])),
    idle: lazyPerPlace(places, (p) => DIRS.map((d) => roles[`idle${d}`][p][0])),
    // The original game's punch, if it has been extracted. Null otherwise, and
    // the scene then plays its own: extractions made before the glove was added
    // have no PUNCH.ANI, and a gesture that only existed here would leave the
    // bonus silent everywhere else.
    punches: roles.punch0
      ? lazyPerPlace(places, (p) => DIRS.map((d) => roles[`punch${d}`][p]))
      : null,
    // Walking with a bomb in one's arms. Null when the extraction predates the
    // blue glove, and the scene then lays the bomb on the head itself.
    carry: roles.carry0
      ? lazyPerPlace(places, (p) => DIRS.map((d) => roles[`carry${d}`][p]))
      : null,
    dead: lazyPerPlace(places, (p) => roles.dead[p]),
  };
}
