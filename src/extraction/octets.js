/**
 * Lecture et ecriture d'octets, sans `Buffer`.
 *
 * Les formats d'Atomic Bomberman sont tous en petit-boutiste, et les decodeurs
 * les lisaient par les methodes de `Buffer` — `readUInt16LE`, `toString`. Elles
 * n'existent que dans Node. Or ces decodeurs doivent desormais tourner DANS LA
 * PAGE, sur les fichiers que le visiteur apporte depuis son propre disque : il
 * leur fallait un socle commun aux deux mondes.
 *
 * Ce module est ce socle, et il tient en une vingtaine de lignes utiles parce
 * qu'un `Buffer` EST un `Uint8Array`. Les scripts d'extraction peuvent donc
 * continuer a passer ce que `readFileSync` leur rend, sans conversion ni copie,
 * et le navigateur passe ce que `File.arrayBuffer()` lui donne.
 *
 * Les noms de fichiers et les identifiants de morceaux sont en LATIN-1, pas en
 * UTF-8 : ce sont des octets de 1997, et un octet au-dessus de 127 y vaut un
 * caractere, jamais le debut d'une sequence multi-octets.
 */

/**
 * Une vue sur les memes octets, pour lire des entiers sans recopier.
 *
 * `byteOffset` et `byteLength` sont obligatoires : une sous-vue obtenue par
 * `subarray` partage le tampon de son parent, et lire a partir de zero
 * donnerait les octets du debut du fichier au lieu de ceux du morceau.
 */
const vue = (octets) => new DataView(octets.buffer, octets.byteOffset, octets.byteLength);

/** Entier non signe sur deux octets, petit-boutiste. */
export const u16 = (octets, position) => vue(octets).getUint16(position, true);

/** Entier non signe sur quatre octets, petit-boutiste. */
export const u32 = (octets, position) => vue(octets).getUint32(position, true);

/** Entier signe sur deux octets, petit-boutiste. */
export const i16 = (octets, position) => vue(octets).getInt16(position, true);

/**
 * Decode une plage en latin-1.
 *
 * On ne passe pas par `TextDecoder` : il existe partout, mais il faudrait en
 * garder une instance et il ne sait rien faire de plus ici. Un octet vaut un
 * point de code, c'est toute la regle de ce jeu de caracteres.
 */
export function latin1(octets, debut = 0, fin = octets.length) {
  let texte = '';
  for (let i = debut; i < fin; i += 1) texte += String.fromCharCode(octets[i]);
  return texte;
}

/** Une chaine terminee par zero, comme le jeu ecrit ses noms. */
export function chaineZero(octets) {
  const zero = octets.indexOf(0);
  return latin1(octets, 0, zero === -1 ? octets.length : zero);
}

/** Ecrit un entier de deux octets, petit-boutiste. */
export const ecrireU16 = (octets, position, valeur) => vue(octets).setUint16(position, valeur, true);

/** Ecrit un entier de quatre octets, petit-boutiste. */
export const ecrireU32 = (octets, position, valeur) => vue(octets).setUint32(position, valeur, true);

/** Ecrit une chaine latin-1, un octet par caractere. */
export function ecrireLatin1(octets, position, texte) {
  for (let i = 0; i < texte.length; i += 1) octets[position + i] = texte.charCodeAt(i) & 0xff;
}

/** Met bout a bout plusieurs suites d'octets. */
export function concat(morceaux) {
  const total = morceaux.reduce((somme, m) => somme + m.length, 0);
  const sortie = new Uint8Array(total);
  let position = 0;
  for (const morceau of morceaux) {
    sortie.set(morceau, position);
    position += morceau.length;
  }
  return sortie;
}
