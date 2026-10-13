/**
 * Extracting Atomic Bomberman's sprites into usable sheets.
 *
 *   node scripts/extract-ani.mjs <DATA/ANI> --out assets --format svg
 *
 * The game is not provided: you have to point at the DATA/ANI folder of your own
 * copy. Nothing is downloaded, nothing is committed — the output folder is
 * excluded by .gitignore, because these sprites remain Interplay's property.
 *
 * By default the colours are NOT reduced: the tracing keeps the sprite's exact
 * shades. `--colours N` caps the palette at N for lighter files, at the price of
 * the gradients.
 *
 * The .ANI format is documented nowhere; it was reconstructed here, and the
 * three modules of scripts/ani/ each explain the part they decode. `--probe`
 * prints a file's tree, which stays the best starting point for understanding
 * the rest.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { readChunks, walk, readHeader } from '../src/extraction/chfile.js';
import { readAnimation } from '../src/extraction/animation.js';
import { encodePng } from './ani/png.mjs';
import { vectorise } from '../src/extraction/vector.js';

function options(argv) {
  const o = { source: '', out: 'assets', format: 'svg', colours: 0, only: '', probe: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--probe') o.probe = true;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
    else rest.push(a);
  }
  o.source = rest[0] ?? o.source;
  o.colours = Number(o.colours);
  return o;
}

/** Lists the .ANI files to handle: one file, or a whole folder. */
function files(source, only) {
  if (extname(source).toLowerCase() === '.ani') return [source];
  return readdirSync(source)
    .filter((n) => /\.ANI$/i.test(n))
    .filter((n) => !only || n.toUpperCase().includes(only.toUpperCase()))
    .map((n) => join(source, n));
}

/** Prints the tree of chunks: the format's manual, in one command. */
function probe(path) {
  const bytes = readFileSync(path);
  console.log(`${basename(path)} — sous-type ${readHeader(bytes).subtype}`);
  for (const { node, path: levels } of walk(readChunks(bytes))) {
    console.log(`${'  '.repeat(levels.length + 1)}${node.id} ${node.size} o`);
  }
}

/**
 * Lays a file's images out on a square sheet.
 *
 * A grid rather than a strip: bomber sprites are 110 pixels a side and a strip of
 * fifteen images went past 1600 pixels wide, beyond what some textures accept.
 * The grid keeps both sides modest.
 */
function sheet(images) {
  const cell = { w: Math.max(...images.map((i) => i.width)), h: Math.max(...images.map((i) => i.height)) };
  const columns = Math.ceil(Math.sqrt(images.length));
  const rows = Math.ceil(images.length / columns);
  const W = cell.w * columns;
  const H = cell.h * rows;
  const rgba = new Uint8ClampedArray(W * H * 4);

  const cells = images.map((im, k) => {
    const cx = (k % columns) * cell.w;
    const cy = Math.floor(k / columns) * cell.h;
    for (let y = 0; y < im.height; y += 1) {
      for (let x = 0; x < im.width; x += 1) {
        const s = (y * im.width + x) * 4;
        if (!im.rgba[s + 3]) continue;
        const d = ((cy + y) * W + cx + x) * 4;
        rgba[d] = im.rgba[s];
        rgba[d + 1] = im.rgba[s + 1];
        rgba[d + 2] = im.rgba[s + 2];
        rgba[d + 3] = 255;
      }
    }
    return { name: im.name, x: cx, y: cy, w: im.width, h: im.height, ax: im.anchorX, ay: im.anchorY };
  });

  return { rgba, W, H, cells };
}

function handle(path, o) {
  const { images, sequences } = readAnimation(readFileSync(path));
  const name = basename(path, extname(path)).toLowerCase();
  if (!images.length) return { name, images: 0 };

  const folder = join(o.out, name);
  mkdirSync(folder, { recursive: true });

  const manifest = { name, sequences };

  if (o.format === 'png' || o.format === 'both') {
    const { rgba, W, H, cells } = sheet(images);
    writeFileSync(join(folder, `${name}.png`), encodePng(rgba, W, H));
    manifest.sheet = { file: `${name}.png`, width: W, height: H, cells };
  }

  if (o.format === 'svg' || o.format === 'both') {
    manifest.vectors = images.map((im, k) => {
      const file = `${String(k).padStart(3, '0')}.svg`;
      writeFileSync(join(folder, file), vectorise(im.rgba, im.width, im.height, {
        colours: o.colours,
        title: im.name,
      }));
      return { file, width: im.width, height: im.height, anchorX: im.anchorX, anchorY: im.anchorY };
    });
  }

  writeFileSync(join(folder, `${name}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  return { name, images: images.length, sequences: sequences.length };
}

const o = options(process.argv.slice(2));
if (!o.source) {
  console.error('usage : node scripts/extract-ani.mjs <DATA/ANI> [--out assets] [--format svg|png|both] [--colours N] [--only BWALK] [--probe]');
  process.exit(1);
}

const list = files(o.source, o.only);
if (o.probe) {
  list.forEach(probe);
} else {
  let images = 0;
  for (const path of list) {
    const r = handle(path, o);
    images += r.images;
    console.log(`${r.name.padEnd(12)} ${String(r.images).padStart(4)} images  ${String(r.sequences ?? 0).padStart(3)} séquences`);
  }
  console.log(`\n${list.length} fichiers, ${images} images, format ${o.format}, vers ${o.out}/`);
}
