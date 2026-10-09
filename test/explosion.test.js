import test from 'node:test';
import assert from 'node:assert/strict';

import { pas, avancerDe } from '../src/engine/pas.js';
import { rayon } from '../src/engine/explosion.js';
import { poser } from '../src/engine/bombes.js';
import { index } from '../src/engine/grille.js';
import { MECHE_PAS, FLAMME_PAS, BRIQUE, VIDE, DROITE, HAUT } from '../src/engine/constantes.js';
import { CODES_BONUS } from '../src/engine/bonus.js';
import { areneNue, brique, objet, placer, entree, evenements } from './aide.js';

/** Fait exploser sur-le-champ la bombe d un joueur muni du detonateur. */
function detonner(etat, place) {
  etat.joueurs[place].detonateur = true;
  pas(etat, entree(place, { declencher: true }));
}

test('la croix s arrete au premier mur dur', () => {
  const etat = areneNue();
  // (2,2) est un pilier du damier : la branche vers le haut depuis (2,3)
  // s arrete avant lui.
  const branche = rayon(etat, 2, 3, HAUT, 5);
  assert.deepEqual(branche.cases, []);
  assert.equal(branche.brique, null);
});

test('la croix detruit une brique et s arrete la', () => {
  const etat = areneNue();
  brique(etat, 5, 3);
  brique(etat, 6, 3);
  const branche = rayon(etat, 3, 3, DROITE, 5);
  assert.deepEqual(branche.cases, [
    [4, 3],
    [5, 3],
  ]);
  assert.deepEqual(branche.brique, [5, 3]);

  const joueur = placer(etat, 0, 3, 3);
  joueur.portee = 5;
  pas(etat, entree(0, { poser: true }));
  detonner(etat, 0);
  assert.equal(etat.tuiles[index(5, 3)], VIDE, 'la premiere brique tombe');
  assert.equal(etat.tuiles[index(6, 3)], BRIQUE, 'la seconde tient');
  assert.equal(evenements(etat, 'brick').length, 1);
});

test('l evenement boum porte la longueur reelle des quatre branches', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 3);
  joueur.portee = 2;
  pas(etat, entree(0, { poser: true }));
  detonner(etat, 0);
  const [boum] = evenements(etat, 'boom');
  assert.ok(boum, 'un evenement boum doit partir');
  const [, , cx, cy, haut, droite, bas, gauche] = boum;
  assert.deepEqual([cx, cy], [3, 3]);
  assert.deepEqual([haut, droite, bas, gauche], [2, 2, 2, 2]);
});

test('une chaine de cinq bombes se resout dans le meme pas', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 1);
  joueur.bombes = 5;
  for (const cx of [1, 2, 3, 4, 5]) {
    placer(etat, 0, cx, 1);
    pas(etat, entree(0, { poser: true }));
  }
  assert.equal(etat.bombes.length, 5);

  placer(etat, 0, 9, 9);
  detonner(etat, 0);
  assert.equal(etat.bombes.length, 0, 'tout doit partir dans le meme pas');
  assert.equal(evenements(etat, 'boom').length, 5);
  assert.equal(joueur.posees, 0);
});

test('deux bombes qui se declenchent mutuellement n explosent qu une fois', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 3);
  joueur.bombes = 2;
  pas(etat, entree(0, { poser: true }));
  placer(etat, 0, 4, 3);
  pas(etat, entree(0, { poser: true }));

  placer(etat, 0, 9, 9);
  detonner(etat, 0);
  assert.equal(evenements(etat, 'boom').length, 2);
  assert.equal(etat.bombes.length, 0);
});

test('deux bombers sur la meme flamme meurent au meme pas', () => {
  const etat = areneNue({ places: 2 });
  const un = placer(etat, 0, 3, 3);
  const deux = placer(etat, 1, 4, 3);
  un.portee = 2;

  pas(etat, entree(0, { poser: true }));
  detonner(etat, 0);
  assert.equal(un.vivant, false);
  assert.equal(deux.vivant, false);
  assert.equal(un.mortAu, deux.mortAu);
  assert.equal(evenements(etat, 'death').length, 2);
});

test('un bonus revele survit a l explosion qui le decouvre', () => {
  const etat = areneNue();
  brique(etat, 5, 3);
  objet(etat, 5, 3, 128 + CODES_BONUS.FLAMME);
  const joueur = placer(etat, 0, 3, 3);
  joueur.portee = 3;

  pas(etat, entree(0, { poser: true }));
  detonner(etat, 0);
  assert.equal(etat.objets[index(5, 3)], CODES_BONUS.FLAMME, 'il doit apparaitre');
  assert.equal(evenements(etat, 'item').length, 1);
  assert.equal(evenements(etat, 'itemgone').length, 0);

  // Et il survit tant que la flamme qui l a decouvert brule encore.
  avancerDe(etat, FLAMME_PAS + 2, entree(0, {}));
  assert.equal(etat.objets[index(5, 3)], CODES_BONUS.FLAMME);
});

test('un bonus deja visible est detruit par une flamme neuve', () => {
  const etat = areneNue();
  objet(etat, 5, 3, CODES_BONUS.BOMBE);
  const joueur = placer(etat, 0, 3, 3);
  joueur.portee = 3;

  pas(etat, entree(0, { poser: true }));
  detonner(etat, 0);
  assert.equal(etat.objets[index(5, 3)], 0);
  assert.equal(evenements(etat, 'itemgone').length, 1);
});

test('on ramasse un bonus en marchant dessus', () => {
  const etat = areneNue();
  objet(etat, 4, 3, CODES_BONUS.BOMBE);
  const joueur = placer(etat, 0, 3, 3);
  assert.equal(joueur.bombes, 1);

  avancerDe(etat, 20, entree(0, { dir: DROITE }));
  assert.equal(joueur.bombes, 2);
  assert.equal(etat.objets[index(4, 3)], 0);
});

test('un bomber qui meurt ne ramasse pas le bonus sous ses pieds', () => {
  // Montage : la flamme touche la case (3,3), ou la victime ne fait que mordre,
  // tandis que son CENTRE est en (3,4) avec un bonus intact. Le bonus n est donc
  // pas brule, et seul l ordre « bruler avant de ramasser » peut l empecher
  // d etre empoche par un mort.
  const etat = areneNue({ places: 2 });
  const tueur = placer(etat, 1, 3, 2);
  tueur.detonateur = true;
  // La portee est fixee ICI et ne doit pas suivre la dotation de depart : tout
  // le montage tient a ce que la flamme s arrete en (3,3). A deux cases, elle
  // atteindrait (3,4), brulerait le bonus, et le test ne verifierait plus rien.
  tueur.portee = 1;
  const victime = placer(etat, 0, 3, 4);
  victime.y = 4300;

  // La bombe est posee sans jouer de pas, et le bonus seme juste apres : sinon
  // la victime l aurait ramasse tranquillement avant l explosion.
  poser(etat, tueur);
  objet(etat, 3, 4, CODES_BONUS.BOMBE);

  pas(etat, entree(1, { declencher: true }));
  assert.equal(victime.vivant, false, 'elle doit mourir de la flamme de (3,3)');
  assert.equal(etat.objets[index(3, 4)], CODES_BONUS.BOMBE, 'le bonus n est pas brule');
  assert.equal(victime.bombes, 1, 'aucun bonus posthume');
  assert.equal(evenements(etat, 'pick').length, 0);
});

test('la flamme s eteint apres sa duree', () => {
  const etat = areneNue();
  placer(etat, 0, 3, 3);
  pas(etat, entree(0, { poser: true }));
  placer(etat, 0, 9, 9);
  detonner(etat, 0);
  assert.ok(etat.flammes.length > 0);
  avancerDe(etat, FLAMME_PAS, entree(0, {}));
  assert.equal(etat.flammes.length, 0);
});

test('une bombe explose seule a la fin de sa meche', () => {
  const etat = areneNue();
  placer(etat, 0, 7, 7);
  pas(etat, entree(0, { poser: true }));
  placer(etat, 0, 1, 1);
  avancerDe(etat, MECHE_PAS - 2, entree(0, {}));
  assert.equal(etat.bombes.length, 1, 'elle ne doit pas partir avant l heure');
  avancerDe(etat, 3, entree(0, {}));
  assert.equal(etat.bombes.length, 0);
});
