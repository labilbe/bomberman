/**
 * Reading SOUNDLST.RES: the game's table of sounds.
 *
 * It is a text file, commented by its author, where every useful line reads
 * "identifier,name" — the name being that of a .RSS in the SOUND folder. The
 * identifiers are grouped by use, and the comments say which: 100-102 for
 * dropping a bomb, 200-219 for an explosion, 400-412 for a bonus picked up.
 *
 * Some lines are COMMENTED OUT and that has to be respected: the game's music
 * (1100 to 1110) and the title music are among them, and their files are in fact
 * absent from a normal installation — they were audio tracks on the CD.
 */

/**
 * @param {string} text contents of SOUNDLST.RES
 * @returns {Map<number, string>} identifier to file name, without extension
 */
export function readList(text) {
  const table = new Map();
  for (const raw of text.split(/\r?\n/)) {
    // A semicolon opens a comment, wherever it sits on the line.
    const line = raw.split(';')[0].trim();
    if (!line) continue;
    const [identifier, name] = line.split(',');
    const n = Number(identifier);
    if (!Number.isInteger(n) || !name) continue;
    table.set(n, name.trim());
  }
  return table;
}

/** The identifiers of a range, in order. */
export function range(table, first, last) {
  const output = [];
  for (let i = first; i <= last; i += 1) {
    if (table.has(i)) output.push(table.get(i));
  }
  return output;
}
