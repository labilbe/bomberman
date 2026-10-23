/**
 * Tests for the angle of the trigger bomb's band.
 *
 * The band follows the axis of the yellow cap on top of the bomb, measured on
 * the pixels rather than hard-coded. The measurement has one trap: the bombs are
 * TINTED to the colour of whoever drops them, and on the yellow place the whole
 * sphere answers to the colour of brass. The axis of a disc is noise — in the
 * game it came out nearly upright, and the band then ran along the fuse and
 * stuck out of the silhouette.
 *
 * Nothing here draws: `capAxis` reads a buffer of pixels, so the tests build
 * their bombs by hand rather than rasterising a sprite.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { capAxis } from '../src/render/spriteSet.js';

const SIDE = 40;
const DARK = [40, 40, 60];
const YELLOW = [220, 200, 40];

/** An empty, fully transparent sprite of `SIDE` by `SIDE`. */
const blank = () => new Uint8ClampedArray(SIDE * SIDE * 4);

/** Paints one opaque pixel, if it falls inside the sprite. */
function put(data, x, y, [r, g, b]) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= SIDE || py >= SIDE) return;
  const i = (py * SIDE + px) * 4;
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = 255;
}

/** A filled disc, in one colour. */
function disc(data, cx, cy, radius, colour) {
  for (let y = Math.floor(cy - radius); y <= cy + radius; y += 1) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) put(data, x, y, colour);
    }
  }
}

/** A short leaning bar, two pixels thick: the cap seen from the side. */
function bar(data, cx, cy, length, angle, colour) {
  for (let t = -length / 2; t <= length / 2; t += 0.25) {
    for (let w = -2; w <= 2; w += 0.5) {
      put(
        data,
        cx + t * Math.cos(angle) - w * Math.sin(angle),
        cy + t * Math.sin(angle) + w * Math.cos(angle),
        colour,
      );
    }
  }
}

const degrees = (radians) => (radians * 180) / Math.PI;

test('the cap gives its own slope', () => {
  const data = blank();
  disc(data, 20, 24, 12, DARK);
  bar(data, 20, 13, 14, (-14 * Math.PI) / 180, YELLOW);
  assert.ok(Math.abs(degrees(capAxis(data, SIDE, SIDE)) + 14) < 4);
});

test('a bomb tinted yellow all over has no cap to measure', () => {
  const data = blank();
  // The sphere in the colour of brass, cap included: nothing tells them apart
  // any more, and an angle read here would be whichever way the noise leans.
  disc(data, 20, 24, 12, YELLOW);
  bar(data, 20, 13, 14, (-14 * Math.PI) / 180, YELLOW);
  assert.equal(capAxis(data, SIDE, SIDE), null);
});

test('a cap too small to mean anything is refused', () => {
  const data = blank();
  disc(data, 20, 24, 12, DARK);
  disc(data, 20, 13, 1, YELLOW);
  assert.equal(capAxis(data, SIDE, SIDE), null);
});
