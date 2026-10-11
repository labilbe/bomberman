/**
 * La fusion est une fonction pure : elle ne connait ni clavier ni manette, et
 * c'est ce qui permet de verifier la regle elle-meme plutot que son cablage.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fusionner } from '../src/input/fusion.js';
import { HAUT, BAS, DROITE } from '../src/engine/constantes.js';

const vide = { dir: -1, poser: false, declencher: false };

test('une seule source active donne sa direction', () => {
  assert.equal(fusionner(vide, { ...vide, dir: DROITE }).dir, DROITE);
  assert.equal(fusionner({ ...vide, dir: HAUT }, vide).dir, HAUT);
});

test('la premiere source qui parle emporte la direction', () => {
  const resultat = fusionner({ ...vide, dir: HAUT }, { ...vide, dir: BAS });
  assert.equal(resultat.dir, HAUT);
});

test('les impulsions des deux sources s additionnent', () => {
  // Elles sont deja consommees chez leur source au moment ou on les lit : les
  // perdre ici perdrait vraiment une bombe.
  const resultat = fusionner({ ...vide, poser: true }, { ...vide, declencher: true });
  assert.equal(resultat.poser, true);
  assert.equal(resultat.declencher, true);
});

test('une impulsion de la source qui perd la direction est gardee', () => {
  const resultat = fusionner({ ...vide, dir: HAUT }, { ...vide, dir: BAS, poser: true });
  assert.equal(resultat.dir, HAUT);
  assert.equal(resultat.poser, true);
});

test('deux sources au repos donnent une intention vide', () => {
  assert.deepEqual(fusionner(vide, vide), vide);
});

test('aucune source donne une intention vide', () => {
  assert.deepEqual(fusionner(), vide);
});

test('une source absente ne fait pas lever', () => {
  assert.deepEqual(fusionner(null, undefined, { ...vide, dir: BAS }), { ...vide, dir: BAS });
});

test('seuls true et une direction valide passent', () => {
  // Les intentions partent sur le reseau : on ne laisse pas passer un « poser »
  // qui vaudrait 1 ou une chaine.
  const resultat = fusionner({ dir: undefined, poser: 1, declencher: 'oui' });
  assert.deepEqual(resultat, vide);
});
