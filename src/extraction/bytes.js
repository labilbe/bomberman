/**
 * Reading and writing bytes, without `Buffer`.
 *
 * Atomic Bomberman's formats are all little-endian, and the decoders used to
 * read them through `Buffer`'s methods — `readUInt16LE`, `toString`. Those only
 * exist in Node. But these decoders now have to run IN THE PAGE, on the files
 * the visitor brings from their own disk: they needed a base common to both
 * worlds.
 *
 * This module is that base, and it fits in twenty useful lines because a
 * `Buffer` IS a `Uint8Array`. The extraction scripts can therefore carry on
 * passing what `readFileSync` gives them, with no conversion and no copy, and
 * the browser passes what `File.arrayBuffer()` gives it.
 *
 * File names and chunk identifiers are LATIN-1, not UTF-8: these are bytes from
 * 1997, and a byte above 127 is one character there, never the start of a
 * multi-byte sequence.
 */

/**
 * A view over the same bytes, to read integers without copying.
 *
 * `byteOffset` and `byteLength` are compulsory: a sub-view obtained through
 * `subarray` shares its parent's buffer, and reading from zero would give the
 * bytes at the start of the file instead of those of the chunk.
 */
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Unsigned two-byte integer, little-endian. */
export const u16 = (bytes, position) => view(bytes).getUint16(position, true);

/** Unsigned four-byte integer, little-endian. */
export const u32 = (bytes, position) => view(bytes).getUint32(position, true);

/** Signed two-byte integer, little-endian. */
export const i16 = (bytes, position) => view(bytes).getInt16(position, true);

/**
 * Decodes a range as latin-1.
 *
 * We do not go through `TextDecoder`: it exists everywhere, but an instance of
 * it would have to be kept and it can do nothing more here. One byte is one
 * code point, that is the whole rule of this character set.
 */
export function latin1(bytes, from = 0, to = bytes.length) {
  let text = '';
  for (let i = from; i < to; i += 1) text += String.fromCharCode(bytes[i]);
  return text;
}

/** A zero-terminated string, the way the game writes its names. */
export function zeroString(bytes) {
  const zero = bytes.indexOf(0);
  return latin1(bytes, 0, zero === -1 ? bytes.length : zero);
}

/** Writes a two-byte integer, little-endian. */
export const writeU16 = (bytes, position, value) => view(bytes).setUint16(position, value, true);

/** Writes a four-byte integer, little-endian. */
export const writeU32 = (bytes, position, value) => view(bytes).setUint32(position, value, true);

/** Writes a latin-1 string, one byte per character. */
export function writeLatin1(bytes, position, text) {
  for (let i = 0; i < text.length; i += 1) bytes[position + i] = text.charCodeAt(i) & 0xff;
}

/** Puts several runs of bytes end to end. */
export function concat(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const output = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    output.set(chunk, position);
    position += chunk.length;
  }
  return output;
}
