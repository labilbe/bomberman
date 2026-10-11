import test from 'node:test';
import assert from 'node:assert/strict';

import { pas, avancerDe } from '../src/engine/pas.js';
import { peutPoser, bombeSur } from '../src/engine/bombes.js';
import { caseAxe, centreAxe } from '../src/engine/grille.js';
import {
  MECHE_PAS,
  FLAMME_PAS,
  DETONATEURS_PAR_BONUS,
  DROITE,
  GAUCHE,
  BAS,
} from '../src/engine/constantes.js';
import { appliquer, CODES_BONUS } from '../src/engine/bonus.js';
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
  joueur.detonateur = DETONATEURS_PAR_BONUS;

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

test('une bombe a detonateur n a pas de meche et attend indefiniment', () => {
  // Le marche du bonus : sans minuterie, le detonateur n est plus une facon
  // d aller plus vite mais une arme de patience.
  const etat = areneNue();
  const joueur = placer(etat, 0, 7, 7);
  joueur.detonateur = DETONATEURS_PAR_BONUS;

  pas(etat, entree(0, { poser: true }));
  const [bombe] = etat.bombes;
  assert.equal(bombe.meche, null, 'elle ne doit porter aucune meche');

  placer(etat, 0, 1, 1);
  avancerDe(etat, MECHE_PAS * 3, entree(0, {}));
  assert.equal(etat.bombes.length, 1, 'trois meches plus tard, elle est toujours la');
  assert.equal(etat.bombes[0].meche, null);
});

test('le detonateur fait partir la bombe qui attend', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 7, 7);
  joueur.detonateur = DETONATEURS_PAR_BONUS;

  pas(etat, entree(0, { poser: true }));
  placer(etat, 0, 1, 1);
  avancerDe(etat, MECHE_PAS * 2, entree(0, {}));
  assert.equal(etat.bombes.length, 1);

  pas(etat, entree(0, { declencher: true }));
  assert.equal(etat.bombes.length, 0);
  assert.equal(evenements(etat, 'boom').length, 1);
  assert.equal(joueur.posees, 0, 'et son quota lui revient');
});

test('sans le detonateur, la bombe garde sa meche', () => {
  const etat = areneNue();
  placer(etat, 0, 7, 7);
  pas(etat, entree(0, { poser: true }));
  assert.equal(etat.bombes[0].meche, MECHE_PAS - 1);
});

test('une bombe qui attend part quand meme si une autre l atteint', () => {
  // Elle n echappe pas aux chaines : rester a l abri d un souffle serait un
  // privilege que le bonus ne donne pas.
  const etat = areneNue({ places: 2 });
  const patient = placer(etat, 0, 5, 3);
  patient.detonateur = DETONATEURS_PAR_BONUS;
  pas(etat, entree(0, { poser: true }));

  const voisin = placer(etat, 1, 3, 3);
  voisin.portee = 3;
  voisin.detonateur = DETONATEURS_PAR_BONUS;
  pas(etat, entree(1, { poser: true }));
  placer(etat, 1, 9, 9);
  pas(etat, entree(1, { declencher: true }));

  assert.equal(etat.bombes.length, 0, 'les deux doivent avoir saute');
  assert.equal(evenements(etat, 'boom').length, 2);
});

test('la mort du porteur rend une meche a ses bombes en attente', () => {
  // Sinon elles resteraient posees jusqu a la fin de la manche : plus aucun
  // doigt ne peut les declencher, et elles bloqueraient l arene pour rien.
  // Trois places, et non deux : a deux, la manche se conclut des la mort du
  // porteur et le moteur gele avant que la meche n ait pu bruler.
  const etat = areneNue({ places: 3 });
  const porteur = placer(etat, 0, 7, 7);
  porteur.detonateur = DETONATEURS_PAR_BONUS;
  pas(etat, entree(0, { poser: true }));
  assert.equal(etat.bombes[0].meche, null);
  placer(etat, 2, 13, 11);

  const tueur = placer(etat, 1, 1, 1);
  tueur.detonateur = DETONATEURS_PAR_BONUS;
  tueur.portee = 1;
  placer(etat, 0, 1, 2);
  pas(etat, entree(1, { poser: true }));
  // Le tueur s eloigne avant d appuyer : s il mourait avec sa victime, il ne
  // resterait qu un survivant et la manche se conclurait.
  placer(etat, 1, 13, 1);
  pas(etat, entree(1, { declencher: true }));

  assert.equal(porteur.vivant, false, 'le porteur doit bien mourir');
  const restante = etat.bombes.find((bombe) => bombe.place === 0);
  assert.ok(restante, 'sa bombe lointaine est encore la');
  assert.equal(restante.meche, MECHE_PAS, 'mais elle a desormais une meche');

  avancerDe(etat, MECHE_PAS + 1, []);
  assert.equal(etat.bombes.length, 0, 'et elle finit par partir seule');
});

test('le detonateur est une reserve qui s epuise', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 5);
  joueur.bombes = 1;
  assert.equal(joueur.detonateur, 0, 'on commence sans');

  appliquer(joueur, CODES_BONUS.DETONATEUR);
  assert.equal(joueur.detonateur, DETONATEURS_PAR_BONUS);

  // On pose et on declenche autant de fois qu il y a de charges, en changeant
  // de case a chaque fois pour ne pas se gener.
  for (let tir = 0; tir < DETONATEURS_PAR_BONUS; tir += 1) {
    placer(etat, 0, 1 + tir * 2, 5);
    pas(etat, entree(0, { poser: true }));
    assert.equal(etat.bombes[0].meche, null, `tir ${tir} : elle doit attendre`);
    // On s eloigne avant d appuyer : poser et se faire sauter avec, c est la
    // facon la plus sure de ne tester qu un seul tir.
    placer(etat, 0, 13, 11);
    pas(etat, entree(0, { declencher: true }));
    assert.equal(etat.bombes.length, 0, `tir ${tir} : elle doit partir`);
    assert.equal(joueur.detonateur, DETONATEURS_PAR_BONUS - tir - 1);
    // On laisse le feu s eteindre : la case du tir suivant est a deux cases de
    // celle-ci, donc encore en flammes, et le joueur s y teleporterait.
    avancerDe(etat, FLAMME_PAS, []);
  }

  // Reserve vide : on revient aux bombes a meche.
  placer(etat, 0, 11, 5);
  pas(etat, entree(0, { poser: true }));
  assert.equal(etat.bombes[0].meche, MECHE_PAS - 1, 'la meche revient');
  pas(etat, entree(0, { declencher: true }));
  assert.equal(etat.bombes.length, 1, 'et le bouton ne fait plus rien');
});

test('appuyer dans le vide ne gaspille pas une charge', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 5);
  appliquer(joueur, CODES_BONUS.DETONATEUR);

  pas(etat, entree(0, { declencher: true }));
  assert.equal(joueur.detonateur, DETONATEURS_PAR_BONUS, 'aucune bombe, aucune charge');
});

test('la derniere charge rend leur meche aux bombes encore en attente', () => {
  // Sinon elles resteraient posees pour toujours : plus aucune charge ne peut
  // les declencher, et elles bloqueraient l arene.
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 5);
  joueur.bombes = 3;
  joueur.detonateur = 1;

  pas(etat, entree(0, { poser: true }));
  placer(etat, 0, 5, 5);
  pas(etat, entree(0, { poser: true }));
  placer(etat, 0, 9, 5);
  pas(etat, entree(0, { poser: true }));
  assert.equal(etat.bombes.every((bombe) => bombe.meche === null), true);

  pas(etat, entree(0, { declencher: true }));
  assert.equal(joueur.detonateur, 0);
  assert.equal(etat.bombes.length, 2, 'la plus ancienne est partie');
  // MECHE_PAS - 1 et non MECHE_PAS : les meches rendues brulent deja d un pas
  // avant la fin de celui-ci, comme toutes les autres.
  assert.equal(
    etat.bombes.every((bombe) => bombe.meche === MECHE_PAS - 1),
    true,
    'les autres ont une meche',
  );
});

test('un second bonus recharge la reserve', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 5);
  joueur.detonateur = 2;
  appliquer(joueur, CODES_BONUS.DETONATEUR);
  assert.equal(joueur.detonateur, 2 + DETONATEURS_PAR_BONUS);
});
