/**
 * Tests du PCX et du RSS, les deux formats qui n'en avaient aucun.
 *
 * Ils en ont besoin maintenant pour une raison precise : leur lecture d'octets
 * vient d'etre reecrite pour tourner aussi dans un navigateur, ou `Buffer`
 * n'existe pas. Une conversion de ce genre ne casse pas bruyamment — elle rend
 * une image decalee d'un octet ou un son au double de sa hauteur — et les
 * fichiers du jeu ne sont pas dans le depot pour s'en apercevoir.
 *
 * Tout est donc fabrique en memoire, ce qui a l'avantage de rendre explicite ce
 * que chaque format exige : la palette collee a la FIN du PCX derriere son
 * marqueur, le remplissage de fin de ligne a jeter, et le fait qu'un .RSS n'a
 * aucun en-tete du tout.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { decoderPcx } from '../src/extraction/pcx.js';
import { lireRss, enMono, versWav, FREQUENCE } from '../src/extraction/rss.js';
import { u16, u32, latin1 } from '../src/extraction/octets.js';

const ENTETE_PCX = 128;

/**
 * Fabrique un PCX 8 bits non compresse.
 *
 * `lignes` donne les indices de palette, une entree par pixel et par ligne.
 * `octetsParLigne` peut depasser la largeur : c'est le cas du format, qui
 * arrondit a un nombre pair, et le decodeur doit jeter ce remplissage.
 */
function pcx(lignes, palette, { octetsParLigne = lignes[0].length } = {}) {
  const hauteur = lignes.length;
  const largeur = lignes[0].length;

  const entete = new Uint8Array(ENTETE_PCX);
  const vue = new DataView(entete.buffer);
  entete[0] = 0x0a; // signature ZSoft
  entete[1] = 5; // version
  entete[2] = 1; // RLE
  entete[3] = 8; // bits par plan
  vue.setUint16(4, 0, true); // xMin
  vue.setUint16(6, 0, true); // yMin
  vue.setUint16(8, largeur - 1, true);
  vue.setUint16(10, hauteur - 1, true);
  entete[65] = 1; // un seul plan
  vue.setUint16(66, octetsParLigne, true);

  // Chaque octet est ecrit tel quel : un indice inferieur a 0xc0 n'est jamais
  // pris pour une repetition, ce qui suffit a eprouver le reste du decodeur.
  const corps = [];
  for (const ligne of lignes) {
    for (let x = 0; x < octetsParLigne; x += 1) corps.push(ligne[x] ?? 0);
  }

  return Uint8Array.from([...entete, ...corps, 0x0c, ...palette]);
}

/** Une palette de 256 entrees ou l'indice i vaut (i, i*2, i*3). */
function paletteDegrade() {
  const palette = new Uint8Array(768);
  for (let i = 0; i < 256; i += 1) {
    palette[i * 3] = i;
    palette[i * 3 + 1] = (i * 2) & 0xff;
    palette[i * 3 + 2] = (i * 3) & 0xff;
  }
  return palette;
}

test('le PCX rend ses pixels dans les couleurs de sa palette', () => {
  const image = decoderPcx(pcx([[1, 2], [3, 4]], paletteDegrade()));

  assert.equal(image.largeur, 2);
  assert.equal(image.hauteur, 2);
  // Premier pixel : indice 1, donc (1, 2, 3), opaque.
  assert.deepEqual([...image.rgba.slice(0, 4)], [1, 2, 3, 255]);
  // Dernier pixel : indice 4, donc (4, 8, 12).
  assert.deepEqual([...image.rgba.slice(12, 16)], [4, 8, 12, 255]);
});

test('le remplissage de fin de ligne est jete', () => {
  // Deux pixels utiles par ligne, mais quatre octets stockes : sans le rejet du
  // remplissage, la seconde ligne commencerait deux pixels trop tot et toute
  // l image glisserait en biais.
  const image = decoderPcx(pcx([[10, 20], [30, 40]], paletteDegrade(), { octetsParLigne: 4 }));

  assert.deepEqual([...image.rgba.slice(0, 4)], [10, 20, 30, 255]);
  assert.deepEqual([...image.rgba.slice(8, 12)], [30, 60, 90, 255], 'la ligne 2 commence a 30');
});

test('le RLE du PCX developpe ses series', () => {
  const palette = paletteDegrade();
  const entete = new Uint8Array(ENTETE_PCX);
  const vue = new DataView(entete.buffer);
  entete[0] = 0x0a;
  entete[3] = 8;
  entete[65] = 1;
  vue.setUint16(8, 3, true); // largeur 4
  vue.setUint16(10, 0, true); // hauteur 1
  vue.setUint16(66, 4, true);

  // 0xC4 = repeter quatre fois, puis la valeur.
  const octets = Uint8Array.from([...entete, 0xc4, 7, 0x0c, ...palette]);
  const image = decoderPcx(octets);

  assert.equal(image.largeur, 4);
  for (let x = 0; x < 4; x += 1) {
    assert.deepEqual([...image.rgba.slice(x * 4, x * 4 + 4)], [7, 14, 21, 255]);
  }
});

test('un fichier qui n est pas un PCX est refuse, pas devine', () => {
  assert.throws(() => decoderPcx(new Uint8Array(200)), /n est pas un PCX/);
});

test('le RSS se lit sans en-tete, en 16 bits signes petit-boutiste', () => {
  // Deux trames stereo : (1000, -1000) puis (32767, -32768).
  const octets = new Uint8Array(8);
  const vue = new DataView(octets.buffer);
  vue.setInt16(0, 1000, true);
  vue.setInt16(2, -1000, true);
  vue.setInt16(4, 32767, true);
  vue.setInt16(6, -32768, true);

  assert.deepEqual([...lireRss(octets)], [1000, -1000, 32767, -32768]);
});

test('un RSS tronque en pleine trame perd la trame, pas le reste', () => {
  const octets = new Uint8Array(10); // deux trames completes + deux octets
  new DataView(octets.buffer).setInt16(0, 42, true);
  assert.equal(lireRss(octets).length, 4);
});

test('le repli en mono moyenne les deux canaux', () => {
  const stereo = Int16Array.from([100, 300, -200, -400]);
  assert.deepEqual([...enMono(stereo)], [200, -300]);
});

test('le WAV porte un en-tete RIFF correct et ses echantillons', () => {
  const echantillons = Int16Array.from([1000, -1000, 500, -500]);
  const wav = versWav(echantillons, { canaux: 1, frequence: FREQUENCE });

  assert.equal(latin1(wav, 0, 4), 'RIFF');
  assert.equal(u32(wav, 4), wav.length - 8, 'la taille annoncee exclut ses propres huit octets');
  assert.equal(latin1(wav, 8, 12), 'WAVE');
  assert.equal(latin1(wav, 12, 16), 'fmt ');
  assert.equal(u32(wav, 16), 16, 'bloc de format de seize octets');
  assert.equal(u16(wav, 20), 1, 'PCM entier');
  assert.equal(u16(wav, 22), 1, 'un canal');
  assert.equal(u32(wav, 24), FREQUENCE);
  assert.equal(u32(wav, 28), FREQUENCE * 2, 'octets par seconde');
  assert.equal(u16(wav, 32), 2, 'octets par trame');
  assert.equal(u16(wav, 34), 16, 'bits par echantillon');
  assert.equal(latin1(wav, 36, 40), 'data');
  assert.equal(u32(wav, 40), echantillons.length * 2);

  // Et les echantillons eux-memes, intacts.
  const vue = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  for (let i = 0; i < echantillons.length; i += 1) {
    assert.equal(vue.getInt16(44 + i * 2, true), echantillons[i]);
  }
});

test('le WAV stereo annonce bien deux canaux', () => {
  const wav = versWav(Int16Array.from([1, 2, 3, 4]), { canaux: 2 });
  assert.equal(u16(wav, 22), 2);
  assert.equal(u16(wav, 32), 4, 'quatre octets par trame stereo');
});
