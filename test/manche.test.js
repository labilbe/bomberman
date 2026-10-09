import test from 'node:test';
import assert from 'node:assert/strict';

import {
  creerMatch,
  verdictManche,
  marquer,
  matchTermine,
  vainqueur,
  classement,
  graineDeManche,
  FORMATS,
  MANCHES_MAX,
} from '../src/engine/manche.js';
import { pas, avancerDe } from '../src/engine/pas.js';
import { FIN_MANCHE_PAS } from '../src/engine/constantes.js';
import { areneNue, placer, entree, evenements } from './aide.js';

test('un format inconnu retombe sur le premier', () => {
  assert.equal(creerMatch({ places: 2, total: 4 }).total, FORMATS[0]);
  assert.equal(creerMatch({ places: 2, total: 5 }).total, 5);
  assert.equal(creerMatch({ places: 2, total: 5 }).aGagner, 3);
  assert.equal(creerMatch({ places: 2 }).aGagner, 2);
});

test('la manche n est pas finie tant qu il reste deux bombers', () => {
  const etat = areneNue({ places: 3 });
  assert.equal(verdictManche(etat), null);
  etat.joueurs[0].vivant = false;
  assert.equal(verdictManche(etat), null);
});

test('le dernier vivant gagne la manche', () => {
  const etat = areneNue({ places: 3 });
  etat.joueurs[0].vivant = false;
  etat.joueurs[2].vivant = false;
  assert.deepEqual(verdictManche(etat), { gagnante: 1, nulle: false });
});

test('des morts simultanees font une manche nulle, et personne ne marque', () => {
  const etat = areneNue({ places: 2 });
  etat.joueurs[0].vivant = false;
  etat.joueurs[1].vivant = false;
  const verdict = verdictManche(etat);
  assert.deepEqual(verdict, { gagnante: null, nulle: true });

  const match = marquer(creerMatch({ places: 2 }), verdict);
  assert.deepEqual(match.scores, [0, 0]);
  assert.equal(match.nuls, 1);
  assert.equal(match.manche, 2);
  assert.equal(matchTermine(match), false);
});

test('seul, la manche ne s arrete qu a sa propre mort', () => {
  const etat = areneNue({ places: 1 });
  assert.equal(verdictManche(etat), null, 'un survivant unique ne finit pas la manche');
  etat.joueurs[0].vivant = false;
  assert.deepEqual(verdictManche(etat), { gagnante: null, nulle: true });
});

test('deux manches gagnees terminent un match au meilleur des trois', () => {
  let match = creerMatch({ places: 2 });
  match = marquer(match, { gagnante: 0, nulle: false });
  assert.equal(matchTermine(match), false);
  match = marquer(match, { gagnante: 0, nulle: false });
  assert.equal(matchTermine(match), true);
  assert.equal(vainqueur(match), 0);
  assert.deepEqual(match.scores, [2, 0]);
});

test('les nuls a repetition finissent par terminer le match', () => {
  let match = creerMatch({ places: 2 });
  for (let i = 0; i < MANCHES_MAX + 2 && !matchTermine(match); i += 1) {
    match = marquer(match, { gagnante: null, nulle: true });
  }
  assert.equal(matchTermine(match), true);
  assert.equal(vainqueur(match), null, 'personne ne gagne un match de nuls');
});

test('un match a egalite n a pas de vainqueur', () => {
  let match = creerMatch({ places: 2, total: 5 });
  match = marquer(match, { gagnante: 0, nulle: false });
  match = marquer(match, { gagnante: 1, nulle: false });
  assert.equal(vainqueur(match), null);
  assert.deepEqual(
    classement(match).map((ligne) => ligne.place),
    [0, 1],
    'l egalite est tranchee par le numero de place, pour que l ordre soit le meme partout',
  );
});

test('chaque manche a sa propre graine, derivee de celle du match', () => {
  const graines = new Set();
  for (let manche = 1; manche <= 9; manche += 1) graines.add(graineDeManche(4242, manche));
  assert.equal(graines.size, 9, 'aucune manche ne doit rejouer la meme arene');
  // Reproductible : c est ce qui permet au journal de rejouer la soiree.
  assert.equal(graineDeManche(4242, 3), graineDeManche(4242, 3));
  assert.notEqual(graineDeManche(4242, 3), graineDeManche(4243, 3));
  for (let manche = 1; manche <= 9; manche += 1) {
    assert.notEqual(graineDeManche(0, manche), 0, 'jamais une graine nulle');
  }
});

test('le moteur attend la fin des flammes avant d annoncer le verdict', () => {
  const etat = areneNue({ places: 2 });
  const un = placer(etat, 0, 3, 3);
  placer(etat, 1, 9, 9);
  un.detonateur = true;

  pas(etat, entree(0, { poser: true }));
  pas(etat, entree(0, { declencher: true }));
  assert.equal(un.vivant, false, 'il meurt de sa propre bombe');
  assert.equal(etat.phase, 'jeu', 'le verdict ne tombe pas au pas de la mort');

  avancerDe(etat, FIN_MANCHE_PAS - 2, []);
  assert.equal(etat.phase, 'jeu');

  // Un pas a la fois : l evenement `round` ne vit que le pas ou il est emis,
  // comme tous les autres — il part dans la diffusion et disparait.
  let annonce = 0;
  for (let i = 0; i < 5 && etat.phase === 'jeu'; i += 1) {
    pas(etat, []);
    annonce += evenements(etat, 'round').length;
  }
  assert.equal(etat.phase, 'verdict');
  assert.deepEqual(etat.verdict, { gagnante: 1, nulle: false });
  assert.equal(annonce, 1);
});

test('en phase de verdict, le moteur ne bouge plus', () => {
  const etat = areneNue({ places: 2 });
  etat.phase = 'verdict';
  const avant = etat.pas;
  pas(etat, entree(0, { poser: true }));
  assert.equal(etat.pas, avant);
  assert.equal(etat.bombes.length, 0);
});
