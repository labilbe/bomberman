import test from 'node:test';
import assert from 'node:assert/strict';

import { pas, avancerDe } from '../src/engine/pas.js';
import { peutPoser, bombeSur, pousser } from '../src/engine/bombes.js';
import { caseAxe, centreAxe } from '../src/engine/grille.js';
import {
  MECHE_PAS,
  DOUBLE_POSE_PAS,
  FLAMME_PAS,
  DETONATEURS_PAR_BONUS,
  DROITE,
  GAUCHE,
  BAS,
  HAUT,
  ROWS,
  COLS,
  VOL_PAS_PAR_CASE,
} from '../src/engine/constantes.js';
import { appliquer, CODES_BONUS } from '../src/engine/bonus.js';
import { areneNue, brique, placer, entree, evenements } from './aide.js';

test('on ne pose jamais plus de bombes que son quota', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 1);
  joueur.bombes = 2;

  pas(etat, entree(0, { poser: true }));
  assert.equal(etat.bombes.length, 1);

  // Deuxieme pose : il faut avoir change de case, une bombe par case. On laisse
  // aussi passer la fenetre du double appui, sans quoi le second appui vaudrait
  // rafale et poserait devant au lieu de dessous.
  avancerDe(etat, DOUBLE_POSE_PAS + 1, entree(0, { dir: DROITE }));
  pas(etat, entree(0, { poser: true, dir: DROITE }));
  assert.equal(etat.bombes.length, 2);
  assert.equal(joueur.posees, 2);

  avancerDe(etat, DOUBLE_POSE_PAS + 1, entree(0, { dir: DROITE }));
  pas(etat, entree(0, { poser: true, dir: DROITE }));
  assert.equal(etat.bombes.length, 2, 'le quota de 2 doit tenir');
  assert.equal(peutPoser(etat, joueur), false);
});

test('deux bombes ne tiennent pas sur la meme case', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 3);
  joueur.bombes = 4;
  pas(etat, entree(0, { poser: true }));
  // Espacees, pour qu'il s'agisse bien de trois poses et non d'une rafale.
  avancerDe(etat, DOUBLE_POSE_PAS + 1, entree(0, {}));
  pas(etat, entree(0, { poser: true }));
  avancerDe(etat, DOUBLE_POSE_PAS + 1, entree(0, {}));
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

test('la reserve se vide a la pose, pas au declenchement', () => {
  // Elle compte des bombes a retardement a poser, et non des appuis : poser
  // trois bombes coute trois charges, les faire partir n en coute aucune.
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 5);
  joueur.bombes = 3;
  joueur.detonateur = 3;

  pas(etat, entree(0, { poser: true }));
  assert.equal(joueur.detonateur, 2, 'la pose preleve');
  placer(etat, 0, 5, 5);
  pas(etat, entree(0, { poser: true }));
  placer(etat, 0, 9, 5);
  pas(etat, entree(0, { poser: true }));
  assert.equal(joueur.detonateur, 0, 'trois bombes, trois charges');
  assert.equal(etat.bombes.every((bombe) => bombe.meche === null), true);

  // Reserve vide, et pourtant les trois partent, une par appui.
  placer(etat, 0, 13, 11);
  pas(etat, entree(0, { declencher: true }));
  assert.equal(etat.bombes.length, 2, 'la plus ancienne est partie');
  assert.equal(joueur.detonateur, 0, 'le bouton ne coute rien');
  avancerDe(etat, FLAMME_PAS + 1, []);
  pas(etat, entree(0, { declencher: true }));
  avancerDe(etat, FLAMME_PAS + 1, []);
  pas(etat, entree(0, { declencher: true }));
  avancerDe(etat, 2, []);
  assert.equal(etat.bombes.length, 0, 'les trois ont fini par partir');
});

test('la reserve vide, on revient aux bombes a meche', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 5);
  joueur.bombes = 2;
  joueur.detonateur = 1;

  pas(etat, entree(0, { poser: true }));
  assert.equal(etat.bombes[0].meche, null, 'la derniere charge donne bien une attente');
  avancerDe(etat, DOUBLE_POSE_PAS + 1, entree(0, {}));
  placer(etat, 0, 5, 5);
  pas(etat, entree(0, { poser: true }));
  assert.equal(etat.bombes[1].meche, MECHE_PAS - 1, 'la suivante a une meche');

  // Et le bouton ne commande pas une bombe a meche : elle n a jamais ete payee.
  placer(etat, 0, 13, 11);
  pas(etat, entree(0, { declencher: true }));
  pas(etat, entree(0, { declencher: true }));
  assert.equal(bombeSur(etat, 5, 5) !== null, true, 'la bombe a meche attend son heure');
});
test('un second bonus recharge la reserve', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 5);
  joueur.detonateur = 2;
  appliquer(joueur, CODES_BONUS.DETONATEUR);
  assert.equal(joueur.detonateur, 2 + DETONATEURS_PAR_BONUS);
});

test('le gant envoie la bombe trois cases plus loin, par-dessus tout', () => {
  // C est la difference avec le kick : il pousse au ras du sol et s arrete au
  // premier obstacle ; le gant fait PASSER la bombe par-dessus.
  const etat = areneNue();
  brique(etat, 5, 5);
  const joueur = placer(etat, 0, 3, 5);
  joueur.gant = true;
  joueur.dir = DROITE;

  // Une bombe adverse juste devant lui.
  const voisin = placer(etat, 0, 4, 5);
  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];
  assert.deepEqual([bombe.cx, bombe.cy], [4, 5]);

  // Il revient sur sa case et frappe, du bouton du detonateur.
  placer(etat, 0, 3, 5);
  joueur.dir = DROITE;
  pas(etat, entree(0, { declencher: true }));

  assert.ok(bombe.vol, 'elle doit etre en l air');
  assert.deepEqual([bombe.cx, bombe.cy], [7, 5], 'et viser trois cases plus loin');
  assert.equal(etat.bombes.length, 1, 'aucune bombe de plus n a ete posee');
  assert.equal(evenements(etat, 'punch').length, 1);
  assert.ok(voisin);
});

test('une bombe en vol ne bloque personne', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 5);
  joueur.gant = true;
  joueur.dir = DROITE;
  placer(etat, 0, 4, 5);
  pas(etat, entree(0, { poser: true }));
  placer(etat, 0, 3, 5);
  joueur.dir = DROITE;
  pas(etat, entree(0, { declencher: true }));

  const bombe = etat.bombes[0];
  assert.ok(bombe.vol);
  // On traverse la case de depart, que la bombe vient de quitter.
  avancerDe(etat, 12, entree(0, { dir: DROITE }));
  assert.ok(caseAxe(joueur.x) >= 4, 'il passe sous la trajectoire');
});

test('faute de frappe, la touche garde son sens premier : elle declenche', () => {
  // Le gant ne prive pas du detonateur : il ne passe devant que s il y a
  // vraiment une bombe a frapper, celle d en face ou celle du dessous.
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 5);
  joueur.gant = true;
  joueur.detonateur = 1;
  joueur.dir = DROITE;

  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];
  // Il s eloigne : sa bombe n est plus ni devant lui ni sous ses pieds.
  avancerDe(etat, 40, entree(0, { dir: DROITE }));
  assert.ok(caseAxe(joueur.x) > 4, 'il est bien parti');

  pas(etat, entree(0, { declencher: true }));
  assert.equal(evenements(etat, 'punch').length, 0, 'rien a frapper d ou il est');
  assert.equal(bombe.vol, null, 'elle ne s envole pas');
  assert.equal(etat.bombes.length, 0, 'elle a saute sur commande');
  assert.ok(etat.flammes.length > 0);
  assert.equal(joueur.detonateur, 0, 'la charge a servi');
});

test('le bouton des bombes ne frappe plus : il pose, c est tout', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 5);
  joueur.gant = true;
  joueur.bombes = 2;
  joueur.dir = DROITE;

  // Une bombe adverse juste devant lui, la cible meme du gant.
  placer(etat, 1, 4, 5);
  pas(etat, entree(1, { poser: true }));
  const devant = bombeSur(etat, 4, 5);

  pas(etat, entree(0, { poser: true }));
  assert.equal(devant.vol, null, 'elle reste au sol');
  assert.equal(evenements(etat, 'punch').length, 0);
  assert.ok(bombeSur(etat, 3, 5), 'il a pose la sienne, comme demande');
});

test('sans le gant, rien ne vole, ni au bouton des bombes ni a l autre', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 5);
  joueur.bombes = 2;
  joueur.dir = DROITE;
  placer(etat, 0, 4, 5);
  pas(etat, entree(0, { poser: true }));
  avancerDe(etat, DOUBLE_POSE_PAS + 1, entree(0, {}));
  placer(etat, 0, 3, 5);
  joueur.dir = DROITE;
  pas(etat, entree(0, { poser: true, declencher: true }));

  assert.equal(etat.bombes.length, 2, 'il en pose une seconde');
  assert.equal(etat.bombes.every((b) => !b.vol), true, 'et rien ne vole');
});

test('la bombe frappee atterrit et bloque de nouveau', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 5);
  joueur.gant = true;
  joueur.dir = DROITE;
  placer(etat, 0, 4, 5);
  pas(etat, entree(0, { poser: true }));
  placer(etat, 0, 3, 5);
  joueur.dir = DROITE;
  pas(etat, entree(0, { declencher: true }));

  const bombe = etat.bombes[0];
  avancerDe(etat, bombe.vol.duree + 1, []);
  assert.equal(bombe.vol, null, 'elle a touche terre');
  assert.deepEqual([bombe.cx, bombe.cy], [7, 5]);
});

test('sa meche continue de bruler pendant le vol', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 5);
  joueur.gant = true;
  joueur.dir = DROITE;
  placer(etat, 0, 4, 5);
  pas(etat, entree(0, { poser: true }));
  const avant = etat.bombes[0].meche;
  placer(etat, 0, 3, 5);
  joueur.dir = DROITE;
  pas(etat, entree(0, { declencher: true }));
  avancerDe(etat, 10, []);
  assert.ok(etat.bombes[0].meche < avant - 5, 'le vol ne met pas la meche en pause');
});

test('on frappe la bombe sous ses pieds, sans avoir a quitter sa case', () => {
  // LE CAS LE PLUS FREQUENT EN JEU, et celui qui rendait le gant inutilisable :
  // tant que la boite touche encore sa propre bombe, appuyer vers elle y fait
  // remarcher au lieu de lui faire face, et il n y avait alors rien a frapper.
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 5);
  joueur.gant = true;
  joueur.dir = DROITE;

  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];
  assert.deepEqual([bombe.cx, bombe.cy], [3, 5]);

  pas(etat, entree(0, { declencher: true }));
  assert.ok(bombe.vol, 'elle doit partir de sous ses pieds');
  assert.deepEqual([bombe.cx, bombe.cy], [6, 5]);
  assert.equal(etat.bombes.length, 1);
  assert.equal(evenements(etat, 'punch').length, 1);
});

test('la bombe devant soi passe avant celle du dessous', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 5);
  joueur.gant = true;
  joueur.bombes = 2;
  joueur.dir = DROITE;

  pas(etat, entree(0, { poser: true }));
  placer(etat, 1, 4, 5);
  pas(etat, entree(1, { poser: true }));
  const sienne = bombeSur(etat, 3, 5);
  const devant = bombeSur(etat, 4, 5);
  assert.ok(sienne && devant);

  pas(etat, entree(0, { declencher: true }));
  assert.ok(devant.vol, 'c est celle d en face qui part');
  assert.equal(sienne.vol, null, 'la sienne reste au sol');
});

test('le geste de frappe se joue meme quand rien ne part', () => {
  // Frapper a cote doit se voir : sans retour a l ecran, le gant passe pour
  // inerte et l on croit la touche morte.
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 5);
  joueur.gant = true;
  joueur.dir = DROITE;

  pas(etat, entree(0, { declencher: true }));
  assert.equal(etat.bombes.length, 0, 'aucune bombe nulle part');
  assert.equal(joueur.frappeAu, etat.pas, 'le geste est tout de meme date');

  const sansGant = placer(etat, 1, 7, 5);
  pas(etat, entree(1, { declencher: true }));
  assert.equal(sansGant.frappeAu, null, 'sans le bonus, aucun geste');
});

test('frappee vers le haut depuis le bord, la bombe revient par le bas', () => {
  // Acule contre un bord, on garde une riposte : la bombe survole le mur du
  // pourtour, sort de l ecran, et retombe au bas de la MEME colonne.
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 1);
  joueur.gant = true;
  joueur.dir = HAUT;

  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];
  pas(etat, entree(0, { declencher: true }));

  assert.ok(bombe.vol, 'elle part en l air');
  assert.equal(bombe.cx, 3, 'meme colonne');
  assert.equal(bombe.cy, ROWS - 2, 'et la premiere rangee jouable d en face');
  // Trois cases survolees, pas onze : c est le trajet, pas la distance a vol
  // d oiseau, qui donne la duree.
  assert.equal(bombe.vol.duree, bombe.vol.reste + 1);
  assert.equal(bombe.vol.duree, 3 * VOL_PAS_PAR_CASE);
});

test('l enroulement vaut aussi sur les cotes', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 5);
  joueur.gant = true;
  joueur.dir = GAUCHE;

  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];
  pas(etat, entree(0, { declencher: true }));

  assert.deepEqual([bombe.cx, bombe.cy], [COLS - 2, 5]);
});

test('loin des bords, la frappe ne fait pas le tour du plateau', () => {
  // L enroulement ne doit pas changer le geste ordinaire : trois cases devant,
  // et rien d autre.
  const etat = areneNue();
  const joueur = placer(etat, 0, 5, 5);
  joueur.gant = true;
  joueur.dir = HAUT;

  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];
  pas(etat, entree(0, { declencher: true }));

  assert.deepEqual([bombe.cx, bombe.cy], [5, 2]);
});

test('un mur a la portee ne l arrete pas : elle cherche le premier trou', () => {
  // La rangee 2 porte les piliers du damier, aux abscisses paires. Frappee
  // depuis (1,2) vers la droite, la bombe vise (4,2) — un pilier — et poursuit
  // tout droit jusqu a (5,2).
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 2);
  joueur.gant = true;
  joueur.dir = DROITE;

  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];
  pas(etat, entree(0, { declencher: true }));

  assert.deepEqual([bombe.cx, bombe.cy], [5, 2], 'elle passe par-dessus le pilier');
  assert.equal(bombe.vol.duree, 4 * VOL_PAS_PAR_CASE, 'et son vol dure les quatre cases');
});

test('elle passe aussi par-dessus les briques et les autres bombes', () => {
  const etat = areneNue();
  brique(etat, 6, 5);
  const joueur = placer(etat, 0, 3, 5);
  joueur.gant = true;
  joueur.dir = DROITE;

  // Une bombe adverse posee pile a la portee du gant.
  placer(etat, 1, 7, 5);
  pas(etat, entree(1, { poser: true }));

  pas(etat, entree(0, { poser: true }));
  const sienne = bombeSur(etat, 3, 5);
  pas(etat, entree(0, { declencher: true }));

  // (6,5) est une brique, (7,5) porte deja une bombe : elle se pose en (8,5).
  assert.deepEqual([sienne.cx, sienne.cy], [8, 5]);
  assert.equal(bombeSur(etat, 7, 5).vol, null, 'celle d en face n a pas bouge');
});

test('une ligne entierement prise ne laisse rien partir', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 5);
  joueur.gant = true;
  joueur.dir = DROITE;

  // Toute la rangee en briques, sauf la case du bomber.
  for (let x = 0; x < COLS; x += 1) if (x !== 3) brique(etat, x, 5);

  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];
  pas(etat, entree(0, { declencher: true }));

  assert.equal(bombe.vol, null, 'elle reste ou elle est');
  assert.deepEqual([bombe.cx, bombe.cy], [3, 5]);
  assert.equal(evenements(etat, 'punch').length, 0);
});

test('la goutte fait rebondir la bombe au lieu de l arreter', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 3);
  joueur.kick = true;
  joueur.goutte = true;
  brique(etat, 6, 3);

  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];
  assert.equal(bombe.rebond, true, 'la bombe nait folle, elle ne le devient pas');

  // On sort par la gauche, on revient : le bomber la shoote vers la droite.
  avancerDe(etat, 20, entree(0, { dir: GAUCHE }));

  // On avance jusqu au premier rebond, et on regarde ou il se produit.
  let touche = null;
  for (let i = 0; i < 60 && touche === null; i += 1) {
    pas(etat, entree(0, { dir: i < 40 ? DROITE : -1 }));
    if (evenements(etat, 'bounce').length > 0) touche = [bombe.cx, bombe.cy];
  }

  // Sans la goutte elle se serait ARRETEE la, en (5,3), contre la brique.
  assert.deepEqual(touche, [5, 3], 'elle rebondit contre la brique de (6,3)');
  assert.ok(bombe.glisse, 'et elle glisse toujours');
  assert.equal(bombe.glisse.dir, GAUCHE, 'en sens inverse');
});

test('le rebond est annonce, une fois par mur touche', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 3);
  joueur.kick = true;
  joueur.goutte = true;
  brique(etat, 6, 3);
  brique(etat, 1, 3);

  pas(etat, entree(0, { poser: true }));
  avancerDe(etat, 20, entree(0, { dir: GAUCHE }));

  let rebonds = 0;
  for (let i = 0; i < 200; i += 1) {
    pas(etat, entree(0, { dir: i < 40 ? DROITE : -1 }));
    rebonds += evenements(etat, 'bounce').length;
  }
  // Elle fait la navette entre les deux briques : au moins un aller-retour.
  assert.ok(rebonds >= 2, `elle doit rebondir plusieurs fois (${rebonds})`);
  assert.ok(etat.bombes.length === 0 || etat.bombes[0].glisse, 'elle n a pas cale en route');
});

test('sans la goutte, rien ne rebondit', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 3);
  joueur.kick = true;
  brique(etat, 6, 3);

  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];
  assert.equal(bombe.rebond, false);
  avancerDe(etat, 20, entree(0, { dir: GAUCHE }));
  avancerDe(etat, 40, entree(0, { dir: DROITE }));

  assert.equal(bombe.cx, 5, 'elle s arrete contre la brique');
  assert.equal(bombe.glisse, null);
  assert.equal(evenements(etat, 'bounce').length, 0);
});

test('coincee entre deux murs, elle se pose au lieu de vibrer', () => {
  const etat = areneNue();
  // Un couloir d une seule case : briques de part et d autre.
  brique(etat, 2, 1);
  brique(etat, 4, 1);
  const joueur = placer(etat, 0, 3, 1);
  joueur.kick = true;
  joueur.goutte = true;

  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];
  avancerDe(etat, 20, entree(0, { dir: BAS }));
  avancerDe(etat, 40, entree(0, { dir: HAUT }));

  assert.equal(bombe.glisse, null, 'elle finit par se poser');
  assert.deepEqual([bombe.cx, bombe.cy], [3, 1]);
});

test('la bombe de la goutte roule deux fois moins vite', () => {
  // Elle ne s arrete plus : au rythme du kick, elle balayait l arene plus vite
  // que l oeil ne la suit.
  const parcours = (goutte) => {
    const etat = areneNue();
    const joueur = placer(etat, 0, 3, 3);
    joueur.goutte = goutte;
    pas(etat, entree(0, { poser: true }));
    const bombe = etat.bombes[0];
    // Shootee a la main : on mesure la course, pas la facon de la declencher.
    placer(etat, 0, 7, 7);
    pousser(etat, bombe, DROITE);
    const depart = bombe.glisse.x;
    avancerDe(etat, 4, entree(0, {}));
    return bombe.glisse.x - depart;
  };

  const sage = parcours(false);
  const folle = parcours(true);
  assert.ok(sage > 0 && folle > 0, 'les deux doivent avoir bouge');
  assert.equal(folle * 2, sage, 'exactement la moitie du chemin');
});

test('une bombe a meche qui heurte une bombe en attente la fait partir', () => {
  const etat = areneNue();
  // Le guetteur pose sa bombe a retardement en (6,5) et l abandonne la.
  const guetteur = placer(etat, 1, 6, 5);
  guetteur.detonateur = 1;
  pas(etat, entree(1, { poser: true }));
  const piege = bombeSur(etat, 6, 5);
  assert.equal(piege.meche, null, 'elle attend bien');
  placer(etat, 1, 13, 11);

  // L autre shoote une bombe ordinaire dedans.
  const tireur = placer(etat, 0, 3, 5);
  tireur.kick = true;
  pas(etat, entree(0, { poser: true }));
  const projectile = bombeSur(etat, 3, 5);
  avancerDe(etat, 20, entree(0, { dir: GAUCHE }));
  avancerDe(etat, 40, entree(0, { dir: DROITE }));

  assert.equal(etat.bombes.includes(piege), false, 'le piege a saute');
  assert.ok(projectile);
});

test('une bombe en attente poussee contre une autre ne s allume pas', () => {
  // L inverse serait injouable : une bombe a retardement doit pouvoir etre
  // deplacee sans se declencher, sinon elle ne sert plus a tendre un piege.
  const etat = areneNue();
  const dormeuse = placer(etat, 1, 6, 5);
  dormeuse.detonateur = 1;
  pas(etat, entree(1, { poser: true }));
  const cible = bombeSur(etat, 6, 5);
  placer(etat, 1, 13, 11);

  const poseur = placer(etat, 0, 3, 5);
  poseur.kick = true;
  poseur.detonateur = 1;
  pas(etat, entree(0, { poser: true }));
  const poussee = bombeSur(etat, 3, 5);
  assert.equal(poussee.meche, null, 'les deux attendent');
  avancerDe(etat, 20, entree(0, { dir: GAUCHE }));
  avancerDe(etat, 40, entree(0, { dir: DROITE }));

  assert.equal(cible.meche, null, 'celle qui dormait dort encore');
  assert.equal(poussee.meche, null);
  assert.equal(etat.bombes.length, 2);
});

test('le double appui aligne toutes les bombes devant soi', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 2, 5);
  joueur.bombes = 4;
  joueur.dir = DROITE;

  // Premier appui : sous les pieds, comme toujours.
  pas(etat, entree(0, { poser: true }));
  assert.deepEqual([bombeSur(etat, 2, 5) !== null, etat.bombes.length], [true, 1]);

  // Second appui dans la foulee : le reste part en file devant lui.
  pas(etat, entree(0, { poser: true }));
  assert.equal(etat.bombes.length, 4, 'les quatre bombes sont posees');
  for (const cx of [3, 4, 5]) {
    assert.ok(bombeSur(etat, cx, 5), `une bombe en (${cx},5)`);
  }
  assert.equal(joueur.posees, 4, 'le quota est bien consomme');
});

test('la rafale s arrete au premier obstacle', () => {
  // Une file percee de trous ne barre rien, et c est barrer qui est tout
  // l interet du geste.
  const etat = areneNue();
  brique(etat, 5, 5);
  const joueur = placer(etat, 0, 2, 5);
  joueur.bombes = 8;
  joueur.dir = DROITE;

  pas(etat, entree(0, { poser: true }));
  pas(etat, entree(0, { poser: true }));

  assert.equal(etat.bombes.length, 3, 'sous les pieds, puis (3,5) et (4,5)');
  assert.equal(bombeSur(etat, 6, 5), null, 'rien ne saute par-dessus la brique');
  assert.equal(joueur.posees, 3, 'le reste du chargeur est garde');
});

test('deux appuis espaces ne font pas une rafale', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 2, 5);
  joueur.bombes = 4;
  joueur.dir = DROITE;

  pas(etat, entree(0, { poser: true }));
  avancerDe(etat, DOUBLE_POSE_PAS + 1, entree(0, {}));
  pas(etat, entree(0, { poser: true }));

  assert.equal(etat.bombes.length, 1, 'le second appui ne pose rien : il est sur sa bombe');
});

test('un appui sans effet n arme pas la rafale', () => {
  // On martele le bouton en fuyant : si ces appuis-la armaient le geste, la
  // rafale partirait toute seule au prochain appui utile.
  const etat = areneNue();
  const joueur = placer(etat, 0, 2, 5);
  joueur.bombes = 3;
  joueur.dir = DROITE;

  // Trois appuis de suite debout sur sa propre bombe : le premier pose, les
  // autres ne peuvent rien faire — et n arment rien.
  pas(etat, entree(0, { poser: true }));
  avancerDe(etat, DOUBLE_POSE_PAS + 1, entree(0, {}));
  pas(etat, entree(0, { poser: true }));
  pas(etat, entree(0, { poser: true }));
  assert.equal(etat.bombes.length, 1, 'aucune rafale a partir d appuis vides');

  // Il s ecarte, et pose de nouveau : une seule bombe, sous ses pieds.
  placer(etat, 0, 4, 5);
  pas(etat, entree(0, { poser: true }));
  assert.equal(etat.bombes.length, 2);
  assert.ok(bombeSur(etat, 4, 5));
  assert.equal(bombeSur(etat, 5, 5), null, 'et rien devant lui');
});
