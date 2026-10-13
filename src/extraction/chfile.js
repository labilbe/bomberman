/**
 * Reader for the CHFILE container, the format of Atomic Bomberman's .ANI files.
 *
 * It is not RIFF, despite the resemblance. The file header is sixteen bytes —
 * "CHFILE" then a four-character subtype ("ANI  "), then the useful size — and
 * every chunk carries ten bytes of header: a four-byte identifier, a four-byte
 * size, and two bytes of flags. It is that "ten" that trips you up: read as RIFF
 * (eight bytes, even padding), the second chunk falls two bytes too early and
 * the whole tree goes askew.
 *
 * Chunks nest with the same convention — a FRAM contains HEAD, FNAM, CIMG — and
 * there is no padding at all.
 */

import { u16, u32, latin1, zeroString } from './bytes.js';

/** Size of a chunk's header: id(4) + size(4) + flags(2). */
export const CHUNK_HEADER = 10;

/** Size of the file header. */
export const FILE_HEADER = 16;

/**
 * Identifiers that contain chunks themselves.
 *
 * We do not guess the nesting by sniffing the first bytes: a compressed CIMG can
 * begin with anything, and sniffing would take it for a container. The explicit
 * list is the only safe way.
 */
const CONTAINERS = new Set(['FRAM', 'SEQ ']);

function id(bytes, position) {
  return latin1(bytes, position, position + 4);
}

/** Checks the header and returns the subtype. Throws if it is not a CHFILE. */
export function readHeader(bytes) {
  if (bytes.length < FILE_HEADER || latin1(bytes, 0, 6) !== 'CHFILE') {
    throw new Error('ce fichier ne commence pas par CHFILE');
  }
  return {
    subtype: latin1(bytes, 6, 10).trim(),
    size: u32(bytes, 10),
  };
}

/**
 * Walks a run of chunks and returns an array of nodes.
 *
 * Each node carries `id`, `start` (absolute position of the payload), `size` and
 * `flags`, plus `children` for a container. We keep positions in the original
 * buffer instead of slicing: the images are several kilobytes each and copying at
 * every level would be pure waste.
 */
export function readChunks(bytes, start = FILE_HEADER, end = bytes.length) {
  const nodes = [];
  let position = start;

  while (position + CHUNK_HEADER <= end) {
    const identifier = id(bytes, position);
    const size = u32(bytes, position + 4);
    const flags = u16(bytes, position + 8);
    const payloadAt = position + CHUNK_HEADER;

    // A size that goes beyond the bounds means the tree is out of step. We stop
    // and say so rather than read at random.
    if (size > end - payloadAt) {
      nodes.push({ id: identifier, start: payloadAt, size: end - payloadAt, flags, truncated: true });
      break;
    }

    const node = { id: identifier, start: payloadAt, size, flags };
    if (CONTAINERS.has(identifier)) {
      node.children = readChunks(bytes, payloadAt, payloadAt + size);
    }
    nodes.push(node);
    position = payloadAt + size;
  }

  return nodes;
}

/** Returns a node's payload, without copying. */
export function payload(bytes, node) {
  return bytes.subarray(node.start, node.start + node.size);
}

/** Depth-first walk: "every CIMG in the file", in one loop. */
export function* walk(nodes, path = []) {
  for (const node of nodes) {
    yield { node, path };
    if (node.children) yield* walk(node.children, [...path, node.id]);
  }
}

/** A zero-terminated string, the way the game writes its names. */
export function string(bytes) {
  return zeroString(bytes);
}
