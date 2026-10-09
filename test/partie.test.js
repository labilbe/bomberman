import test from 'node:test';
import assert from 'node:assert/strict';

import {
  creerPartie,
  pasPartie,
  enPause,
  figee,
  PAUSE_MANCHE_PAS,
  DEPART_MANCHE_PAS,
} from '../src/engine/partie.js';
import { FIN_MANCHE_PAS } from '../src/engine/constantes.js';
import { index } from '../src/engine/grille.js';
import { VIDE, DUR } from '../src/engine/constantes.js';
import { estMurDur } from '../src/engine/arene.js';
import { COLS, ROWS } from '../src/engine/constantes.js';

/** Vide l'arene de la manche en cours, pour maitriser ce qui tue. */
function denuder(partie) {
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      partie.etat.tuiles[index(x, y)] = estMurDur(x, y) ? DUR : VIDE;
      partie.etat.objets[index(x, y)] = 0;
    }
  }
}

/**
 * Consomme l'arret du debut de manche.
 *
 * Toute manche commence figee pendant qu'on l'annonce. Les tests qui veulent
 * agir sur l'arene doivent donc d'abord laisser passer ce temps, sans quoi leurs
 * pas ne font rien du tout.
 */
function lancer(partie) {
  for (let i = 0; i < DEPART_MANCHE_PAS; i += 1) pasPartie(partie);
}

/** Tue une place et laisse la manche se conclure. */
function conclure(partie, place) {
  lancer(partie);
  partie.etat.joueurs[place].vivant = false;
  let transition = null;
  for (let i = 0; i < FIN_MANCHE_PAS + 5 && transition === null; i += 1) {
    transition = pasPartie(partie).transition;
  }
  return transition;
}

test('une manche gagnee donne un score et une pause', () => {
  const partie = creerPartie({ graine: 11, places: 2 });
  denuder(partie);
  const transition = conclure(partie, 1);
  assert.equal(transition.type, 'score');
  assert.deepEqual(transition.verdict, { gagnante: 0, nulle: false });
  assert.deepEqual(transition.scores, [1, 0]);
  assert.equal(enPause(partie), true);
});

test('la pause debouche sur une manche neuve, avec une autre arene', () => {
  const partie = creerPartie({ graine: 11, places: 2 });
  denuder(partie);
  const premiere = partie.etat.graine;
  conclure(partie, 1);

  let transition = null;
  for (let i = 0; i < PAUSE_MANCHE_PAS + 2 && transition === null; i += 1) {
    transition = pasPartie(partie).transition;
  }
  assert.equal(transition.type, 'round');
  assert.equal(transition.manche, 2);
  assert.notEqual(partie.etat.graine, premiere, 'une arene differente a chaque manche');
  assert.equal(partie.etat.joueurs.every((joueur) => joueur.vivant), true);
  assert.equal(partie.etat.joueurs[0].bombes, 1, 'la dotation repart de zero');
  assert.equal(enPause(partie), false);
});

test('la pause ne produit qu une seule transition de manche', () => {
  const partie = creerPartie({ graine: 3, places: 2 });
  denuder(partie);
  conclure(partie, 1);
  let rounds = 0;
  for (let i = 0; i < PAUSE_MANCHE_PAS * 2; i += 1) {
    const { transition } = pasPartie(partie);
    if (transition && transition.type === 'round') rounds += 1;
  }
  assert.equal(rounds, 1);
});

test('deux manches gagnees terminent le match', () => {
  const partie = creerPartie({ graine: 21, places: 2 });
  denuder(partie);

  conclure(partie, 1);
  for (let i = 0; i < PAUSE_MANCHE_PAS + 2; i += 1) pasPartie(partie);
  denuder(partie);
  const fin = conclure(partie, 1);

  assert.equal(fin.type, 'finished');
  assert.equal(fin.vainqueur, 0);
  assert.deepEqual(fin.scores, [2, 0]);
  assert.equal(partie.fini, true);

  // Une partie finie ne bouge plus, quoi qu on lui envoie.
  const apres = pasPartie(partie, [{ dir: 1, poser: true, declencher: false }]);
  assert.equal(apres.transition, null);
  assert.deepEqual(apres.evenements, []);
});

test('un format impose se retrouve dans la partie', () => {
  const partie = creerPartie({ graine: 1, places: 4, format: 7 });
  assert.equal(partie.format, 7);
  assert.equal(partie.match.aGagner, 4);
  assert.equal(partie.etat.joueurs.length, 4);
});

test('une manche commence figee, le temps de l annoncer', () => {
  // Le defaut corrige : l annonce « Manche N » s affichait par-dessus une partie
  // deja lancee, et les bots avaient le temps de poser avant que le joueur ait
  // fini de lire.
  const partie = creerPartie({ graine: 7, places: 2 });
  denuder(partie);
  const depart = { x: partie.etat.joueurs[0].x, y: partie.etat.joueurs[0].y };

  assert.equal(figee(partie), true, 'figee des la creation');
  for (let i = 0; i < DEPART_MANCHE_PAS; i += 1) {
    pasPartie(partie, [{ dir: 1, poser: true, declencher: false }]);
  }
  assert.deepEqual(
    { x: partie.etat.joueurs[0].x, y: partie.etat.joueurs[0].y },
    depart,
    'personne ne bouge pendant l annonce',
  );
  assert.equal(partie.etat.bombes.length, 0, 'et personne ne pose');
  assert.equal(partie.etat.pas, 0, 'le temps de l arene n a pas avance');

  assert.equal(figee(partie), false, 'puis la manche demarre');
  pasPartie(partie, [{ dir: 1, poser: false, declencher: false }]);
  assert.notEqual(partie.etat.joueurs[0].x, depart.x, 'et le joueur peut enfin bouger');
});

test('la manche suivante est figee elle aussi, et l annonce dit combien de temps', () => {
  const partie = creerPartie({ graine: 11, places: 2 });
  denuder(partie);
  conclure(partie, 1);

  let transition = null;
  for (let i = 0; i < PAUSE_MANCHE_PAS + 2 && transition === null; i += 1) {
    transition = pasPartie(partie).transition;
  }
  assert.equal(transition.type, 'round');
  // La page cale la duree de sa banniere sur ce champ plutot que sur une valeur
  // a elle : deux comptes a rebours separes finiraient par diverger.
  assert.equal(transition.attente, DEPART_MANCHE_PAS);
  assert.equal(figee(partie), true);
});
