/**
 * Tests du decodage des .ANI d'Atomic Bomberman.
 *
 * Les fichiers du jeu ne sont pas dans le depot — ils appartiennent a Interplay
 * — donc rien ici ne lit le disque. Chaque test fabrique un conteneur CHFILE en
 * memoire, ce qui a l'avantage de rendre explicite ce que le format exige :
 * l'en-tete de morceau sur DIX octets, la taille compressee qui compte son
 * propre sous-en-tete, le decalage de un sur les longueurs du RLE.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { lireEntete, lireMorceaux, charge, chaine } from '../src/extraction/chfile.js';
import { lireEnteteImage, developper, rgb555, decoder } from '../src/extraction/cimg.js';
import { vectoriser, reduirePalette } from '../src/extraction/vecteur.js';

/** Fabrique un morceau : id(4) + taille(4) + drapeaux(2) + charge. */
function morceau(id, charge, drapeaux = 1) {
  const tete = Buffer.alloc(10);
  tete.write(id.padEnd(4), 0, 'latin1');
  tete.writeUInt32LE(charge.length, 4);
  tete.writeUInt16LE(drapeaux, 8);
  return Buffer.concat([tete, charge]);
}

function fichier(morceaux) {
  const corps = Buffer.concat(morceaux);
  const tete = Buffer.alloc(16);
  tete.write('CHFILEANI ', 0, 'latin1');
  tete.writeUInt32LE(corps.length, 10);
  return Buffer.concat([tete, corps]);
}

/** Un CIMG 16 bits : en-tete de 36 octets, puis le flux RLE. */
function cimg(largeur, hauteur, cle, flux) {
  const octets = Buffer.alloc(36 + flux.length);
  octets.writeUInt16LE(4, 0);
  octets.writeUInt32LE(24, 4);
  octets.writeUInt16LE(largeur, 12);
  octets.writeUInt16LE(hauteur, 14);
  octets.writeUInt16LE(largeur >> 1, 16);
  octets.writeUInt16LE(hauteur - 1, 18);
  octets.writeUInt16LE(cle, 20);
  octets.writeUInt32LE(flux.length + 12, 28);
  octets.writeUInt32LE(largeur * hauteur * 2, 32);
  flux.copy(octets, 36);
  return octets;
}

test('l en-tete de morceau fait dix octets, pas huit', () => {
  // Le piege du format : lu comme du RIFF, le second morceau tombe deux octets
  // trop tot. Ce test echoue bruyamment si quelqu un « simplifie » en RIFF.
  const f = fichier([morceau('HEAD', Buffer.alloc(6)), morceau('FNAM', Buffer.from('ok\0', 'latin1'))]);
  assert.equal(lireEntete(f).sousType, 'ANI');
  const noeuds = lireMorceaux(f);
  assert.deepEqual(noeuds.map((n) => n.id), ['HEAD', 'FNAM']);
  assert.equal(chaine(charge(f, noeuds[1])), 'ok');
});

test('les longueurs du RLE sont decalees de un', () => {
  // 0x81 = repetition de deux pixels ; 0x01 = deux litteraux ; 0xff = fin.
  const flux = Buffer.from([0x81, 0x11, 0x11, 0x01, 0x22, 0x22, 0x33, 0x33, 0xff]);
  const { pixels, remplis } = developper(flux, 4, 1, 16, 0);
  assert.equal(remplis, 4);
  assert.deepEqual([...pixels], [0x1111, 0x1111, 0x2222, 0x3333]);
});

test('une repetition traverse la fin de ligne sans rien signaler', () => {
  // Il n y a pas de marque de fin de ligne dans le format : une seule commande
  // peut remplir plusieurs lignes, ce qu un decodeur ecrit en (x, y) raterait.
  const { pixels } = developper(Buffer.from([0x85, 0xaa, 0xaa, 0xff]), 2, 3, 16, 0);
  assert.equal(pixels.length, 6);
  assert.deepEqual([...pixels], Array(6).fill(0xaaaa));
});

test('la taille compressee compte son propre sous-en-tete', () => {
  const flux = Buffer.from([0x83, 0x00, 0x00, 0xff]);
  const entete = lireEnteteImage(cimg(2, 2, 0, flux));
  assert.equal(entete.bits, 16);
  assert.equal(entete.donnees, 36);
  assert.equal(entete.compresse - 12, flux.length);
});

test('les gris du jeu restent gris en RGB555', () => {
  // 0x1084 et 0x6739 sont la meme valeur repetee sur trois champs de cinq bits.
  // Lus en 565 ils virent au vert — c est la preuve que le format est du 555.
  for (const mot of [0x1084, 0x6739, 0x4210]) {
    const [r, v, b] = rgb555(mot);
    assert.equal(r, v);
    assert.equal(v, b);
  }
  assert.deepEqual(rgb555(0x7fff), [255, 255, 255]);
});

test('la couleur-cle devient transparente', () => {
  const flux = Buffer.from([0x81, 0x10, 0x42, 0x81, 0xff, 0x7f, 0xff]);
  const img = decoder(cimg(2, 2, 0x4210, flux));
  assert.deepEqual([...img.rgba.slice(0, 8)], [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...img.rgba.slice(8, 16)], [255, 255, 255, 255, 255, 255, 255, 255]);
});

test('le vectoriseur rend un contour ferme par couleur', () => {
  // Un carre plein de 2 x 2 : une seule forme, quatre coins, refermee.
  const rgba = new Uint8ClampedArray(2 * 2 * 4).fill(255);
  const svg = vectoriser(rgba, 2, 2, { couleurs: 4 });
  assert.equal(svg.split('<path').length - 1, 1);
  assert.match(svg, /d="M[^"]*Z"/);
  assert.equal((svg.match(/Z/g) ?? []).length, 1);
});

test('par defaut le vectoriseur garde les couleurs exactes', () => {
  // Trois teintes voisines : reduites, elles fusionneraient en une seule et le
  // degrade disparaitrait. Sans reduction, chacune garde sa forme et sa valeur.
  const rgba = new Uint8ClampedArray(3 * 1 * 4);
  rgba.set([10, 120, 10, 255], 0);
  rgba.set([12, 124, 12, 255], 4);
  rgba.set([14, 128, 14, 255], 8);
  const svg = vectoriser(rgba, 3, 1);
  assert.equal(svg.split('<path').length - 1, 3);
  for (const hex of ['#0a780a', '#0c7c0c', '#0e800e']) assert.match(svg, new RegExp(hex));
});

test('la palette reduite ignore les pixels transparents', () => {
  const rgba = new Uint8ClampedArray(8);
  rgba.set([255, 0, 0, 255], 0); // un pixel rouge opaque
  rgba.set([0, 255, 0, 0], 4); // un pixel vert transparent
  assert.deepEqual(reduirePalette(rgba, 4), [[255, 0, 0]]);
});
