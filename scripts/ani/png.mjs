/**
 * Ecriture de PNG, sans dependance.
 *
 * Node apporte deja `zlib`, et un PNG RGBA n'est qu'une suite de morceaux
 * longueur/type/donnees/CRC. Ajouter `pngjs` au projet pour ca ferait entrer un
 * `node_modules` dans un depot qui n'en a aucun — c'est tout l'interet de cette
 * cinquantaine de lignes.
 */

import { deflateSync } from 'node:zlib';

/** Table CRC-32, calculee une fois : la refaire par appel coutait 10 % du temps. */
const TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(octets) {
  let c = -1;
  for (let i = 0; i < octets.length; i += 1) c = TABLE[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function morceau(type, donnees) {
  const entete = Buffer.alloc(8);
  entete.writeUInt32BE(donnees.length, 0);
  entete.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([entete.subarray(4), donnees])), 0);
  return Buffer.concat([entete, donnees, crc]);
}

/**
 * Encode un tampon RGBA en PNG.
 *
 * Le filtre 0 (aucun) suffit : les sprites sont de petits aplats et un filtre
 * par difference ne gagnait que quelques pour cent, pour du code en plus.
 */
export function encoderPng(rgba, largeur, hauteur) {
  const brut = Buffer.alloc(hauteur * (1 + largeur * 4));
  for (let y = 0; y < hauteur; y += 1) {
    const ligne = y * (1 + largeur * 4);
    brut[ligne] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * largeur * 4, largeur * 4).copy(brut, ligne + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; // 8 bits par composante
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau('IHDR', ihdr),
    morceau('IDAT', deflateSync(brut, { level: 9 })),
    morceau('IEND', Buffer.alloc(0)),
  ]);
}
