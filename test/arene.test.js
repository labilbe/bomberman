import test from 'node:test';
import assert from 'node:assert/strict';

import { genererArene, DEPARTS, estMurDur, tirerBonus } from '../src/engine/arene.js';
import { createRng } from '../src/engine/rng.js';
import { index } from '../src/engine/grille.js';
import { COLS, ROWS, VIDE, DUR, BRIQUE } from '../src/engine/constantes.js';
import { estCache, codeDe, TABLE_BONUS } from '../src/engine/bonus.js';

test('la meme graine rend exactement la meme arene', () => {
  const a = genererArene(createRng(12345));
  const b = genererArene(createRng(12345));
  assert.deepEqual([...a.tuiles], [...b.tuiles]);
  assert.deepEqual([...a.objets], [...b.objets]);
  assert.equal(a.rng.seed, b.rng.seed);
});

test('deux graines differentes rendent deux arenes differentes', () => {
  const a = genererArene(createRng(1));
  const b = genererArene(createRng(2));
  assert.notDeepEqual([...a.tuiles], [...b.tuiles]);
});

test('les bords et le damier sont des murs durs', () => {
  const { tuiles } = genererArene(createRng(99));
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (estMurDur(x, y)) assert.equal(tuiles[index(x, y)], DUR, `(${x},${y}) devrait etre dur`);
      else assert.notEqual(tuiles[index(x, y)], DUR, `(${x},${y}) ne devrait pas etre dur`);
    }
  }
});

test('chaque coin de depart est degage en L', () => {
  // Sans ce degagement un bomber nait enferme et perd avant d'avoir bouge.
  for (const graine of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { tuiles } = genererArene(createRng(graine));
    for (const depart of DEPARTS) {
      const versX = depart.x === 1 ? 1 : -1;
      const versY = depart.y === 1 ? 1 : -1;
      assert.equal(tuiles[index(depart.x, depart.y)], VIDE);
      assert.equal(tuiles[index(depart.x + versX, depart.y)], VIDE);
      assert.equal(tuiles[index(depart.x, depart.y + versY)], VIDE);
    }
  }
});

test('les quatre departs sont distincts et en diagonale deux a deux', () => {
  assert.equal(new Set(DEPARTS.map((d) => `${d.x},${d.y}`)).size, 4);
  // Les places 0 et 1 se font face : a deux joueurs on ne nait pas cote a cote.
  assert.equal(DEPARTS[0].x !== DEPARTS[1].x && DEPARTS[0].y !== DEPARTS[1].y, true);
});

test('les bonus ne sont semes que sous des briques, et en proportion raisonnable', () => {
  const { tuiles, objets } = genererArene(createRng(2024));
  let briques = 0;
  let caches = 0;
  for (let i = 0; i < tuiles.length; i += 1) {
    if (tuiles[i] === BRIQUE) briques += 1;
    if (objets[i] === 0) continue;
    caches += 1;
    assert.equal(estCache(objets[i]), true, 'aucun bonus ne doit etre visible au depart');
    assert.equal(tuiles[i], BRIQUE, 'un bonus cache doit etre sous une brique');
  }
  const part = caches / briques;
  assert.ok(part > 0.2 && part < 0.5, `proportion inattendue : ${part}`);
});

test('tirerBonus ne consomme qu un tirage et reste dans la table', () => {
  const codes = new Set(TABLE_BONUS.map(([code]) => code));
  let rng = createRng(555);
  const apres = [];
  for (let i = 0; i < 200; i += 1) {
    const choix = tirerBonus(rng);
    assert.equal(codes.has(choix.bonus), true);
    rng = choix.rng;
    apres.push(choix.bonus);
  }
  // Reproductible : rejoue depuis la meme graine, meme suite.
  let bis = createRng(555);
  for (const attendu of apres) {
    const choix = tirerBonus(bis);
    assert.equal(choix.bonus, attendu);
    bis = choix.rng;
  }
  // Tous les bonus de la table sortent au moins une fois sur 200 tirages.
  assert.equal(new Set(apres).size, TABLE_BONUS.length);
});

test('un bonus cache se decode vers un code valide', () => {
  const { objets } = genererArene(createRng(31337));
  const codes = new Set(TABLE_BONUS.map(([code]) => code));
  for (const valeur of objets) {
    if (valeur === 0) continue;
    assert.equal(codes.has(codeDe(valeur)), true);
  }
});
