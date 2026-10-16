/**
 * Extracting only the sprites the engine uses, as SVG.
 *
 *   node scripts/extract-game.mjs "<DATA/ANI>" [--out assets/game] [--terrain 0..10]
 *
 * `extract-ani.mjs` writes out the whole corpus — 2327 images, some thirty
 * megabytes as SVG. The game only uses a fraction of it, and that is the
 * fraction we want to load in the browser. This script sorts them out from a
 * table of roles, and above all it DEDUPLICATES: an Atomic Bomberman sequence
 * goes back and forth through its images (the bomb pulses over 18 frames for 10
 * images), so we write one file per source image and the manifest only refers to
 * it by index.
 *
 * By default the colours are NOT reduced: the tracing keeps the sprite's exact
 * shades, hence its gradients. `--colours N` caps the palette at N if lighter
 * files are preferred — at sixteen shades the helmet loses its highlight and the
 * torso its half-tones, for about 40 % less weight.
 *
 * Nothing is committed: the output lands in assets/, excluded by .gitignore.
 * These sprites remain Interplay's property; you need your own copy of the game.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readAnimation } from '../src/extraction/animation.js';
import { vectorise } from '../src/extraction/vector.js';
import { decodePcx } from '../src/extraction/pcx.js';
import { encodePng } from './ani/png.mjs';
import { readPlayerColours } from './ani/remap.mjs';

/**
 * What the engine asks for, and where the game stores it.
 *
 * The four directions follow the engine's numbering — UP, RIGHT, DOWN, LEFT —
 * and not the order the file stores them in, which starts at the east. Atomic
 * Bomberman's names are all "green" because the game recoloured the green bomber
 * per player at render time; we do the same, in the loader.
 */
const DIRECTIONS = ['north', 'east', 'south', 'west'];

/**
 * Table of roles, for a given terrain.
 *
 * It depends on the terrain because the scenery comes in complete sets: terrain
 * 3 has its own rocks, its own bricks and its own falling-brick animation, in
 * TILES3 and XBRICK3. Keeping terrain 0's scenery over a sandy ground would give
 * a board that exists in no game.
 */
const rolesOf = (terrain) => ({
  ground: [`TILES${terrain}.ANI`, `tile ${terrain} blank`],
  wall: [`TILES${terrain}.ANI`, `tile ${terrain} solid`],
  brick: [`TILES${terrain}.ANI`, `tile ${terrain} brick`],
  brickBroken: [`XBRICK${terrain}.ANI`, `flame brick ${terrain}`],
  bomb: ['BOMBS.ANI', 'bomb regular green'],
  bombTrigger: ['TRIGBOMB.ANI', 'bomb trigger green'],
  dead: ['XPLODE1.ANI', 'die green 1'],

  flameCentre: ['FLAME.ANI', 'flame center green'],
  ...Object.fromEntries(DIRECTIONS.flatMap((d, k) => [
    [`flameMid${k}`, ['FLAME.ANI', `flame mid${d} green`]],
    [`flameEnd${k}`, ['FLAME.ANI', `flame tip${d} green`]],
  ])),

  ...Object.fromEntries(DIRECTIONS.flatMap((d, k) => [
    [`walk${k}`, ['WALK.ANI', `walk ${d}`]],
    [`idle${k}`, ['STAND.ANI', `stand ${d}`]],
    // Walking with a bomb in one's arms, for the blue glove. The game draws the
    // whole thing — bomber and bomb above the head — in a single sequence, which
    // is why the scene has nothing to add on top of it.
    [`carry${k}`, ['BOMBWALK.ANI', `bombwalk ${d} green`]],
  ])),

  // The boxing glove's punch: the bomber draws back, strikes, and returns to
  // guard. The game has one sequence per direction, like the walk. A missing
  // role is not an error here — it is reported, and the renderer does without.
  ...Object.fromEntries(DIRECTIONS.map((d, k) => [`punch${k}`, ['PUNCH.ANI', `punch ${d} green`]])),

  // The engine's names on the left, the game's on the right: "speed" is a roller
  // skate at Interplay, "kick" a shoe.
  bonusBomb: ['POWERS.ANI', 'power bomb'],
  bonusFlame: ['POWERS.ANI', 'power flame'],
  bonusSpeed: ['POWERS.ANI', 'power skate'],
  bonusKick: ['POWERS.ANI', 'power kicker'],
  bonusTrigger: ['POWERS.ANI', 'power trigger'],
  // The boxing glove. Absent from extractions made before it was added: the
  // renderer then draws its pack itself, at the size of the game's tiles.
  bonusGlove: ['POWERS.ANI', 'power punch'],
  // The jelly, which makes bombs bounce: 'jelly' at Interplay too.
  bonusJelly: ['POWERS.ANI', 'power jelly'],
  // The blue glove, which picks a bomb up: 'grab' at Interplay.
  bonusGrab: ['POWERS.ANI', 'power grab'],
  // The spooger, which lines the magazine up in front: 'spooger' at Interplay.
  bonusSpooger: ['POWERS.ANI', 'power spooger'],
  // The last three. Their sequence names are our best guess at Interplay's own:
  // a miss is reported and the renderer draws its own pack, which is why no
  // extraction has to be redone for these.
  bonusGoldflame: ['POWERS.ANI', 'power goldflame'],
  bonusRandom: ['POWERS.ANI', 'power random'],
  bonusDisease: ['POWERS.ANI', 'power disease'],
});

const argv = process.argv.slice(2);
const source = argv.find((a) => !a.startsWith('--'));
const read = (name, fallback) => {
  const k = argv.indexOf(`--${name}`);
  return k === -1 ? fallback : argv[k + 1];
};
const out = read('out', 'assets/game');
const colours = Number(read('colours', 0));
const terrain = Number(read('terrain', 0));

if (!source) {
  console.error('usage : node scripts/extract-game.mjs "<DATA/ANI>" [--out assets/game] [--colours N] [--terrain 0..10]');
  process.exit(1);
}

mkdirSync(out, { recursive: true });

/**
 * Geometry of the ground in the FIELD*.PCX images, measured on FIELD0.
 *
 * The grass starts at (15, 66) and its light and dark bands alternate every 36
 * pixels, that is one per row of the grid. So we cut TWO rows across the whole
 * width of the field: that band repeats vertically with no seam, and
 * horizontally it does not repeat at all.
 */
const GROUND = { x: 15, y: 66, width: 600, height: 72 };

/**
 * Cuts out the ground of the requested terrain.
 *
 * The original game's ground is not a tile: it is a 640 x 480 painted image per
 * terrain. The "tile N blank" tile of the .ANI files is another grass, spotted,
 * which does not look like the background — copying it 195 times gave a
 * checkerboard the game never had.
 *
 * And this ground comes out as PNG, the only exception to the all-vector rule:
 * it is pixel-by-pixel noise, which vectorises into 765 kB of tiny specks
 * against 3.6 kB of PNG, for a drawing that gains nothing from being scaled up.
 */
function cutGround() {
  const file = join(source, '..', 'RES', `FIELD${terrain}.PCX`);
  const field = decodePcx(readFileSync(file));
  const { x, y, width, height } = GROUND;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let l = 0; l < height; l += 1) {
    for (let c = 0; c < width; c += 1) {
      const s = ((y + l) * field.width + (x + c)) * 4;
      const d = (l * width + c) * 4;
      rgba[d] = field.rgba[s];
      rgba[d + 1] = field.rgba[s + 1];
      rgba[d + 2] = field.rgba[s + 2];
      rgba[d + 3] = 255;
    }
  }
  writeFileSync(join(out, 'ground.png'), encodePng(rgba, width, height));
  return { file: 'ground.png', width, height, terrain };
}

/**
 * The game's title screen, for the home page's background.
 *
 * We take TITLE.PCX and not MAINMENU.PCX: the latter already carries its own
 * labels — "Start Game", "Options"... — which would show through behind our own
 * form. The title screen is only an illustration.
 */
function cutHome() {
  const file = join(source, '..', 'RES', 'TITLE.PCX');
  if (!existsSync(file)) return null;
  const image = decodePcx(readFileSync(file));
  writeFileSync(join(out, 'home.png'), encodePng(image.rgba, image.width, image.height));
  return { file: 'home.png', width: image.width, height: image.height };
}

/**
 * Cuts a rectangle out of a PCX and writes it as PNG.
 *
 * @param {string} res name of the file in RES, without extension
 * @param {string} name name of the PNG produced
 * @param {{ x: number, y: number, width: number, height: number }} box
 */
function cut(res, name, box, cutout = false) {
  const file = join(source, '..', 'RES', `${res}.PCX`);
  if (!existsSync(file)) return null;
  const image = decodePcx(readFileSync(file));
  const { x, y, width, height } = box;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let l = 0; l < height; l += 1) {
    for (let c = 0; c < width; c += 1) {
      const s = ((y + l) * image.width + (x + c)) * 4;
      const d = (l * width + c) * 4;
      rgba[d] = image.rgba[s];
      rgba[d + 1] = image.rgba[s + 1];
      rgba[d + 2] = image.rgba[s + 2];
      rgba[d + 3] = 255;
    }
  }
  if (cutout === 'sky') cutOutSky(rgba, width, height);
  writeFileSync(join(out, name), encodePng(rgba, width, height));
  return { file: name, width, height };
}

/**
 * Cuts a crop out of its background: the sky becomes transparent, the drawing
 * stays.
 *
 * THE MENU'S SKY IS FLAT — night blue (0,0,72) and black — so a plain threshold
 * is enough to recognise it. But we do not erase it everywhere: we FLOOD FROM
 * THE EDGES, and only the sky that connects to the outside goes. The character's
 * black outlines, for their part, are enclosed within its silhouette and survive
 * — a threshold applied to the whole image would have punched holes in them.
 *
 * That leaves the stars, bright islands in the middle of the void: we then throw
 * away every cluster smaller than some forty pixels. The bomb and its halo are
 * far bigger and stay in place.
 *
 * @param {Uint8ClampedArray} rgba modified in place
 */
function cutOutSky(rgba, width, height) {
  const sky = (i) => rgba[i] < 48 && rgba[i + 1] < 48 && rgba[i + 2] < 120;
  const seen = new Uint8Array(width * height);
  const queue = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (seen[p] || !sky(p * 4)) return;
    seen[p] = 1;
    queue.push(p);
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (queue.length > 0) {
    const p = queue.pop();
    const x = p % width;
    const y = (p - x) / width;
    rgba[p * 4 + 3] = 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  // The islands left: stars and dust, which the flood went around.
  const mark = new Int32Array(width * height).fill(-1);
  for (let start = 0; start < mark.length; start += 1) {
    if (mark[start] !== -1 || rgba[start * 4 + 3] === 0) continue;
    const cluster = [];
    const stack = [start];
    mark[start] = start;
    while (stack.length > 0) {
      const p = stack.pop();
      cluster.push(p);
      const x = p % width;
      const y = (p - x) / width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const vx = x + dx;
        const vy = y + dy;
        if (vx < 0 || vy < 0 || vx >= width || vy >= height) continue;
        const q = vy * width + vx;
        if (mark[q] !== -1 || rgba[q * 4 + 3] === 0) continue;
        mark[q] = start;
        stack.push(q);
      }
    }
    if (cluster.length < 40) for (const p of cluster) rgba[p * 4 + 3] = 0;
  }
}

/**
 * The two crops the home page uses, cut out of the game's screens: its floating
 * bomber, and a square of starry sky. The logo is not cut out anywhere: it only
 * exists PAINTED into the title screen, with the bomber's helmet passing behind
 * it, and no rectangle separates the two. So the page takes the whole screen as
 * a banner, which it fades towards the bottom.
 *
 * The boxes are MEASURED on the images, not guessed: the logo is the bounding
 * box of the pink and yellow pixels at the top of TITLE.PCX, the bomber that of
 * the green pixels of MAINMENU.PCX, each widened by a margin. The sky comes from
 * a corner of MAINMENU where neither text nor character remains — checked by
 * counting the yellow and green pixels, there are none.
 *
 * Three crops rather than a whole screen as a background: the game's screen
 * carries its own labels — "Start Game", "Options" — which would show through
 * behind our own form.
 */
const PAGE = {
  // The logo's box stops ABOVE the bomber's helmet, which rises as far as the
  // bar of the B: two pixels more and we take the top of its head with it.
  bomber: ['MAINMENU', { x: 16, y: 20, width: 310, height: 440 }, 'sky'],
  stars: ['MAINMENU', { x: 430, y: 8, width: 200, height: 90 }],
};

/**
 * Finds a sequence by its name, without demanding it be spelt to the letter.
 *
 * The exact name first, then case-insensitively, then ALL THE WORDS present in
 * any order. Atomic Bomberman's names are not regular from one file to the next
 * — "walk north" here, "stand north green" there — and a table of roles written
 * from memory falls wide of the mark over one extra word. Missing the sequence
 * then only costs a line in the missing list, and the role silently disappears
 * from the sprite set: that is exactly what happened to the boxing glove, whose
 * bonus was missing for a whole run of extractions.
 */
function findSequence(sequences, wanted) {
  const exact = sequences.find((s) => s.name === wanted);
  if (exact) return exact;
  const lower = wanted.toLowerCase();
  const caseless = sequences.find((s) => s.name.toLowerCase() === lower);
  if (caseless) return caseless;
  const words = lower.split(/\s+/).filter(Boolean);
  return sequences.find((s) => {
    const name = s.name.toLowerCase();
    return words.every((word) => name.split(/\s+/).includes(word));
  }) ?? null;
}

/** Cache of the .ANI files already opened: TILES0 and FLAME serve several roles. */
const opened = new Map();
function open(file) {
  if (!opened.has(file)) opened.set(file, readAnimation(readFileSync(join(source, file))));
  return opened.get(file);
}

const images = [];
const indexBySource = new Map();
const roles = {};
const missing = [];

for (const [role, [file, sequence]] of Object.entries(rolesOf(terrain))) {
  let animation;
  try {
    animation = open(file);
  } catch {
    missing.push(`${role} : ${file} introuvable`);
    continue;
  }

  const seq = findSequence(animation.sequences, sequence);
  if (!seq) {
    missing.push(`${role} : séquence "${sequence}" absente de ${file}`);
    continue;
  }

  roles[role] = seq.frames.map((frame) => {
    const key = `${file}#${frame.image}`;
    let index = indexBySource.get(key);
    if (index === undefined) {
      const image = animation.images[frame.image];
      index = images.length;
      const fileName = `${String(index).padStart(3, '0')}.svg`;
      writeFileSync(join(out, fileName), vectorise(image.rgba, image.width, image.height, {
        colours,
        title: `${sequence} ${frame.image}`,
      }));
      images.push({
        file: fileName,
        width: image.width,
        height: image.height,
        // The anchor point is at the bottom centre at Atomic Bomberman: it is
        // what stands the sprite on its cell, not the corner of the image.
        anchorX: image.anchorX,
        anchorY: image.anchorY,
      });
      indexBySource.set(key, index);
    }
    return { image: index, duration: frame.duration };
  });
}

const tile = images[indexBySource.get(`TILES${terrain}.ANI#0`)] ?? images[0];
const ground = cutGround();
const home = cutHome();

/**
 * The bomb that marks the line selected in the menu, as in the game.
 *
 * It is the game's SPRITE, and not the illustration's bomb: that one is black on
 * a black sky, and cutting out takes it along with the background. This one
 * comes with its own transparency, and its green colour is simply the one before
 * recolouring — it is player 1's bomb.
 *
 * We go through the SEQUENCE and not through the deduplicated image table: two
 * sprites can share dimensions, and looking by size brought back another drawing
 * from the same file.
 *
 * As PNG and not SVG: it is served by the stylesheet, which does not read the
 * manifest and would not know which file number to ask for.
 */
function writeMenuBomb() {
  const [file, sequence] = rolesOf(terrain).bomb;
  let animation;
  try {
    animation = open(file);
  } catch {
    return null;
  }
  const seq = findSequence(animation.sequences, sequence);
  if (!seq) return null;
  const image = animation.images[seq.frames[0].image];
  writeFileSync(join(out, 'bomb.png'), encodePng(image.rgba, image.width, image.height));
  return { file: 'bomb.png', width: image.width, height: image.height };
}

const page = Object.fromEntries(
  Object.entries(PAGE).map(([name, [res, box, cutout]]) => [name, cut(res, `${name}.png`, box, cutout)]),
);
page.bomb = writeMenuBomb();
// The ten player colours, read from the game's tables.
const playerColours = readPlayerColours(join(source, '..', '..'));
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify({
  tile: { width: tile.width, height: tile.height },
  ground,
  home,
  page,
  playerColours,
  images,
  roles,
}, null, 2)}\n`);

console.log(`${Object.keys(roles).length} roles, ${images.length} images uniques, sol du terrain ${terrain}, vers ${out}/`);
console.log(`${playerColours.length} couleurs de joueur lues dans COLOR.PAL et les .RMP`);
console.log(`morceaux de la page d accueil : ${Object.entries(page).filter(([, v]) => v).map(([k]) => k).join(', ') || 'aucun'}`);
if (missing.length) console.log(`\nmanquants :\n  ${missing.join('\n  ')}`);
