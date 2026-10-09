/**
 * Bombes : pose, meche, kick, detonateur.
 *
 * Une bombe posee occupe TOUJOURS une case entiere, reperee par `cx, cy` en
 * tuiles. Une bombe kickee garde en plus `glisse.x / glisse.y` en sous-unites
 * pour l'affichage, mais son occupation logique reste la case `cx, cy` jusqu'a
 * ce qu'elle atteigne le centre de la suivante. C'est ce qui evite d'avoir a
 * gerer une bombe a cheval sur deux cases — et une bombe a cheval, c'est une
 * flamme dont on ne sait pas d'ou elle part.
 *
 * Les bombes sont rangees par ordre de pose, et leur identifiant croit. Cet
 * ordre EST le determinisme : les meches sont relevees par id croissant, et le
 * detonateur declenche la plus ancienne.
 */

import { MECHE_PAS, VECTEURS, VITESSE_BOMBE, UNITES } from './constantes.js';
import { caseDe, estLibre, caseAxe, centreAxe, boiteSurCase } from './grille.js';
import { noter } from './etat.js';

/** La bombe posee sur cette case, ou null. */
export function bombeSur(etat, cx, cy) {
  for (const bombe of etat.bombes) {
    if (bombe.cx === cx && bombe.cy === cy) return bombe;
  }
  return null;
}

/** La bombe portant cet identifiant, ou null. */
export function bombeDe(etat, id) {
  if (id === null || id === undefined) return null;
  for (const bombe of etat.bombes) {
    if (bombe.id === id) return bombe;
  }
  return null;
}

/**
 * Peut-on poser ici, maintenant ?
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Joueur} joueur
 */
export function peutPoser(etat, joueur) {
  if (!joueur.vivant) return false;
  if (joueur.posees >= joueur.bombes) return false;
  const cx = caseAxe(joueur.x);
  const cy = caseAxe(joueur.y);
  return bombeSur(etat, cx, cy) === null;
}

/**
 * Pose une bombe sous les pieds du bomber.
 *
 * `surBombe` est arme du meme geste : sans cela le bomber serait bloque par sa
 * propre bombe a l'instant ou il la pose, et le jeu entier — qui consiste a
 * poser puis fuir — deviendrait injouable.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Joueur} joueur
 * @returns {import('./etat.js').Bombe | null}
 */
export function poser(etat, joueur) {
  if (!peutPoser(etat, joueur)) return null;
  const cx = caseAxe(joueur.x);
  const cy = caseAxe(joueur.y);
  const bombe = {
    id: etat.prochainId,
    cx,
    cy,
    place: joueur.place,
    portee: joueur.portee,
    meche: MECHE_PAS,
    glisse: null,
  };
  etat.prochainId += 1;
  etat.bombes.push(bombe);
  joueur.posees += 1;
  joueur.surBombe = bombe.id;
  noter(etat, ['bomb', cx, cy, joueur.place]);
  return bombe;
}

/**
 * Fait bruler les meches d'un pas et releve celles arrivees a terme.
 *
 * Releve par ordre d'identifiant : si deux meches finissent au meme pas, c'est
 * la plus ancienne qui part la premiere, et le resultat ne depend pas de l'ordre
 * du tableau.
 *
 * @param {import('./etat.js').Etat} etat
 * @returns {import('./etat.js').Bombe[]}
 */
export function avancerMeches(etat) {
  const terminees = [];
  for (const bombe of etat.bombes) {
    bombe.meche -= 1;
    if (bombe.meche <= 0) terminees.push(bombe);
  }
  return terminees.sort((a, b) => a.id - b.id);
}

/** Une bombe peut-elle glisser sur cette case ? */
function caseOuvertePourBombe(etat, cx, cy) {
  if (!estLibre(caseDe(etat, cx, cy))) return false;
  if (bombeSur(etat, cx, cy)) return false;
  // Un bomber arrete la bombe : sinon elle le traverserait, et il mourrait d'une
  // bombe qu'il n'a jamais vue passer.
  for (const joueur of etat.joueurs) {
    if (joueur.vivant && boiteSurCase(joueur.x, joueur.y, cx, cy)) return false;
  }
  return true;
}

/**
 * Lance une bombe dans une direction, si la voie est libre.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Bombe} bombe
 * @param {number} dir
 * @returns {boolean} vrai si elle part
 */
export function pousser(etat, bombe, dir) {
  if (bombe.glisse) return false;
  const v = VECTEURS[dir];
  if (!caseOuvertePourBombe(etat, bombe.cx + v.dx, bombe.cy + v.dy)) return false;
  bombe.glisse = { dir, x: centreAxe(bombe.cx), y: centreAxe(bombe.cy) };
  noter(etat, ['kick', bombe.id, dir]);
  return true;
}

/**
 * Fait avancer les bombes kickees d'un pas.
 *
 * Appele AVANT les bombers : une bombe qui bougerait apres eux les traverserait
 * d'un pas, puisque chacun verrait l'autre a sa position d'avant.
 *
 * Le recalage sur le centre se fait par affectation, jamais par division : la
 * bombe retombe donc exactement sur une case, et une bombe decalee d'une
 * sous-unite ne fait pas partir sa flamme de travers.
 *
 * @param {import('./etat.js').Etat} etat
 */
export function avancerGlissements(etat) {
  for (const bombe of etat.bombes) {
    if (!bombe.glisse) continue;
    const v = VECTEURS[bombe.glisse.dir];
    const cibleX = centreAxe(bombe.cx + v.dx);
    const cibleY = centreAxe(bombe.cy + v.dy);
    const restantX = cibleX - bombe.glisse.x;
    const restantY = cibleY - bombe.glisse.y;
    const restant = Math.abs(restantX) + Math.abs(restantY);

    if (restant > VITESSE_BOMBE) {
      bombe.glisse.x += Math.sign(restantX) * VITESSE_BOMBE;
      bombe.glisse.y += Math.sign(restantY) * VITESSE_BOMBE;
      continue;
    }

    // Elle vient d'atteindre le centre de la case suivante : elle l'occupe.
    bombe.cx += v.dx;
    bombe.cy += v.dy;
    bombe.glisse.x = cibleX;
    bombe.glisse.y = cibleY;

    if (!caseOuvertePourBombe(etat, bombe.cx + v.dx, bombe.cy + v.dy)) {
      bombe.glisse = null;
    }
  }
}

/**
 * Declenche a distance la plus ancienne bombe du bomber.
 *
 * La plus ancienne, et non toutes : c'est le comportement d'Atomic Bomberman, et
 * c'est aussi le seul qui laisse jouer — tout faire sauter d'un coup prive le
 * detonateur de son interet, qui est de choisir l'instant de chaque bombe.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Joueur} joueur
 * @returns {import('./etat.js').Bombe | null}
 */
export function declencher(etat, joueur) {
  if (!joueur.detonateur || !joueur.vivant) return null;
  let choisie = null;
  for (const bombe of etat.bombes) {
    if (bombe.place !== joueur.place) continue;
    if (choisie === null || bombe.id < choisie.id) choisie = bombe;
  }
  return choisie;
}

/** Distance restante avant que la bombe n'atteigne le centre de sa case suivante. */
export function avanceeGlissement(bombe) {
  if (!bombe.glisse) return 0;
  const v = VECTEURS[bombe.glisse.dir];
  const parcouru =
    Math.abs(bombe.glisse.x - centreAxe(bombe.cx)) + Math.abs(bombe.glisse.y - centreAxe(bombe.cy));
  return v.dx || v.dy ? parcouru / UNITES : 0;
}
