/**
 * Extracting only the sprites the engine uses, as SVG.
 *
 *   node scripts/extract-game.mjs "<DATA/ANI>" [--out assets/game] [--terrain 0..10]
 *
 * All ELEVEN boards come out by default — their ground, their rocks, their
 * bricks — because the new-game screen offers the choice; `--terrain` narrows it
 * to one while working on that board alone.
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
 * The output lands in assets/game/ AND IS COMMITTED: the page is served as it
 * is, by GitHub Pages, with no build step — sprites left out of the repository
 * would be sprites nobody but their extractor ever sees. Re-running the script
 * therefore rewrites tracked files, and the diff is meant to be read.
 *
 * These sprites remain Interplay's property; you need your own copy of the game.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readAnimation } from '../src/extraction/animation.js';
import { vectorise } from '../src/extraction/vector.js';
import { decodePcx } from '../src/extraction/pcx.js';
import { ROWS } from '../src/engine/constants.js';
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
 * How many terrains Atomic Bomberman has: eleven, numbered 0 to 10.
 *
 * The count is the game's, read off its files — TILES0 to TILES10, FIELD0 to
 * FIELD10 — and the names come from MESSAGES.TXT, where the game keeps the
 * labels of its own level list.
 */
const TERRAINS = 11;

/**
 * The scenery of ONE terrain: its ground, its rocks, its bricks, and a brick
 * giving way.
 *
 * The scenery comes in complete sets: terrain 3 has its own rocks, its own
 * bricks and its own falling-brick animation, in TILES3 and XBRICK3. Keeping
 * terrain 0's scenery over a sandy ground would give a board that exists in no
 * game — which is why these four roles are extracted ONCE PER TERRAIN, where
 * everything in ROLES is extracted once and serves them all.
 *
 * THERE IS NO GROUND TILE HERE, and there was never meant to be one: only
 * TILES0 holds a "blank" tile, and it is a spotted grass that looks nothing like
 * the field behind it — the other ten files do not even carry the sequence. The
 * ground of a board is its FIELD*.PCX, which `cutGround` takes whole.
 */
const sceneryOf = (terrain) => ({
  wall: [`TILES${terrain}.ANI`, `tile ${terrain} solid`],
  brick: [`TILES${terrain}.ANI`, `tile ${terrain} brick`],
  brickBroken: [`XBRICK${terrain}.ANI`, `flame brick ${terrain}`],
});

/**
 * What the engine asks for and the terrain does not change: the bombs, the
 * bombers, the flames and the packs.
 */
const ROLES = {
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
  // 'spooge' and not 'spooger': the POWER is a spooger in the game's manual, and
  // that is the name the engine and the wire use, but the SEQUENCE is spelled
  // 'power spooge' in POWERS.ANI. The file is the one that has to be matched.
  bonusSpooger: ['POWERS.ANI', 'power spooge'],
  bonusGoldflame: ['POWERS.ANI', 'power goldflame'],
  // Twelve frames, the only animated pack of the lot: the question mark turns.
  bonusRandom: ['POWERS.ANI', 'power random'],
  // POWERS.ANI also holds 'power disease3' and 'power clog', two more skulls we
  // do not use: the engine has one skull and draws its five illnesses from it.
  bonusDisease: ['POWERS.ANI', 'power disease'],
};

const argv = process.argv.slice(2);
const source = argv.find((a) => !a.startsWith('--'));
const read = (name, fallback) => {
  const k = argv.indexOf(`--${name}`);
  return k === -1 ? fallback : argv[k + 1];
};
const out = read('out', 'assets/game');
const colours = Number(read('colours', 0));
/**
 * Which terrains to extract: all of them, or the one named by `--terrain`.
 *
 * All eleven by default, because the launch screen offers the choice and "au
 * hasard" has to have something to draw from. The flag is kept for a quick
 * extraction while working on a single board.
 */
const only = read('terrain', null);
const wanted = only === null
  ? Array.from({ length: TERRAINS }, (_, t) => t)
  : [Number(only)];

if (!source) {
  console.error('usage : node scripts/extract-game.mjs "<DATA/ANI>" [--out assets/game] [--colours N] [--terrain 0..10]');
  process.exit(1);
}

mkdirSync(out, { recursive: true });

/**
 * Geometry of the playing field in the FIELD*.PCX images.
 *
 * The ground starts at (15, 66) and runs 600 x 396 — the fifteen columns and
 * ELEVEN rows the original game plays on, at 40 x 36 a cell. Measured on FIELD0,
 * where the grass's light and dark bands fall exactly on that grid, and checked
 * on the other ten: the game blits its tiles at fixed coordinates, so the
 * rectangle does not move from one terrain to the next.
 */
const CELL = { width: 40, height: 36 };
const GROUND = { x: 15, y: 66, width: 15 * CELL.width, height: 11 * CELL.height };

/**
 * Cuts out the ground of one terrain, as a single image the size of our arena.
 *
 * The original game's ground is not a tile: it is a 640 x 480 painted image per
 * terrain. The "tile N blank" tile of the .ANI files is another grass, spotted,
 * which does not look like the background — copying it 195 times gave a
 * checkerboard the game never had.
 *
 * THE WHOLE FIELD AND NOT A BAND, since terrain 3 and terrain 10 showed what a
 * band costs: their ground is a PAINTING — a mural under the sand, a manhole
 * cover in the tarmac — which repeating two rows turns into wallpaper. Only the
 * two grasses tile, and they tile just as well whole.
 *
 * Our arena is 15 x 13 where the game's is 15 x 11: the two extra rows are the
 * wall around the board, which the game paints into its border rather than
 * laying out as cells. So the field is placed ONE ROW DOWN and the row above and
 * the row below are filled by stretching its edge — they end up under the solid
 * tiles, which cover them whole.
 */
function cutGround(terrain) {
  const file = join(source, '..', 'RES', `FIELD${terrain}.PCX`);
  if (!existsSync(file)) return null;
  const field = decodePcx(readFileSync(file));
  const { x, y, width } = GROUND;
  const height = ROWS * CELL.height;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let l = 0; l < height; l += 1) {
    // The row of the field this one takes, clamped: above and below the board
    // its first and last rows are stretched, under the wall where nobody sees
    // them.
    const row = Math.min(GROUND.height - 1, Math.max(0, l - CELL.height));
    for (let c = 0; c < width; c += 1) {
      const s = ((y + row) * field.width + (x + c)) * 4;
      const d = (l * width + c) * 4;
      rgba[d] = field.rgba[s];
      rgba[d + 1] = field.rgba[s + 1];
      rgba[d + 2] = field.rgba[s + 2];
      rgba[d + 3] = 255;
    }
  }
  const name = `ground${terrain}.png`;
  writeFileSync(join(out, name), encodePng(rgba, width, height));
  return { file: name, width, height };
}

/**
 * The names the game gives its own terrains, read from MESSAGES.TXT.
 *
 * Messages 150 to 160, in the order of the FIELD files: "Green Acres", "Ancient
 * Egypt", "Inner City Trash"... They are KEPT AS THE GAME SPELLS THEM, like
 * `power jelly` and `BOMBS.ANI`: they are the names of its boards, and a French
 * version of "Green Acres" would be our invention rather than its vocabulary.
 *
 * Read and not written down here, so that the list cannot drift from the files
 * it names. Failing the file, the index stands in — a board with no name is
 * still playable.
 */
function readTerrainNames(root) {
  const file = join(root, 'MESSAGES.TXT');
  const names = [];
  if (existsSync(file)) {
    const text = readFileSync(file, 'latin1');
    for (let t = 0; t < TERRAINS; t += 1) {
      const line = new RegExp(`^${150 + t},"?(.*?)"?\\s*$`, 'm').exec(text);
      if (line) names[t] = line[1];
    }
  }
  return Array.from({ length: TERRAINS }, (_, t) => names[t] ?? `Terrain ${t}`);
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
/**
 * Where each image came from, in index order: "BOMBS.ANI#4", "TILES0.ANI#2".
 *
 * Kept only to stamp the manifest (see `version` below). It is what a file
 * number MEANS, and the whole point is to notice when that meaning changes.
 */
const sources = [];
const missing = [];

/**
 * Extracts one table of roles, writing out the images it has not seen yet.
 *
 * THE DEDUPLICATION IS SHARED between the eleven terrains and the roles common
 * to them: `indexBySource` is keyed on the source file and image, so the bomb
 * written while doing terrain 0 is not written again for terrain 7, and two
 * terrains that happen to use the same drawing share one file.
 *
 * @param {Record<string, [string, string]>} table
 * @param {string} what what to call it in the missing list
 */
function extract(table, what) {
  const roles = {};
  for (const [role, [file, sequence]] of Object.entries(table)) {
    let animation;
    try {
      animation = open(file);
    } catch {
      missing.push(`${what}${role} : ${file} introuvable`);
      continue;
    }

    const seq = findSequence(animation.sequences, sequence);
    if (!seq) {
      missing.push(`${what}${role} : séquence "${sequence}" absente de ${file}`);
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
        sources.push(key);
        indexBySource.set(key, index);
      }
      return { image: index, duration: frame.duration };
    });
  }
  return roles;
}

const roles = extract(ROLES, '');

/**
 * The eleven boards, each with its ground and its scenery.
 *
 * A terrain whose files are missing is DROPPED rather than written half-empty:
 * the launch screen offers what the list holds, and an entry that draws nothing
 * is worse than one entry fewer.
 */
const names = readTerrainNames(join(source, '..', '..'));
const terrains = [];
for (const terrain of wanted) {
  const scenery = extract(sceneryOf(terrain), `terrain ${terrain} : `);
  const ground = cutGround(terrain);
  if (!ground || !scenery.wall || !scenery.brick) continue;
  terrains.push({ terrain, name: names[terrain], ground, roles: scenery });
}

// The cell's size is the solid tile's: 40 x 36 at Atomic Bomberman, and the same
// for all eleven terrains — a board whose cell did not match the others could
// not share an arena with them.
const tile = images[terrains[0]?.roles.wall[0].image] ?? images[0];
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
  const [file, sequence] = ROLES.bomb;
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

/**
 * A short print of WHAT EACH FILE NUMBER MEANS, stamped on every asset URL.
 *
 * THE FILE NAMES ARE POSITIONS — 000.svg, 001.svg — and a re-extraction
 * renumbers them: adding the eleven boards moved `power bomb` from 268 to 256,
 * and 268 became the rock of Green Acres. The names did not move. A browser
 * holding the old 268.svg therefore answered the new manifest with the old
 * drawing, and the arena came up walled with bomb packs and brick packs — which
 * is exactly how it was reported, and which no amount of correct files on the
 * server could fix.
 *
 * So the loader asks for `268.svg?v=<this>`, and the print changes the moment a
 * number changes meaning. A stale manifest then asks for stale URLs — and gets
 * its own stale files, which agree with it; a fresh manifest asks for URLs
 * nothing has cached. The two can no longer be mixed, which was the whole bug.
 *
 * Hashed on the SOURCES and not on the pixels: re-running the extraction on the
 * same files must not invalidate anybody's cache for nothing.
 */
const version = createHash('sha256').update(sources.join('\n')).digest('hex').slice(0, 10);

const page = Object.fromEntries(
  Object.entries(PAGE).map(([name, [res, box, cutout]]) => [name, cut(res, `${name}.png`, box, cutout)]),
);
page.bomb = writeMenuBomb();
// The ten player colours, read from the game's tables.
const playerColours = readPlayerColours(join(source, '..', '..'));
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify({
  version,
  tile: { width: tile.width, height: tile.height },
  terrains,
  home,
  page,
  playerColours,
  images,
  roles,
}, null, 2)}\n`);

console.log(`${Object.keys(roles).length} roles communs, ${images.length} images uniques, vers ${out}/`);
console.log(`empreinte des images : ${version} — elle change quand un numero change de sens`);
console.log(`${terrains.length} terrains : ${terrains.map((t) => `${t.terrain} ${t.name}`).join(', ')}`);
console.log(`${playerColours.length} couleurs de joueur lues dans COLOR.PAL et les .RMP`);
console.log(`morceaux de la page d accueil : ${Object.entries(page).filter(([, v]) => v).map(([k]) => k).join(', ') || 'aucun'}`);
if (missing.length) console.log(`\nmanquants :\n  ${missing.join('\n  ')}`);
