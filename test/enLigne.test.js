/**
 * Tests de la regle qui tient la grille du client a jour.
 *
 * Le relais ne diffuse pas la grille trente fois par seconde : il n'envoie que
 * ce qui change, et le client applique. Cette moitie-la manquait, et le defaut
 * ne se voyait que sur un detail — un bonus ramasse restait dessine au sol pour
 * toujours, alors que le joueur l'avait bien empoche. La regle est donc isolee
 * et pure, pour etre verifiee sans ouvrir de WebSocket.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { suivreGrille } from '../src/net/enLigne.js';
import { index } from '../src/engine/grille.js';
import { COLS, ROWS, VIDE, BRIQUE } from '../src/engine/constantes.js';
import { CODES_BONUS } from '../src/engine/bonus.js';

/** Une grille de client, telle que `poserGrille` la pose. */
function grille() {
  return {
    tuiles: new Uint8Array(COLS * ROWS),
    objets: new Uint8Array(COLS * ROWS),
  };
}

test('un bonus ramasse disparait du sol', () => {
  // Le bug rapporte : on ramassait bien — le compteur montait — mais le bonus
  // restait dessine, parce que rien ne l effacait de la grille du client.
  const etat = grille();
  etat.objets[index(5, 3)] = CODES_BONUS.FLAMME;

  suivreGrille(etat, [['pick', 5, 3, 0, 'flame']]);
  assert.equal(etat.objets[index(5, 3)], 0);
});

test('un bonus revele apparait au sol', () => {
  const etat = grille();
  suivreGrille(etat, [['item', 7, 4, 'kick']]);
  assert.equal(etat.objets[index(7, 4)], CODES_BONUS.KICK);
});

test('un bonus brule disparait', () => {
  const etat = grille();
  etat.objets[index(2, 2)] = CODES_BONUS.BOMBE;
  suivreGrille(etat, [['itemgone', 2, 2]]);
  assert.equal(etat.objets[index(2, 2)], 0);
});

test('une brique detruite vide sa case et compte pour la version', () => {
  const etat = grille();
  etat.tuiles[index(4, 4)] = BRIQUE;

  const ecritures = suivreGrille(etat, [['brick', 4, 4]]);
  assert.equal(etat.tuiles[index(4, 4)], VIDE);
  // Le relais compte une version par ecriture de tuile : sans ce report, chaque
  // brique cassee declencherait une resynchronisation de la grille entiere.
  assert.equal(ecritures, 1);
});

test('les evenements qui ne touchent pas la grille ne comptent pas', () => {
  const etat = grille();
  const ecritures = suivreGrille(etat, [
    ['bomb', 1, 1, 0],
    ['boom', 3, 1, 1, 2, 2, 2, 2],
    ['death', 0, 0],
  ]);
  assert.equal(ecritures, 0);
});

test('un pas entier s applique dans l ordre', () => {
  // L explosion decouvre un bonus, et le meme pas peut en bruler un autre.
  const etat = grille();
  etat.tuiles[index(5, 3)] = BRIQUE;
  etat.objets[index(1, 1)] = CODES_BONUS.VITESSE;

  const ecritures = suivreGrille(etat, [
    ['brick', 5, 3],
    ['itemgone', 1, 1],
    ['item', 5, 3, 'trigger'],
  ]);

  assert.equal(etat.tuiles[index(5, 3)], VIDE);
  assert.equal(etat.objets[index(5, 3)], CODES_BONUS.DETONATEUR);
  assert.equal(etat.objets[index(1, 1)], 0);
  assert.equal(ecritures, 1);
});

test('une case hors de l arene est ignoree, pas ecrite au hasard', () => {
  // Les evenements viennent du reseau : une coordonnee aberrante ne doit pas
  // ecrire ailleurs dans le tableau.
  const etat = grille();
  const copie = Uint8Array.from(etat.objets);
  suivreGrille(etat, [['pick', 99, 99, 0, 'bomb'], ['item', -4, 2, 'bomb']]);
  assert.deepEqual(etat.objets, copie);
});

test('un nom de bonus inconnu vide la case plutot que d inventer', () => {
  const etat = grille();
  etat.objets[index(6, 6)] = CODES_BONUS.KICK;
  suivreGrille(etat, [['item', 6, 6, 'parachute']]);
  assert.equal(etat.objets[index(6, 6)], 0);
});
