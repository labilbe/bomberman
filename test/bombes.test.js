import test from 'node:test';
import assert from 'node:assert/strict';

import { pas, avancerDe } from '../src/engine/pas.js';
import { peutPoser, bombeSur } from '../src/engine/bombes.js';
import { caseAxe, centreAxe } from '../src/engine/grille.js';
import { MECHE_PAS, DROITE, GAUCHE, BAS } from '../src/engine/constantes.js';
import { areneNue, brique, placer, entree, evenements } from './aide.js';

test('on ne pose jamais plus de bombes que son quota', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 1);
  joueur.bombes = 2;

  pas(etat, entree(0, { poser: true }));
  assert.equal(etat.bombes.length, 1);

  // Deuxieme pose : il faut avoir change de case, une bombe par case.
  avancerDe(etat, 14, entree(0, { dir: DROITE }));
  pas(etat, entree(0, { poser: true, dir: DROITE }));
  assert.equal(etat.bombes.length, 2);
  assert.equal(joueur.posees, 2);

  avancerDe(etat, 14, entree(0, { dir: DROITE }));
  pas(etat, entree(0, { poser: true, dir: DROITE }));
  assert.equal(etat.bombes.length, 2, 'le quota de 2 doit tenir');
  assert.equal(peutPoser(etat, joueur), false);
});

test('deux bombes ne tiennent pas sur la meme case', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 3);
  joueur.bombes = 4;
  pas(etat, entree(0, { poser: true }));
  pas(etat, entree(0, { poser: true }));
  pas(etat, entree(0, { poser: true }));
  assert.equal(etat.bombes.length, 1);
});

test('le quota est rendu a l explosion, une seule fois', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 5, 5);
  joueur.bombes = 3;
  pas(etat, entree(0, { poser: true }));
  assert.equal(joueur.posees, 1);
  avancerDe(etat, MECHE_PAS + 5, entree(0, {}));
  assert.equal(etat.bombes.length, 0);
  assert.equal(joueur.posees, 0);
});

test('sans le bonus, une bombe ne se pousse pas', () => {
  const etat = areneNue();
  const poseur = placer(etat, 0, 3, 3);
  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];

  // On s eloigne, puis on revient dedans : sans kick, elle ne bouge pas.
  avancerDe(etat, 20, entree(0, { dir: DROITE }));
  avancerDe(etat, 30, entree(0, { dir: GAUCHE }));
  assert.equal(bombe.cx, 3);
  assert.equal(bombe.glisse, null);
  assert.ok(caseAxe(poseur.x) >= 4, 'il doit buter sur sa propre bombe');
});

test('avec le kick, la bombe glisse et se cale sur un centre de case', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 3);
  joueur.kick = true;
  brique(etat, 6, 3);

  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];

  // On sort de la case par la gauche, puis on revient : le bomber bute sur sa
  // bombe et la pousse vers la droite.
  avancerDe(etat, 20, entree(0, { dir: GAUCHE }));
  assert.equal(joueur.surBombe, null, 'il doit avoir quitte sa bombe');
  avancerDe(etat, 40, entree(0, { dir: DROITE }));

  assert.equal(bombe.cx, 5, 'elle s arrete contre la brique de (6,3)');
  assert.equal(bombe.cy, 3);
  assert.equal(bombe.glisse, null, 'arrivee, elle ne glisse plus');
  assert.equal(bombe.glisse, null);
  assert.equal(centreAxe(bombe.cx), centreAxe(5));
});

test('une bombe kickee signale son depart une seule fois', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 3);
  joueur.kick = true;
  pas(etat, entree(0, { poser: true }));
  avancerDe(etat, 20, entree(0, { dir: GAUCHE }));

  let vus = 0;
  for (let i = 0; i < 40; i += 1) {
    pas(etat, entree(0, { dir: DROITE }));
    vus += evenements(etat, 'kick').length;
  }
  assert.equal(vus, 1, 'un seul evenement kick pour un seul coup de pied');
});

test('une bombe collee au mur ne part pas', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 1);
  joueur.kick = true;
  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];

  // Depuis la droite, on la pousse vers la gauche : le mur de la colonne 0 la
  // retient, et elle ne doit pas s y enfoncer d une sous-unite.
  avancerDe(etat, 20, entree(0, { dir: DROITE }));
  avancerDe(etat, 40, entree(0, { dir: GAUCHE }));
  assert.equal(bombe.cx, 1);
  assert.equal(bombe.glisse, null);
});

test('le detonateur fait partir la plus ancienne bombe, et elle seule', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 5);
  joueur.bombes = 3;
  joueur.detonateur = true;

  // Trois bombes assez loin les unes des autres pour qu aucune n enchaine sur
  // les autres : on veut eprouver le detonateur, pas la chaine.
  pas(etat, entree(0, { poser: true }));
  placer(etat, 0, 5, 5);
  pas(etat, entree(0, { poser: true }));
  placer(etat, 0, 9, 5);
  pas(etat, entree(0, { poser: true }));
  assert.equal(etat.bombes.length, 3);

  const anciens = etat.bombes.map((bombe) => bombe.id).sort((a, b) => a - b);
  pas(etat, entree(0, { declencher: true }));
  assert.equal(etat.bombes.length, 2, 'une seule doit partir');
  assert.equal(
    etat.bombes.some((bombe) => bombe.id === anciens[0]),
    false,
    'la plus ancienne doit avoir disparu',
  );
  assert.equal(joueur.posees, 2, 'le quota rendu doit suivre');
});

test('sans le bonus, le detonateur ne fait rien', () => {
  const etat = areneNue();
  placer(etat, 0, 1, 5);
  pas(etat, entree(0, { poser: true }));
  pas(etat, entree(0, { declencher: true }));
  assert.equal(etat.bombes.length, 1);
});

test('la bombe reste sur sa case tant qu elle ne glisse pas', () => {
  const etat = areneNue();
  placer(etat, 0, 7, 5);
  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];
  avancerDe(etat, 50, entree(0, { dir: BAS }));
  assert.equal(bombeSur(etat, 7, 5), bombe);
});
