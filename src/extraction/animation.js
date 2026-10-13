/**
 * Reading a whole .ANI file: the images, and the sequences that animate them.
 *
 * A file contains a run of FRAMs — each one an image and its original file name
 * — then named SEQs ("walkbomb south", "standbomb north") which point at those
 * images in order, with a duration. It is that second part that is worth
 * reading: without it you have 2327 images in a heap, and you have to guess by
 * eye which ones make up a walk cycle.
 */

import { u16, i16 } from './bytes.js';

import { readChunks, payload, string, readHeader } from './chfile.js';
import { decode } from './cimg.js';

/**
 * Duration meaning "the same as the previous frame".
 *
 * The format does not repeat an unchanged duration: only a sequence's first
 * frame carries its own, the following ones are 0xFFFF. Read at face value, that
 * 65535 passed for a duration of 65 seconds — the bomb added up eighteen minutes
 * of cycle and therefore stayed frozen on its first frame for the whole of its
 * fuse.
 */
const INHERITED_DURATION = 0xffff;

/** A sequence frame lives in a STAT: a duration, then a reference to a FRAM. */
function readFrame(bytes, stat, previousDuration) {
  const children = readChunks(bytes, stat.start, stat.start + stat.size);
  const head = children.find((n) => n.id === 'HEAD');
  const reference = children.find((n) => n.id === 'FRAM');
  if (!reference) return null;
  const r = payload(bytes, reference);
  const raw = head ? u16(payload(bytes, head), 0) : 0;
  return {
    image: u16(r, 2),
    duration: raw === INHERITED_DURATION ? previousDuration : raw,
    // Per-frame offsets: the game moves the sprite without moving its anchor
    // point, and that is what gives the waddle of the walk.
    dx: i16(r, 4),
    dy: i16(r, 6),
  };
}

/** Opens an .ANI and returns its decoded images and its named sequences. */
export function readAnimation(bytes) {
  readHeader(bytes);
  const root = readChunks(bytes);

  const images = root
    .filter((n) => n.id === 'FRAM')
    .map((fram) => {
      const name = fram.children.find((n) => n.id === 'FNAM');
      const cimg = fram.children.find((n) => n.id === 'CIMG');
      return { name: name ? string(payload(bytes, name)) : '', ...decode(payload(bytes, cimg)) };
    });

  const sequences = root
    .filter((n) => n.id === 'SEQ ')
    .map((seq) => {
      // The duration propagates from frame to frame: we carry it along the
      // sequence.
      let duration = 0;
      const frames = [];
      for (const stat of seq.children.filter((n) => n.id === 'STAT')) {
        const read = readFrame(bytes, stat, duration);
        if (!read) continue;
        duration = read.duration;
        frames.push(read);
      }
      return {
        name: string(payload(bytes, seq.children.find((n) => n.id === 'HEAD'))),
        frames,
      };
    });

  return { images, sequences };
}
