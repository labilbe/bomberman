import test from 'node:test';
import assert from 'node:assert/strict';

import { creerHorloge, avancer, RATTRAPAGE_MAX } from '../src/engine/horloge.js';
import { normaliser, entreesVides, ENTREE_VIDE } from '../src/engine/entrees.js';
import { PAS_MS } from '../src/engine/constantes.js';

test('le temps se convertit en pas entiers, sans en perdre', () => {
  let horloge = creerHorloge(0);
  let total = 0;
  // Une cadence d affichage qui ne tombe pas juste sur le pas : le reliquat doit
  // etre reporte, sinon la partie prend du retard a chaque image.
  for (let i = 1; i <= 60; i += 1) {
    const avance = avancer(horloge, i * 17);
    horloge = avance.horloge;
    total += avance.pas;
  }
  const attendu = Math.floor((60 * 17) / PAS_MS);
  assert.ok(Math.abs(total - attendu) <= 1, `${total} pas pour ${attendu} attendus`);
});

test('un onglet revenu d arriere-plan ne rejoue pas la partie entiere', () => {
  let horloge = creerHorloge(0);
  const avance = avancer(horloge, 30000);
  assert.equal(avance.pas, RATTRAPAGE_MAX);
  // Et le temps perdu est perdu : il ne revient pas a l image suivante.
  horloge = avance.horloge;
  assert.equal(avancer(horloge, 30000 + PAS_MS).pas, 1);
});

test('une horloge qui recule ne fait pas reculer la partie', () => {
  const horloge = creerHorloge(1000);
  assert.equal(avancer(horloge, 500).pas, 0);
  assert.equal(avancer(horloge, Number.NaN).pas, 0);
});

test('une entree venue du reseau est ramenee a quelque chose d utilisable', () => {
  assert.deepEqual(normaliser(null), { ...ENTREE_VIDE });
  assert.deepEqual(normaliser('nord'), { ...ENTREE_VIDE });
  assert.deepEqual(normaliser({ dir: 9 }), { dir: -1, poser: false, declencher: false });
  assert.deepEqual(normaliser({ dir: -4 }), { dir: -1, poser: false, declencher: false });
  assert.deepEqual(normaliser({ dir: '2' }), { dir: 2, poser: false, declencher: false });
  assert.deepEqual(normaliser({ dir: 1.5 }), { dir: -1, poser: false, declencher: false });
  assert.deepEqual(normaliser({ poser: 'oui' }), { dir: -1, poser: false, declencher: false });
  assert.deepEqual(normaliser({ dir: 0, poser: true, declencher: true }), {
    dir: 0,
    poser: true,
    declencher: true,
  });
});

test('l entree vide est gelee, pour que personne ne la modifie par surprise', () => {
  assert.equal(Object.isFrozen(ENTREE_VIDE), true);
  const vides = entreesVides(4);
  assert.equal(vides.length, 4);
  vides[0].poser = true;
  assert.equal(ENTREE_VIDE.poser, false);
});
