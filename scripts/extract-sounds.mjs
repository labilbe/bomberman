/**
 * Extracting Atomic Bomberman's sounds and music as WAV.
 *
 *   node scripts/extract-sounds.mjs "<DATA>" [--out assets/sounds]
 *
 * The game keeps its 251 sound effects in DATA/SOUND, as .RSS — raw PCM, with no
 * header — and their table in DATA/RES/SOUNDLST.RES. We only take what the
 * engine needs: one role per event, with its variants, taken from the range of
 * identifiers the game reserves for that use.
 *
 * The variants matter. Atomic Bomberman has twenty explosion sounds and thirteen
 * for a bonus picked up, and draws them at random: with four players, one
 * explosion a second, a single sound would soon become a saw.
 *
 * Nothing is committed: the output lands in assets/, excluded by .gitignore.
 * These sounds remain Interplay's property; you need your own copy of the game.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readRss, toMono, resample, toWav, RATE } from '../src/extraction/rss.js';
import { readList, range } from '../src/extraction/list.js';

/**
 * What the engine announces, and where the game keeps the matching sound.
 *
 * The bounds come from the comments in SOUNDLST.RES, not from a choice of ours:
 * it is the game that declares 200 to 219 to be explosions.
 */
const ROLES = {
  bomb: [100, 102], // dropping a bomb
  boom: [200, 219], // explosion
  kick: [120, 123], // bomb kicked
  death: [300, 301], // dying in the flames
  pick: [400, 412], // picking a bonus up
  // The jelly's "boing". SOUNDLST groups them itself: "jelly bomb bouncing",
  // from 135 to 139.
  bounce: [135, 139], // a mad bomb bouncing
};

/**
 * The music, and what has to be known before looking for it.
 *
 * Only these exist in an installation. The eleven GAME tracks — grnacres,
 * hockey, sewer... — are commented out in SOUNDLST.RES and absent from the disk:
 * they were audio tracks on the CD, which the game read directly. So there is no
 * music during a round, and that is not an oversight.
 */
const MUSIC = { menu: 1010, win: 1020, loss: 1030, draw: 1130 };

const argv = process.argv.slice(2);
const source = argv.find((a) => !a.startsWith('--'));
const read = (name, fallback) => {
  const k = argv.indexOf(`--${name}`);
  return k === -1 ? fallback : argv[k + 1];
};
const out = read('out', 'assets/sounds');
// By default the music is NOT touched: original rate, true stereo. Reducing it
// to 11 kHz mono did divide its weight by four, but could be heard at once — and
// since it loads on demand, that weight does not delay the page opening. The
// --music-hz option stays for whoever prefers the opposite trade; it then
// averages the window instead of taking every other sample, which is what the
// old version did.
const musicRate = Number(read('music-hz', RATE));

if (!source) {
  console.error('usage : node scripts/extract-sounds.mjs "<DATA>" [--out assets/sounds] [--music-hz 11025]');
  process.exit(1);
}

mkdirSync(out, { recursive: true });

const table = readList(readFileSync(join(source, 'RES', 'SOUNDLST.RES'), 'latin1'));
const soundFolder = join(source, 'SOUND');

/**
 * Converts a .RSS into WAV.
 *
 * SOUND EFFECTS are folded down to mono: their two channels are 99 % identical —
 * it is mono stored as stereo — and the game plays them in the centre. We halve
 * the weight without losing anything.
 *
 * The MUSIC, on the other hand, comes out as it is: true stereo, original rate,
 * no processing. It is loaded on demand and not at start-up, so its weight costs
 * nothing when the page opens — reducing it bought nothing and could be heard
 * straight away.
 */
function convert(name, { rate = RATE, mono = true } = {}) {
  const path = join(soundFolder, `${name.toUpperCase()}.RSS`);
  if (!existsSync(path)) return null;

  const raw = readRss(readFileSync(path));
  const channels = mono ? 1 : 2;
  const prepared = mono ? resample(toMono(raw), RATE, rate) : raw;
  const wav = toWav(prepared, { channels, rate });

  const file = `${name.toLowerCase()}.wav`;
  writeFileSync(join(out, file), wav);
  return { file, bytes: wav.length, seconds: prepared.length / channels / rate };
}

const manifest = { roles: {}, music: {} };
const absent = [];
let total = 0;

for (const [role, [first, last]] of Object.entries(ROLES)) {
  const names = range(table, first, last);
  const written = [];
  for (const name of names) {
    const r = convert(name);
    if (!r) { absent.push(`${role} : ${name}.RSS`); continue; }
    written.push(r.file);
    total += r.bytes;
  }
  manifest.roles[role] = written;
}

for (const [role, identifier] of Object.entries(MUSIC)) {
  const name = table.get(identifier);
  if (!name) { absent.push(`musique ${role} : identifiant ${identifier} absent de la liste`); continue; }
  const r = convert(name, { rate: musicRate, mono: musicRate !== RATE });
  if (!r) { absent.push(`musique ${role} : ${name}.RSS`); continue; }
  manifest.music[role] = { file: r.file, seconds: Number(r.seconds.toFixed(1)) };
  total += r.bytes;
}

writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const variants = Object.entries(manifest.roles).map(([r, v]) => `${r} ${v.length}`).join(', ');
console.log(`${Object.keys(manifest.roles).length} roles (${variants}), ${Object.keys(manifest.music).length} musiques`);
console.log(`${(total / 1024 / 1024).toFixed(1)} Mo vers ${out}/`);
if (absent.length) console.log(`\nabsents :\n  ${absent.join('\n  ')}`);
