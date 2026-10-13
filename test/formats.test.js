/**
 * Tests for PCX and RSS, the two formats that had none.
 *
 * They need them now for a precise reason: their byte reading has just been
 * rewritten to run in a browser too, where `Buffer` does not exist. A conversion
 * of that kind does not break loudly — it returns an image offset by one byte or
 * a sound at twice its pitch — and the game's files are not in the repository to
 * notice it.
 *
 * Everything is therefore built in memory, which has the advantage of making
 * explicit what each format demands: the palette stuck at the END of the PCX
 * behind its marker, the end-of-row padding to be thrown away, and the fact that
 * a .RSS has no header at all.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { decodePcx } from '../src/extraction/pcx.js';
import { readRss, toMono, toWav, RATE } from '../src/extraction/rss.js';
import { u16, u32, latin1 } from '../src/extraction/bytes.js';

const PCX_HEADER = 128;

/**
 * Builds an uncompressed 8-bit PCX.
 *
 * `rows` gives the palette indexes, one entry per pixel and per row.
 * `bytesPerRow` can exceed the width: that is the format's own behaviour, which
 * rounds up to an even number, and the decoder has to throw that padding away.
 */
function pcx(rows, palette, { bytesPerRow = rows[0].length } = {}) {
  const height = rows.length;
  const width = rows[0].length;

  const header = new Uint8Array(PCX_HEADER);
  const view = new DataView(header.buffer);
  header[0] = 0x0a; // ZSoft signature
  header[1] = 5; // version
  header[2] = 1; // RLE
  header[3] = 8; // bits per plane
  view.setUint16(4, 0, true); // xMin
  view.setUint16(6, 0, true); // yMin
  view.setUint16(8, width - 1, true);
  view.setUint16(10, height - 1, true);
  header[65] = 1; // a single plane
  view.setUint16(66, bytesPerRow, true);

  // Every byte is written as it is: an index below 0xc0 is never taken for a
  // repetition, which is enough to exercise the rest of the decoder.
  const body = [];
  for (const row of rows) {
    for (let x = 0; x < bytesPerRow; x += 1) body.push(row[x] ?? 0);
  }

  return Uint8Array.from([...header, ...body, 0x0c, ...palette]);
}

/** A 256-entry palette where index i is (i, i*2, i*3). */
function gradientPalette() {
  const palette = new Uint8Array(768);
  for (let i = 0; i < 256; i += 1) {
    palette[i * 3] = i;
    palette[i * 3 + 1] = (i * 2) & 0xff;
    palette[i * 3 + 2] = (i * 3) & 0xff;
  }
  return palette;
}

test('the PCX returns its pixels in its palette colours', () => {
  const image = decodePcx(pcx([[1, 2], [3, 4]], gradientPalette()));

  assert.equal(image.width, 2);
  assert.equal(image.height, 2);
  // First pixel: index 1, hence (1, 2, 3), opaque.
  assert.deepEqual([...image.rgba.slice(0, 4)], [1, 2, 3, 255]);
  // Last pixel: index 4, hence (4, 8, 12).
  assert.deepEqual([...image.rgba.slice(12, 16)], [4, 8, 12, 255]);
});

test('the end-of-row padding is thrown away', () => {
  // Two useful pixels per row, but four bytes stored: without throwing the
  // padding away, the second row would start two pixels too early and the whole
  // image would slide askew.
  const image = decodePcx(pcx([[10, 20], [30, 40]], gradientPalette(), { bytesPerRow: 4 }));

  assert.deepEqual([...image.rgba.slice(0, 4)], [10, 20, 30, 255]);
  assert.deepEqual([...image.rgba.slice(8, 12)], [30, 60, 90, 255], 'row 2 starts at 30');
});

test('the PCX RLE expands its runs', () => {
  const palette = gradientPalette();
  const header = new Uint8Array(PCX_HEADER);
  const view = new DataView(header.buffer);
  header[0] = 0x0a;
  header[3] = 8;
  header[65] = 1;
  view.setUint16(8, 3, true); // width 4
  view.setUint16(10, 0, true); // height 1
  view.setUint16(66, 4, true);

  // 0xC4 = repeat four times, then the value.
  const bytes = Uint8Array.from([...header, 0xc4, 7, 0x0c, ...palette]);
  const image = decodePcx(bytes);

  assert.equal(image.width, 4);
  for (let x = 0; x < 4; x += 1) {
    assert.deepEqual([...image.rgba.slice(x * 4, x * 4 + 4)], [7, 14, 21, 255]);
  }
});

test('a file that is not a PCX is refused, not guessed at', () => {
  assert.throws(() => decodePcx(new Uint8Array(200)), /n est pas un PCX/);
});

test('the RSS reads with no header, as signed little-endian 16-bit', () => {
  // Two stereo frames: (1000, -1000) then (32767, -32768).
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setInt16(0, 1000, true);
  view.setInt16(2, -1000, true);
  view.setInt16(4, 32767, true);
  view.setInt16(6, -32768, true);

  assert.deepEqual([...readRss(bytes)], [1000, -1000, 32767, -32768]);
});

test('an RSS truncated mid-frame loses the frame, not the rest', () => {
  const bytes = new Uint8Array(10); // two whole frames + two bytes
  new DataView(bytes.buffer).setInt16(0, 42, true);
  assert.equal(readRss(bytes).length, 4);
});

test('folding down to mono averages both channels', () => {
  const stereo = Int16Array.from([100, 300, -200, -400]);
  assert.deepEqual([...toMono(stereo)], [200, -300]);
});

test('the WAV carries a correct RIFF header and its samples', () => {
  const samples = Int16Array.from([1000, -1000, 500, -500]);
  const wav = toWav(samples, { channels: 1, rate: RATE });

  assert.equal(latin1(wav, 0, 4), 'RIFF');
  assert.equal(u32(wav, 4), wav.length - 8, 'the size announced excludes its own eight bytes');
  assert.equal(latin1(wav, 8, 12), 'WAVE');
  assert.equal(latin1(wav, 12, 16), 'fmt ');
  assert.equal(u32(wav, 16), 16, 'sixteen-byte format block');
  assert.equal(u16(wav, 20), 1, 'integer PCM');
  assert.equal(u16(wav, 22), 1, 'one channel');
  assert.equal(u32(wav, 24), RATE);
  assert.equal(u32(wav, 28), RATE * 2, 'bytes per second');
  assert.equal(u16(wav, 32), 2, 'bytes per frame');
  assert.equal(u16(wav, 34), 16, 'bits per sample');
  assert.equal(latin1(wav, 36, 40), 'data');
  assert.equal(u32(wav, 40), samples.length * 2);

  // And the samples themselves, untouched.
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  for (let i = 0; i < samples.length; i += 1) {
    assert.equal(view.getInt16(44 + i * 2, true), samples[i]);
  }
});

test('the stereo WAV does announce two channels', () => {
  const wav = toWav(Int16Array.from([1, 2, 3, 4]), { channels: 2 });
  assert.equal(u16(wav, 22), 2);
  assert.equal(u16(wav, 32), 4, 'four bytes per stereo frame');
});
