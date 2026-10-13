/**
 * Atomic Bomberman's sounds: reading the .RSS files, writing WAV.
 *
 * There is nothing to guess for once — the game's author wrote the format at the
 * top of his own resource file, DATA/RES/SOUNDLST.RES:
 *
 *   "These files all should have a .RSS extension and be raw 22khz Stereo
 *    16bit signed, Intel-endian."
 *
 * So no header and no compression: the file IS the stream. Checked on all 251
 * sounds — every size is a multiple of four bytes (one stereo frame of two
 * 16-bit samples), the peaks reach full scale and the DC component is zero.
 *
 * We write WAV out because it is the only format the browser decodes natively
 * without our shipping an encoder: the repository has no dependency at all, and
 * there is no ffmpeg on the machine.
 */

import { i16, writeU16, writeU32, writeLatin1, concat } from './bytes.js';

/** Sample rate of the .RSS files, announced by the game. */
export const RATE = 22050;

/** Number of channels in a .RSS. */
const CHANNELS = 2;

/**
 * Reads a .RSS into interleaved samples.
 *
 * @param {Uint8Array} bytes
 * @returns {Int16Array}
 */
export function readRss(bytes) {
  const frames = Math.floor(bytes.length / (2 * CHANNELS));
  const output = new Int16Array(frames * CHANNELS);
  for (let i = 0; i < output.length; i += 1) output[i] = i16(bytes, i * 2);
  return output;
}

/**
 * Folds a stereo stream down to mono.
 *
 * The game's sound effects are 99 % identical on both channels — it is mono
 * stored as stereo. Folding them halves the weight without losing anything, and
 * the game plays them in the centre anyway.
 *
 * @param {Int16Array} interleaved
 */
export function toMono(interleaved) {
  const frames = interleaved.length / CHANNELS;
  const output = new Int16Array(frames);
  for (let i = 0; i < frames; i += 1) {
    output[i] = (interleaved[i * CHANNELS] + interleaved[i * CHANNELS + 1]) / 2;
  }
  return output;
}

/**
 * Resamples, averaging the window when going down.
 *
 * The average is not an ornament. Without it, going from 22 to 11 kHz takes
 * every other sample and folds all the treble into the bass: the music becomes
 * metallic and dirty. That is exactly what could be heard on the menu music,
 * shrunk by plain interpolation.
 *
 * This moving-average filter is worth what it is worth — it has none of a real
 * low-pass's steepness — but it removes most of the aliasing in three lines. The
 * best is not to resample at all, which is what the music now does.
 *
 * @param {Int16Array} source
 * @param {number} from
 * @param {number} to
 */
export function resample(source, from, to) {
  if (from === to) return source;
  const ratio = to / from;
  const frames = Math.floor(source.length * ratio);
  const output = new Int16Array(frames);
  // Width of the window to average: one output covers that many inputs.
  const window = Math.max(1, Math.round(from / to));

  for (let i = 0; i < frames; i += 1) {
    const centre = Math.round(i / ratio);
    let sum = 0;
    let count = 0;
    for (let k = -(window >> 1); k <= window >> 1; k += 1) {
      const j = centre + k;
      if (j < 0 || j >= source.length) continue;
      sum += source[j];
      count += 1;
    }
    output[i] = Math.round(sum / count);
  }
  return output;
}

/** Writes a RIFF chunk: identifier, length, payload. */
function chunk(type, payload) {
  const header = new Uint8Array(8);
  writeLatin1(header, 0, type);
  writeU32(header, 4, payload.length);
  return concat([header, payload]);
}

/**
 * Encodes samples as PCM WAV.
 *
 * @param {Int16Array} samples interleaved
 * @param {{ channels?: number, rate?: number }} options
 */
export function toWav(samples, { channels = 1, rate = RATE } = {}) {
  const bytesPerFrame = channels * 2;
  const format = new Uint8Array(16);
  writeU16(format, 0, 1); // integer PCM
  writeU16(format, 2, channels);
  writeU32(format, 4, rate);
  writeU32(format, 8, rate * bytesPerFrame);
  writeU16(format, 12, bytesPerFrame);
  writeU16(format, 14, 16);

  const data = new Uint8Array(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength,
  );
  const header = new Uint8Array(4);
  writeLatin1(header, 0, 'WAVE');
  const body = concat([header, chunk('fmt ', format), chunk('data', data)]);
  return chunk('RIFF', body);
}
