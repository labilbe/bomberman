/**
 * Turning a raster image into SVG.
 *
 * The principle is not that of a curve tracer in the manner of potrace: we are
 * not trying to guess arcs in a photograph, but to render a sprite's flats
 * exactly. The outline therefore follows the edges of the pixels, to the half
 * pixel, and the result is faithful to the original — scaled up ten times, it is
 * the same drawing with crisp edges, not an interpolation.
 *
 * Two stages: reduce the palette (an Atomic Bomberman sprite carries up to 160
 * shades, most of them gradient), then trace one shape per remaining colour.
 */

/**
 * Palette reduction by median cut.
 *
 * We cut the colour box along its widest axis, at the pixels' median — not at
 * the middle of the box. The difference counts: on these sprites, the body's
 * half-shades occupy a small volume but a lot of pixels, and a cut at the
 * geometric middle gave them a single shade while the few highlight pixels got
 * four.
 */
export function reducePalette(rgba, count) {
  const pixels = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] !== 0) pixels.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  if (pixels.length === 0) return [];

  let boxes = [pixels];
  while (boxes.length < count) {
    // We always cut the widest box: it is the one carrying the error.
    let chosen = -1;
    let best = -1;
    boxes.forEach((box, k) => {
      if (box.length < 2) return;
      const spread = Math.max(...[0, 1, 2].map((c) => {
        let min = 255;
        let max = 0;
        for (const p of box) {
          if (p[c] < min) min = p[c];
          if (p[c] > max) max = p[c];
        }
        return max - min;
      }));
      if (spread > best) {
        best = spread;
        chosen = k;
      }
    });
    if (chosen === -1 || best === 0) break;

    const box = boxes[chosen];
    let axis = 0;
    let widest = -1;
    for (const c of [0, 1, 2]) {
      let min = 255;
      let max = 0;
      for (const p of box) {
        if (p[c] < min) min = p[c];
        if (p[c] > max) max = p[c];
      }
      if (max - min > widest) {
        widest = max - min;
        axis = c;
      }
    }
    box.sort((a, b) => a[axis] - b[axis]);
    const mid = box.length >> 1;
    boxes = [...boxes.slice(0, chosen), box.slice(0, mid), box.slice(mid), ...boxes.slice(chosen + 1)];
  }

  return boxes.filter((b) => b.length).map((box) => {
    const sum = [0, 0, 0];
    for (const p of box) {
      sum[0] += p[0];
      sum[1] += p[1];
      sum[2] += p[2];
    }
    return sum.map((s) => Math.round(s / box.length));
  });
}

/** Index of the nearest palette colour, by weighted distance. */
function nearest(palette, r, g, b) {
  let best = 0;
  let distance = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const [pr, pg, pb] = palette[i];
    // Perceptual weighting: the eye discriminates green far more finely than
    // blue, and a plain Euclidean distance melted a bomber's body greens into a
    // single shade.
    const d = 3 * (pr - r) ** 2 + 6 * (pg - g) ** 2 + (pb - b) ** 2;
    if (d < distance) {
      distance = d;
      best = i;
    }
  }
  return best;
}

/**
 * Traces the outline of a binary mask, as closed loops.
 *
 * We collect the edges between a filled pixel and an empty one, oriented so as
 * to keep the filled side on the left, then chain them end to end. The
 * orientation is not a detail: it yields the outer outlines in one direction and
 * the holes in the other, which lets the "nonzero" fill rule hollow the holes
 * out by itself. Without it, holes would have to be detected by hand.
 */
function outlines(mask, width, height) {
  const edges = new Map();
  const add = (ax, ay, bx, by) => {
    const key = ax * (height + 1) + ay;
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push([bx, by]);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      if (y === 0 || !mask[(y - 1) * width + x]) add(x, y, x + 1, y);
      if (x === width - 1 || !mask[y * width + x + 1]) add(x + 1, y, x + 1, y + 1);
      if (y === height - 1 || !mask[(y + 1) * width + x]) add(x + 1, y + 1, x, y + 1);
      if (x === 0 || !mask[y * width + x - 1]) add(x, y + 1, x, y);
    }
  }

  const loops = [];
  for (const [key, runs] of edges) {
    while (runs.length) {
      const start = [Math.floor(key / (height + 1)), key % (height + 1)];
      const loop = [start];
      let [x, y] = runs.pop();
      while (x !== start[0] || y !== start[1]) {
        loop.push([x, y]);
        const next = edges.get(x * (height + 1) + y);
        if (!next || !next.length) break;
        [x, y] = next.pop();
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

/** Removes aligned points: three collinear points are only worth two. */
function simplify(loop) {
  const output = [];
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[(i - 1 + loop.length) % loop.length];
    const b = loop[i];
    const c = loop[(i + 1) % loop.length];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cross !== 0) output.push(b);
  }
  return output.length >= 3 ? output : loop;
}

/**
 * Collects the exact colours present in the image, with no reduction at all.
 *
 * The game's sprites carry between one and two hundred shades, which are mostly
 * modelling gradients. Keeping them all makes the vectorisation FAITHFUL TO THE
 * PIXEL — the scaled-up SVG is exactly the original drawing — at the price of a
 * bigger file, since every half-shade adds its own shape.
 */
function exactPalette(rgba) {
  const seen = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    if (!seen.has(key)) seen.set(key, [rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  return [...seen.values()];
}

/**
 * Converts an RGBA image into SVG.
 *
 * `colours` caps the palette. At zero — or beyond the number of shades present —
 * no reduction happens and the tracing is faithful to the pixel. Reducing stays
 * useful when light files are wanted: most of a sprite's weight comes from the
 * half-shades, which scatter into small specks.
 */
export function vectorise(rgba, width, height, { colours = 0, title = '' } = {}) {
  const exact = exactPalette(rgba);
  const palette = colours > 0 && colours < exact.length ? reducePalette(rgba, colours) : exact;
  if (!palette.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;

  const indexes = new Int16Array(width * height).fill(-1);
  const cache = new Map();
  for (let i = 0; i < width * height; i += 1) {
    if (rgba[i * 4 + 3] === 0) continue;
    const key = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    let index = cache.get(key);
    if (index === undefined) {
      index = nearest(palette, rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
      cache.set(key, index);
    }
    indexes[i] = index;
  }

  const shapes = [];
  for (let c = 0; c < palette.length; c += 1) {
    const mask = new Uint8Array(width * height);
    let present = false;
    for (let i = 0; i < indexes.length; i += 1) {
      if (indexes[i] === c) {
        mask[i] = 1;
        present = true;
      }
    }
    if (!present) continue;

    const d = outlines(mask, width, height)
      .map(simplify)
      .map((b) => `M${b.map(([x, y]) => `${x} ${y}`).join('L')}Z`)
      .join('');
    const [r, g, b] = palette[c];
    const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    shapes.push(`<path fill="${hex}" d="${d}"/>`);
  }

  const name = title ? `<title>${title}</title>` : '';
  // Explicit `width`/`height` on top of the viewBox: loaded in an <img> to be
  // rasterised, an SVG that only has its viewBox takes the browser's default
  // size — 300 x 150 — and the sprite comes out distorted.
  // `shape-rendering="crispEdges"` keeps the browser from antialiasing edges
  // that sit exactly on the grid: without it, every flat gains a translucent
  // fringe and neighbouring sprites show a seam.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${name}${shapes.join('')}</svg>`;
}
