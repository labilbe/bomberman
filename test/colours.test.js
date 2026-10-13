/**
 * Tests for reading the player colours.
 *
 * The game's tables are not in the repository — they belong to Interplay — so
 * nothing here reads the disk. Every test builds a COLOR.PAL and some .RMP files
 * in memory, which has the advantage of making explicit what the module really
 * demands of the format: a SIX-bit palette, a three-byte header before the .RMP
 * entries, and a recognisable green ramp.
 *
 * What these tests lock down is not the format but the REASONING: the module
 * only keeps the hue from the tables, and it is that caution that has to survive
 * later readings. See the header of colours.js for why applying the tables as
 * they are gives a blotchy sprite.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { playerColours, COLOURS } from '../src/extraction/colours.js';

/** Lengths imposed by the format, repeated here so as not to guess them. */
const PALETTE = 768;
const INVERSE = 32768;
const RMP_HEADER = 3;

/** The game's green ramp, and the replacement ramps, in our palette. */
const GREEN = { start: 1, length: 16 };
const RED = { start: 17, length: 16 };
const BLUE = { start: 33, length: 16 };

/**
 * Builds a COLOR.PAL: three ramps, then the inverse table.
 *
 * The components are six bits, as in the game's file. We climb in steps of four
 * so that the ramp covers the whole height without ever touching pure black or
 * pure white, where hue no longer exists.
 */
function palette() {
  const bytes = Buffer.alloc(PALETTE + INVERSE);
  const put = ({ start, length }, component) => {
    for (let k = 0; k < length; k += 1) {
      bytes[(start + k) * 3 + component] = (k + 1) * 4 - 1;
    }
  };
  put(GREEN, 1);
  put(RED, 0);
  put(BLUE, 2);
  return bytes;
}

/** A .RMP that remaps nothing: every index points at itself. */
function identity() {
  const bytes = Buffer.alloc(RMP_HEADER + 256);
  for (let i = 0; i < 256; i += 1) bytes[RMP_HEADER + i] = i;
  return bytes;
}

/** A .RMP sending the green ramp onto another ramp, step by step. */
function towards(target) {
  const bytes = identity();
  for (let k = 0; k < GREEN.length; k += 1) {
    bytes[RMP_HEADER + GREEN.start + k] = target.start + k;
  }
  return bytes;
}

/** The ten tables, including those we want to watch at the places asked for. */
function tables(replacements = {}) {
  return Array.from({ length: COLOURS }, (_, n) => replacements[n] ?? identity());
}

test('each player hue comes from the ramp its table points at', () => {
  const colours = playerColours(palette(), tables({ 0: towards(RED), 1: towards(BLUE) }));

  assert.equal(colours.length, COLOURS);
  assert.equal(colours[0].hue, 0);
  assert.equal(colours[1].hue, 240);
});

test('a table that remaps nothing leaves the green as it is', () => {
  const colours = playerColours(palette(), tables({ 0: towards(RED) }));

  // Place 9 is an identity: its target is its source, hence the green ramp.
  assert.equal(colours[9].hue, 120);
});

test('a fully saturated ramp comes out saturated', () => {
  const colours = playerColours(palette(), tables({ 0: towards(RED) }));

  assert.equal(colours[0].saturation, 1);
});

test('a target as light as its source corrects no lightness', () => {
  // The three ramps climb the same way: only the component changes. The
  // difference in luminosity between source and target is therefore zero.
  const colours = playerColours(palette(), tables({ 0: towards(RED) }));

  assert.equal(colours[0].lightness, 0);
});

test('only pure green sources are queried', () => {
  // We make the RED ramp — which is not green — point at blue. The module must
  // not read it: only the green ramp is swappable, and sticking to that is the
  // whole caution of the module.
  const table = identity();
  for (let k = 0; k < RED.length; k += 1) {
    table[RMP_HEADER + RED.start + k] = BLUE.start + k;
  }

  const colours = playerColours(palette(), tables({ 0: towards(RED), 1: table }));

  // Place 1 remaps no green: it stays on the green ramp.
  assert.equal(colours[1].hue, 120);
});

test('an entry falling on zero makes the source be discarded', () => {
  // Zero is the palette's dead index. A source that one of the tables sends
  // there says nothing reliable, and has to leave the sample everywhere.
  const dead = towards(RED);
  dead[RMP_HEADER + GREEN.start] = 0;

  const colours = playerColours(palette(), tables({ 0: dead, 1: towards(BLUE) }));

  assert.equal(colours[0].hue, 0);
  assert.equal(colours[1].hue, 240);
});

test('a palette of the wrong size is refused, rather than read askew', () => {
  assert.throws(
    () => playerColours(Buffer.alloc(PALETTE), tables()),
    /COLOR\.PAL fait 768 octets/,
  );
});

test('all ten tables are needed, not nine', () => {
  assert.throws(
    () => playerColours(palette(), tables().slice(0, 9)),
    /9 fichiers \.RMP/,
  );
});
