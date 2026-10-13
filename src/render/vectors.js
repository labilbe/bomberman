/**
 * Loading the vector sprites extracted from Atomic Bomberman.
 *
 * The SVGs are NOT drawn on every frame. They are rasterised once at start-up
 * into off-screen canvases, and it is that canvas the scene then copies. The
 * difference is not marginal: a `drawImage` from an SVG redoes the tracing of a
 * few hundred paths on every call, and the game makes several hundred of them
 * per frame — the counter fell below ten frames a second. Rasterised, they are
 * plain pixel copies.
 *
 * That is the price of the "SVG at runtime" choice: some loading time, in
 * exchange for a repository without binary assets and sprites that can be
 * scaled up without loss.
 *
 * The original game only stores a GREEN bomber and recoloured its palette per
 * player at render time. We do the same here, failing which the places would be
 * indistinguishable.
 */

import { PLACES } from './palette.js';

/** Where the renderer expects the sprites, relative to the page. */
const FOLDER = 'assets/jeu';

/**
 * Hue, saturation, lightness, over [0,360] and [0,1].
 */
function toHsl(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const [R, G, B] = [r / 255, g / 255, b / 255];
  let h;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [((h * 60) + 360) % 360, s, l];
}

/** Back to RGB. */
function toRgb(h, s, l) {
  if (s === 0) {
    const grey = Math.round(l * 255);
    return [grey, grey, grey];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (offset) => {
    let x = ((h / 360 + offset) % 1 + 1) % 1;
    if (x < 1 / 6) x = p + (q - p) * 6 * x;
    else if (x < 1 / 2) x = q;
    else if (x < 2 / 3) x = p + (q - p) * (2 / 3 - x) * 6;
    else x = p;
    return Math.round(x * 255);
  };
  return [channel(1 / 3), channel(0), channel(-1 / 3)];
}

/**
 * Repaints a sprite's green in a player's colour.
 *
 * The colour comes from the game's tables (see scripts/ani/remap.mjs), but it is
 * applied by a HUE ROTATION, and not by substituting colours one by one as
 * Atomic Bomberman does. The reason lies in those tables: they are made for
 * 8-bit art, and applied to our 16-bit sprites they send two neighbouring
 * pixels to unrelated colours. The sprite came out blotchy, the helmet garish.
 *
 * The rotation, on the other hand, keeps each pixel's LIGHTNESS: all hundred and
 * sixty shades of the bomber survive, and so do its volume and its highlights.
 *
 * We only touch pixels that are clearly green and saturated enough. The helmet,
 * the visor and the metal parts are grey: tinting them would erase what makes
 * the silhouette legible, and that is precisely what palette substitution did.
 */
function recolour(data, colour) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const [h, s, l] = toHsl(data[i], data[i + 1], data[i + 2]);
    if (s < 0.25 || h < 70 || h > 170) continue;
    const lightness = Math.min(1, Math.max(0, l + colour.lightness * (1 - l)));
    const [r, g, b] = toRgb(colour.hue, colour.saturation, lightness);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

/**
 * Loads an image, through `onload` and not through `decode()`.
 *
 * `decode()` is the API made for this, and yet it is the trap: on the ground's
 * PNG it NEVER returns — neither resolving nor rejecting. The same file loads
 * without a murmur through `onload` and through `createImageBitmap`, and shows
 * as it is in a tab; it also passes the check of its CRCs and of its IDAT size.
 * So there is nothing wrong with the file, it is `decode()` that stops.
 *
 * And since loading is awaited at the top of the module in main.js, a single
 * pending promise was enough never to build the scene: the menu stayed up, the
 * buttons did nothing, without the slightest error in the console.
 */
function load(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`unreadable image: ${url}`));
    image.src = url;
  });
}

/** Rasterises an SVG into a canvas, at the requested scale. */
async function rasterise(url, width, height, scale) {
  const image = await load(url);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  // Smoothing stays ON here, unlike everywhere else in the game: we are scaling
  // up a vector drawing, not pixels, and the browser renders the curves better
  // than a nearest-neighbour copy would.
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A sprite as the scene consumes it: a canvas and its anchor point. */
function sprite(canvas, source, scale) {
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    anchorX: source.anchorX * scale,
    anchorY: source.anchorY * scale,
  };
}

/**
 * The roles that carry the player's colour, and must therefore be declined.
 *
 * Flames are part of them: in Atomic Bomberman an explosion takes the colour of
 * whoever dropped the bomb. It is even how you recognise who has just killed
 * you.
 */
const PER_PLACE = /^(walk|idle|punch)\d$|^dead$|^bomb|^flame/;

/**
 * An array of one series per colour, BUILT ON DEMAND.
 *
 * Recolouring one colour costs a pass over 196 images, that is 1.3 million
 * pixels and some sixty milliseconds. The game offers ten, and a game never
 * shows more than four: building everything on load would make everyone pay for
 * six series nobody looks at — measured, that is 370 milliseconds more on a page
 * that already takes two thousand.
 *
 * Each slot is therefore an accessor that builds its series on first access,
 * then replaces itself with the result. Callers only ever see an array.
 *
 * @param {(place: number) => unknown[]} build
 */
function lazySeries(build) {
  const array = [];
  PLACES.forEach((_, place) => {
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
  });
  return array;
}

/**
 * Loads the set of vector sprites.
 *
 * Returns `null` when the assets are not there — the normal case of a freshly
 * cloned repository, and the caller then falls back on the sprites drawn in
 * code. Missing assets are not an error.
 */
export async function loadVectors({ folder = FOLDER, scale = 1 } = {}) {
  let manifest;
  try {
    const response = await fetch(`${folder}/manifest.json`);
    if (!response.ok) return null;
    manifest = await response.json();
  } catch {
    return null;
  }

  const canvases = await Promise.all(
    manifest.images.map((im) => rasterise(`${folder}/${im.file}`, im.width, im.height, scale)),
  );

  // The ground is the only raster image of the lot: it is the painted band of
  // the field, two rows across the full width, which the scene repeats
  // vertically. It goes through the same rasteriser as the SVGs.
  const ground = manifest.ground
    ? {
      canvas: await rasterise(`${folder}/${manifest.ground.file}`, manifest.ground.width, manifest.ground.height, scale),
      width: Math.round(manifest.ground.width * scale),
      height: Math.round(manifest.ground.height * scale),
    }
    : null;

  /**
   * Applies a colour transformation to a canvas, once and only once.
   *
   * The cache is keyed on the image/transformation pair, and it counts: one
   * bomber image serves all four places and one flame image comes back in
   * several sequences. Without it we would pass over tens of thousands of pixels
   * again on every reuse, at start-up, for an identical result.
   */
  const transformed = new Map();
  function transform(index, key, operation) {
    const full = `${index}:${key}`;
    if (!transformed.has(full)) {
      const base = canvases[index];
      const canvas = document.createElement('canvas');
      canvas.width = base.width;
      canvas.height = base.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(base, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      operation(data.data);
      ctx.putImageData(data, 0, 0);
      transformed.set(full, canvas);
    }
    return transformed.get(full);
  }

  // The game's ten colours, read at extraction time from COLOR.PAL and the .RMP
  // files.
  const colours = manifest.playerColours ?? [];
  const roles = {};
  /**
   * Duration of one full turn of each sequence, in milliseconds.
   *
   * It is the rhythm Atomic Bomberman itself gave the animation, the sum of its
   * frames' durations. Without it a rate has to be invented, and an invented
   * rate does not hold from one sprite set to another: the game's bomb counts
   * eighteen frames where the one drawn in code counts three.
   */
  const cycles = {};
  for (const [name, frames] of Object.entries(manifest.roles)) {
    cycles[name] = frames.reduce((sum, f) => sum + f.duration, 0);
    const made = (canvas, f) => sprite(canvas, manifest.images[f.image], scale);
    if (PER_PLACE.test(name)) {
      roles[name] = lazySeries((place) =>
        frames.map((f) => made(transform(f.image, `place${place}`, (d) => recolour(d, colours[place % colours.length])), f)));
    } else {
      roles[name] = frames.map((f) => made(canvases[f.image], f));
    }
  }

  // The bomb WITHOUT recolouring, as it sleeps in the file: green, like the
  // bomber on the menu screen. The other series are tinted per place, and none
  // of them is green — it is the colour of before.
  if (manifest.roles.bomb) {
    roles.rawBomb = manifest.roles.bomb.map((frame) =>
      sprite(canvases[frame.image], manifest.images[frame.image], scale),
    );
  }

  return {
    tile: {
      width: Math.round(manifest.tile.width * scale),
      height: Math.round(manifest.tile.height * scale),
    },
    ground,
    roles,
    cycles,
  };
}
