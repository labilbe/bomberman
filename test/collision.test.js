import test from 'node:test';
import assert from 'node:assert/strict';

import { pas, avancerDe } from '../src/engine/pas.js';
import { recentrer, franchissable } from '../src/engine/collision.js';
import { caseAxe, centreAxe, boiteSurCase } from '../src/engine/grille.js';
import {
  UNITES,
  DEMI_BOMBER,
  VITESSE_BASE,
  VITESSE_MAX,
  HAUT,
  BAS,
  GAUCHE,
  DROITE,
} from '../src/engine/constantes.js';
import { areneNue, brique, placer, entree } from './aide.js';

test('recentrer converge sans jamais depasser le centre', () => {
  const centre = centreAxe(3);
  let v = centre - 100;
  for (let i = 0; i < 50; i += 1) v = recentrer(v, 20);
  assert.equal(v, centre);

  // Le dernier pas est tronque : on ne saute pas par-dessus le centre.
  assert.equal(recentrer(centre - 7, 20), centre);
  assert.equal(recentrer(centre + 7, 20), centre);
  assert.equal(recentrer(centre, 20), centre);
});

test('un bomber ne traverse pas un mur, meme a vitesse maximale', () => {
  for (const vitesse of [VITESSE_BASE, VITESSE_MAX, VITESSE_MAX * 3]) {
    const etat = areneNue();
    const joueur = placer(etat, 0, 1, 1);
    joueur.vitesse = vitesse;
    avancerDe(etat, 60, entree(0, { dir: GAUCHE }));
    // La colonne 0 est un mur : la boite doit rester dans la colonne 1.
    assert.equal(caseAxe(joueur.x - DEMI_BOMBER), 1, `vitesse ${vitesse}`);
    assert.ok(joueur.x >= UNITES + DEMI_BOMBER, `vitesse ${vitesse}`);
  }
});

test('un bomber cale contre le mur au lieu de s arreter a distance', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 1);
  avancerDe(etat, 40, entree(0, { dir: HAUT }));
  // Au contact : le haut de la boite est a une sous-unite de la ligne 1.
  assert.equal(joueur.y - DEMI_BOMBER, UNITES + 1);
});

test('le recentrage debloque un virage amorce trop tot', () => {
  // Couloir vertical en colonne 1, ouvert vers la droite en (2,3) seulement.
  const etat = areneNue();
  brique(etat, 2, 1);
  brique(etat, 2, 2);
  const joueur = placer(etat, 0, 1, 1);

  // On descend jusqu a ce que le CENTRE du bomber soit dans la ligne 3, mais pas
  // encore au milieu : sa boite mord encore sur la ligne 2, dont la sortie est
  // muree. C'est le virage demande une poignee de sous-unites trop tot, le geste
  // qui rend injouables les clones sans recentrage.
  avancerDe(etat, 19, entree(0, { dir: BAS }));
  assert.equal(caseAxe(joueur.y), 3);
  assert.notEqual(joueur.y, centreAxe(3), 'le bomber doit etre decale dans sa ligne');

  avancerDe(etat, 40, entree(0, { dir: DROITE }));
  assert.ok(caseAxe(joueur.x) >= 2, `x = ${joueur.x}, case ${caseAxe(joueur.x)}`);
  assert.equal(joueur.y, centreAxe(3), 'il doit s etre range dans le couloir');
});

test('on traverse sa propre bombe tant qu on est dessus, et jamais apres', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 1);

  pas(etat, entree(0, { poser: true }));
  const bombe = etat.bombes[0];
  assert.equal(joueur.surBombe, bombe.id);
  assert.equal(franchissable(etat, joueur, 1, 1), true);

  // On s eloigne jusqu a ne plus toucher la case de la bombe.
  let sorties = 0;
  for (let i = 0; i < 60; i += 1) {
    pas(etat, entree(0, { dir: DROITE }));
    if (joueur.surBombe === null) {
      sorties += 1;
      break;
    }
  }
  assert.equal(sorties, 1, 'la permission doit tomber en sortant');
  assert.equal(boiteSurCase(joueur.x, joueur.y, 1, 1), false);
  assert.equal(franchissable(etat, joueur, 1, 1), false);

  // Et on ne peut plus y revenir.
  avancerDe(etat, 40, entree(0, { dir: GAUCHE }));
  assert.equal(boiteSurCase(joueur.x, joueur.y, 1, 1), false);
  assert.equal(caseAxe(joueur.x), 2);
});

test('la permission tombe aussi quand la bombe explose sous les pieds', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 1);
  pas(etat, entree(0, { poser: true }));
  const id = joueur.surBombe;
  assert.ok(id);

  // Immobile : il meurt, et sa permission ne doit pas survivre a la bombe,
  // dont l identifiant sera reattribue a la prochaine pose.
  avancerDe(etat, 200, entree(0, {}));
  assert.equal(etat.bombes.length, 0);
  assert.equal(joueur.surBombe, null);
  assert.equal(joueur.vivant, false);
});

test('les bombers ne se bloquent pas entre eux', () => {
  const etat = areneNue({ places: 2 });
  const un = placer(etat, 0, 1, 1);
  placer(etat, 1, 3, 1);
  avancerDe(etat, 40, entree(0, { dir: DROITE }));
  assert.ok(caseAxe(un.x) >= 3, 'le premier doit avoir traverse le second');
});

test('une direction absente laisse le bomber immobile', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 1);
  const avant = { x: joueur.x, y: joueur.y };
  avancerDe(etat, 30, []);
  assert.deepEqual({ x: joueur.x, y: joueur.y }, avant);
  assert.equal(joueur.marche, false);
});

/**
 * Pousse un bomber dans une direction et rend la case ou il finit.
 *
 * L'arene nue a ses piliers en (pair, pair) : (4,5) est libre, (5,5) aussi. On
 * place donc le rocher a la main pour maitriser exactement ce qui bloque.
 */
function pousser(etat, joueur, dir, pasDeTemps = 40) {
  for (let i = 0; i < pasDeTemps; i += 1) pas(etat, entree(joueur.place, { dir }));
  return { cx: caseAxe(joueur.x), cy: caseAxe(joueur.y) };
}

test('colle au bord d un pilier, le bomber se range dans le couloir libre', () => {
  // Le defaut corrige : le recentrage ramenait le bomber au centre de SA
  // rangee — celle qui est bloquee — donc il le poussait dans le pilier au lieu
  // de l en sortir. Il fallait lacher la touche, se decaler, repartir.
  //
  // La situation est celle qu'on vit tout le temps : on longe la trame de
  // piliers, qui occupent les cases (pair, pair). Depuis (3,4) vers la droite,
  // le pilier (4,4) bloque, mais les rangees 3 et 5 sont ouvertes.
  const etat = areneNue({ places: 1 });
  const joueur = placer(etat, 0, 3, 4);
  joueur.y = centreAxe(4) - Math.round(0.3 * UNITES);

  const arrivee = pousser(etat, joueur, DROITE);
  assert.equal(arrivee.cy, 3, 'il s est range dans la rangee du dessus');
  assert.ok(arrivee.cx > 3, 'et il a franchi le pilier');
});

test('le glissement marche aussi vers le bas, et sur l axe vertical', () => {
  const bas = areneNue({ places: 1 });
  const a = placer(bas, 0, 3, 4);
  a.y = centreAxe(4) + Math.round(0.3 * UNITES);
  assert.equal(pousser(bas, a, DROITE).cy, 5, 'vers le bas');

  const vertical = areneNue({ places: 1 });
  const b = placer(vertical, 0, 4, 3);
  b.x = centreAxe(4) - Math.round(0.3 * UNITES);
  assert.equal(pousser(vertical, b, BAS).cx, 3, 'et sur l axe vertical');
});

test('centre sur son couloir, le bomber bute franchement', () => {
  // Le glissement ne doit pas se declencher tout seul : un bomber bien aligne
  // qui pousse contre un mur reste contre le mur. Sinon on derive sans l avoir
  // demande, et on ne peut plus se coller a un pilier pour s abriter.
  const etat = areneNue({ places: 1 });
  const joueur = placer(etat, 0, 3, 4);
  const depart = joueur.y;

  const arrivee = pousser(etat, joueur, DROITE);
  assert.equal(arrivee.cx, 3, 'il reste bloque');
  assert.equal(joueur.y, depart, 'et ne derive pas');
});

test('le seuil de glissement est la boite du bomber, pas une valeur choisie', () => {
  // Le bomber glisse des que sa boite MORD le couloir voisin, et pas avant :
  // une demi-tuile moins la demi-boite, soit 0,13 tuile de decalage.
  const seuil = UNITES / 2 - DEMI_BOMBER;
  const essai = (decalage) => {
    const etat = areneNue({ places: 1 });
    const joueur = placer(etat, 0, 3, 4);
    joueur.y = centreAxe(4) - decalage;
    return pousser(etat, joueur, DROITE).cx > 3;
  };

  assert.equal(essai(seuil), false, 'juste en deca du seuil : on bute');
  assert.equal(essai(seuil + 2), true, 'juste au-dela : on glisse');
});
