/**
 * Tests for decoding Atomic Bomberman's .ANI files.
 *
 * The game's files are not in the repository — they belong to Interplay — so
 * nothing here reads the disk. Every test builds a CHFILE container in memory,
 * which has the advantage of making explicit what the format demands: the
 * TEN-byte chunk header, the compressed size that counts its own sub-header, the
 * offset of one on the RLE lengths.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readHeader, readChunks, payload, string } from '../src/extraction/chfile.js';
import { readImageHeader, expand, rgb555, decode } from '../src/extraction/cimg.js';
import { vectorise, reducePalette } from '../src/extraction/vector.js';

/** Builds a chunk: id(4) + size(4) + flags(2) + payload. */
function chunk(id, body, flags = 1) {
  const head = Buffer.alloc(10);
  head.write(id.padEnd(4), 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  head.writeUInt16LE(flags, 8);
  return Buffer.concat([head, body]);
}

function file(chunks) {
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(16);
  head.write('CHFILEANI ', 0, 'latin1');
  head.writeUInt32LE(body.length, 10);
  return Buffer.concat([head, body]);
}

/** A 16-bit CIMG: a 36-byte header, then the RLE stream. */
function cimg(width, height, key, stream) {
  const bytes = Buffer.alloc(36 + stream.length);
  bytes.writeUInt16LE(4, 0);
  bytes.writeUInt32LE(24, 4);
  bytes.writeUInt16LE(width, 12);
  bytes.writeUInt16LE(height, 14);
  bytes.writeUInt16LE(width >> 1, 16);
  bytes.writeUInt16LE(height - 1, 18);
  bytes.writeUInt16LE(key, 20);
  bytes.writeUInt32LE(stream.length + 12, 28);
  bytes.writeUInt32LE(width * height * 2, 32);
  stream.copy(bytes, 36);
  return bytes;
}

test('a chunk header is ten bytes, not eight', () => {
  // The format's trap: read as RIFF, the second chunk falls two bytes too early.
  // This test fails loudly if somebody "simplifies" it into RIFF.
  const f = file([chunk('HEAD', Buffer.alloc(6)), chunk('FNAM', Buffer.from('ok\0', 'latin1'))]);
  assert.equal(readHeader(f).subtype, 'ANI');
  const nodes = readChunks(f);
  assert.deepEqual(nodes.map((n) => n.id), ['HEAD', 'FNAM']);
  assert.equal(string(payload(f, nodes[1])), 'ok');
});

test('the RLE lengths are offset by one', () => {
  // 0x81 = repetition of two pixels; 0x01 = two literals; 0xff = end.
  const stream = Buffer.from([0x81, 0x11, 0x11, 0x01, 0x22, 0x22, 0x33, 0x33, 0xff]);
  const { pixels, filled } = expand(stream, 4, 1, 16, 0);
  assert.equal(filled, 4);
  assert.deepEqual([...pixels], [0x1111, 0x1111, 0x2222, 0x3333]);
});

test('a repetition crosses the end of a row without saying anything', () => {
  // There is no end-of-row marker in the format: a single command can fill
  // several rows, which a decoder written in (x, y) would miss.
  const { pixels } = expand(Buffer.from([0x85, 0xaa, 0xaa, 0xff]), 2, 3, 16, 0);
  assert.equal(pixels.length, 6);
  assert.deepEqual([...pixels], Array(6).fill(0xaaaa));
});

test('the compressed size counts its own sub-header', () => {
  const stream = Buffer.from([0x83, 0x00, 0x00, 0xff]);
  const header = readImageHeader(cimg(2, 2, 0, stream));
  assert.equal(header.bits, 16);
  assert.equal(header.data, 36);
  assert.equal(header.compressed - 12, stream.length);
});

test('the game greys stay grey in RGB555', () => {
  // 0x1084 and 0x6739 are the same value repeated over three five-bit fields.
  // Read as 565 they turn green — which is the proof that the format is 555.
  for (const word of [0x1084, 0x6739, 0x4210]) {
    const [r, g, b] = rgb555(word);
    assert.equal(r, g);
    assert.equal(g, b);
  }
  assert.deepEqual(rgb555(0x7fff), [255, 255, 255]);
});

test('the key colour becomes transparent', () => {
  const stream = Buffer.from([0x81, 0x10, 0x42, 0x81, 0xff, 0x7f, 0xff]);
  const img = decode(cimg(2, 2, 0x4210, stream));
  assert.deepEqual([...img.rgba.slice(0, 8)], [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...img.rgba.slice(8, 16)], [255, 255, 255, 255, 255, 255, 255, 255]);
});

test('the vectoriser returns one closed outline per colour', () => {
  // A solid 2 x 2 square: a single shape, four corners, closed.
  const rgba = new Uint8ClampedArray(2 * 2 * 4).fill(255);
  const svg = vectorise(rgba, 2, 2, { colours: 4 });
  assert.equal(svg.split('<path').length - 1, 1);
  assert.match(svg, /d="M[^"]*Z"/);
  assert.equal((svg.match(/Z/g) ?? []).length, 1);
});

test('by default the vectoriser keeps the exact colours', () => {
  // Three neighbouring shades: reduced, they would merge into one and the
  // gradient would disappear. Without reduction, each keeps its shape and value.
  const rgba = new Uint8ClampedArray(3 * 1 * 4);
  rgba.set([10, 120, 10, 255], 0);
  rgba.set([12, 124, 12, 255], 4);
  rgba.set([14, 128, 14, 255], 8);
  const svg = vectorise(rgba, 3, 1);
  assert.equal(svg.split('<path').length - 1, 3);
  for (const hex of ['#0a780a', '#0c7c0c', '#0e800e']) assert.match(svg, new RegExp(hex));
});

test('the reduced palette ignores transparent pixels', () => {
  const rgba = new Uint8ClampedArray(8);
  rgba.set([255, 0, 0, 255], 0); // one opaque red pixel
  rgba.set([0, 255, 0, 0], 4); // one transparent green pixel
  assert.deepEqual(reducePalette(rgba, 4), [[255, 0, 0]]);
});
