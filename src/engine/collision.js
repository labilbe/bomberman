/**
 * Deplacement des bombers, et c'est le module le plus delicat du moteur.
 *
 * Le bomber est une boite de 0,74 tuile dans un couloir d'une tuile : il reste
 * 0,26 tuile de jeu. Sans recentrage, on se coince a chaque intersection des
 * qu'on amorce un virage une sous-unite trop tot — et c'est precisement la
 * raison pour laquelle la plupart des clones de Bomberman sont injouables.
 *
 * Le traitement tient en deux regles, appliquees a chaque pas :
 *
 * 1. On ne bouge que sur UN axe. Pas de diagonale : ce jeu se joue en grille.
 * 2. Pendant qu'on avance sur un axe, on se RECENTRE sur l'autre. Le virage
 *    demande trop tot n'est donc pas refuse, il est differe de quelques pas
 *    pendant lesquels le bomber se range tout seul dans le couloir. C'est ce qui
 *    donne l'impression qu'il « cherche » le passage, et cela remplace a lui
 *    seul un glissement d'angle explicite.
 *
 * Les bombers ne se bloquent pas entre eux, comme dans Atomic Bomberman : a
 * quatre dans un couloir, se gener serait la premiere cause de mort, et la plus
 * injuste.
 */

import { VECTEURS, DEMI_BOMBER, UNITES } from './constantes.js';
import { caseDe, estLibre, casesTouchees, caseAxe, centreAxe, boiteSurCase } from './grille.js';
import { bombeSur, bombeDe, pousser } from './bombes.js';

/**
 * Le bomber peut-il occuper cette case ?
 *
 * Sa propre bombe ne le bloque pas tant qu'il est dessus : c'est `surBombe` qui
 * porte cette permission, accordee a la pose et retiree des qu'il en sort.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Joueur} joueur
 */
export function franchissable(etat, joueur, cx, cy) {
  if (!estLibre(caseDe(etat, cx, cy))) return false;
  const bombe = bombeSur(etat, cx, cy);
  if (bombe === null) return true;
  return bombe.id === joueur.surBombe;
}

/** Toutes les cases touchees par la boite a cette position sont-elles libres ? */
function boiteLibre(etat, joueur, x, y) {
  for (const { cx, cy } of casesTouchees(x, y)) {
    if (!franchissable(etat, joueur, cx, cy)) return false;
  }
  return true;
}

/**
 * Ramene une coordonnee vers le centre de sa case, d'au plus `vitesse`.
 *
 * Le centre de la case courante est toujours atteignable : le bomber y est deja
 * par definition, puisque c'est sa propre case. Le recentrage ne peut donc
 * jamais le pousser dans un mur.
 *
 * @param {number} valeur
 * @param {number} vitesse
 */
export function recentrer(valeur, vitesse) {
  const cible = centreAxe(caseAxe(valeur));
  const ecart = cible - valeur;
  if (ecart === 0) return valeur;
  if (Math.abs(ecart) <= vitesse) return cible;
  return valeur + Math.sign(ecart) * vitesse;
}

/**
 * Glissement d'angle : contourner l'obstacle en se rangeant dans le couloir
 * voisin, quand on le mord deja.
 *
 * Le recentrage de la regle 2 ne suffit pas, et c'est le defaut que ceci corrige.
 * Il ramene le bomber au centre de SA case — celle dont le passage est bloque.
 * Colle au bord haut d'un rocher avec un couloir libre juste au-dessus, le
 * joueur etait donc tire vers le bas, dans le rocher, exactement a l'inverse de
 * ce qu'il demandait. Il fallait lacher la touche, remonter, puis repartir.
 *
 * La regle d'engagement n'invente aucune tolerance : le bomber glisse si sa
 * BOITE MORD DEJA la case voisine, et si le passage y est libre. La boite fait
 * 0,74 tuile, donc elle ne peut en mordre qu'une a la fois — il n'y a jamais
 * d'ambiguite sur le cote, et jamais de glissement depuis une position centree,
 * ou le blocage est franc et doit le rester.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Joueur} joueur
 * @param {{ dx: number, dy: number }} v
 * @param {number} vitesse
 * @returns {boolean} vrai si le bomber s'est range
 */
function contourner(etat, joueur, v, vitesse) {
  const cx = caseAxe(joueur.x);
  const cy = caseAxe(joueur.y);

  // Le regard porte sur la CASE suivante, pas sur le pixel suivant, et c'est le
  // point qui fait tout marcher. Teste au pixel, l'obstacle n'est vu qu'une fois
  // colle dessus — or le recentrage avance a la meme vitesse que le bomber et a
  // deja eu le temps de le ramener au centre du couloir bloque. Le glissement
  // n'avait alors plus rien a mordre, et ne s'engageait qu'a partir d'un
  // decalage enorme. A l'echelle de la case, le passage bouche se voit assez tot
  // pour que le recentrage ne soit jamais lance dans le mauvais sens.
  if (franchissable(etat, joueur, cx + v.dx, cy + v.dy)) return false;

  const horizontal = v.dx !== 0;
  // L'axe du glissement est PERPENDICULAIRE a celui du deplacement demande.
  const valeur = horizontal ? joueur.y : joueur.x;
  const fixe = horizontal ? joueur.x : joueur.y;

  for (const cote of [-1, 1]) {
    const voisine = (horizontal ? cy : cx) + cote;
    // Mord-on deja le couloir voisin ? Sinon, on ne glisse pas : un bomber
    // centre sur son couloir doit buter franchement.
    if (caseAxe(valeur + cote * DEMI_BOMBER) !== voisine) continue;

    // Il faut pouvoir s'y ranger ET en sortir par la direction demandee.
    const dedans = horizontal ? [cx, voisine] : [voisine, cy];
    const apres = horizontal ? [cx + v.dx, voisine] : [voisine, cy + v.dy];
    if (!franchissable(etat, joueur, dedans[0], dedans[1])) continue;
    if (!franchissable(etat, joueur, apres[0], apres[1])) continue;

    // On s'y range d'un pas au plus, en verifiant la position intermediaire :
    // le couloir est libre a l'arrivee, pas forcement sur tout le trajet.
    const centre = centreAxe(voisine);
    const ecart = centre - valeur;
    const avance = Math.abs(ecart) <= vitesse ? centre : valeur + Math.sign(ecart) * vitesse;
    if (!(horizontal ? boiteLibre(etat, joueur, fixe, avance) : boiteLibre(etat, joueur, avance, fixe))) {
      continue;
    }

    if (horizontal) joueur.y = avance;
    else joueur.x = avance;
    return true;
  }

  return false;
}

/**
 * Relache la permission de traverser sa propre bombe.
 *
 * Le moment du relachement est le piege : trop tot — au franchissement du
 * centre — et le bomber se retrouve a cheval sur sa bombe, donc bloque dans le
 * vide ; trop tard, et il pourrait y revenir. On relache donc exactement quand
 * la boite ne touche PLUS DU TOUT la case de la bombe.
 *
 * On relache aussi quand la bombe a disparu : son identifiant serait sinon
 * recycle, et le bomber heriterait d'une permission sur une bombe etrangere.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Joueur} joueur
 */
export function sortirDeSaBombe(etat, joueur) {
  if (joueur.surBombe === null) return;
  const bombe = bombeDe(etat, joueur.surBombe);
  if (bombe === null) {
    joueur.surBombe = null;
    return;
  }
  if (!boiteSurCase(joueur.x, joueur.y, bombe.cx, bombe.cy)) joueur.surBombe = null;
}

/**
 * Cale le bomber contre l'obstacle qu'il vient de heurter, pour qu'il le touche
 * au lieu de s'arreter a une sous-unite pres. La position calee est verifiee :
 * si elle n'est pas libre — cas d'un blocage en biais — on ne cale pas.
 */
function caler(etat, joueur, v) {
  if (v.dx !== 0) {
    const colonne = caseAxe(joueur.x + v.dx * DEMI_BOMBER) + v.dx;
    const cible =
      v.dx > 0 ? colonne * UNITES - DEMI_BOMBER - 1 : (colonne + 1) * UNITES + DEMI_BOMBER + 1;
    if (Math.sign(cible - joueur.x) === v.dx && boiteLibre(etat, joueur, cible, joueur.y)) {
      joueur.x = cible;
    }
    return;
  }
  const ligne = caseAxe(joueur.y + v.dy * DEMI_BOMBER) + v.dy;
  const cible =
    v.dy > 0 ? ligne * UNITES - DEMI_BOMBER - 1 : (ligne + 1) * UNITES + DEMI_BOMBER + 1;
  if (Math.sign(cible - joueur.y) === v.dy && boiteLibre(etat, joueur, joueur.x, cible)) {
    joueur.y = cible;
  }
}

/**
 * Le bomber bute sur une bombe : s'il a le kick, il la pousse.
 *
 * Declenche par la collision et non par une touche : c'est ainsi dans Atomic
 * Bomberman, et cela evite une sixieme commande a expliquer.
 */
function tenterKick(etat, joueur, dir) {
  if (!joueur.kick) return;
  const v = VECTEURS[dir];
  const cx = caseAxe(joueur.x) + v.dx;
  const cy = caseAxe(joueur.y) + v.dy;
  const bombe = bombeSur(etat, cx, cy);
  if (bombe !== null && bombe.id !== joueur.surBombe) pousser(etat, bombe, dir);
}

/**
 * Deplace un bomber d'un pas selon son intention.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Joueur} joueur
 * @param {import('./entrees.js').Entree} entree
 */
export function deplacerJoueur(etat, joueur, entree) {
  if (!joueur.vivant) return;
  sortirDeSaBombe(etat, joueur);

  if (entree.dir < 0) {
    joueur.marche = false;
    return;
  }

  joueur.dir = entree.dir;
  const v = VECTEURS[entree.dir];
  const vitesse = joueur.vitesse;

  if (v.dx !== 0) {
    const vise = joueur.x + v.dx * vitesse;
    if (boiteLibre(etat, joueur, vise, joueur.y)) {
      joueur.x = vise;
      joueur.marche = true;
    } else {
      joueur.marche = false;
      caler(etat, joueur, v);
      tenterKick(etat, joueur, entree.dir);
    }
    // Le glissement passe AVANT le recentrage, et l'exclut : les deux tirent sur
    // le meme axe, en sens contraires. Il est tente meme quand on avance encore,
    // parce qu'il regarde une case plus loin — s'y prendre une fois bloque
    // serait trop tard, le recentrage aurait deja efface le decalage.
    if (contourner(etat, joueur, v, vitesse)) joueur.marche = true;
    else joueur.y = recentrer(joueur.y, vitesse);
  } else {
    const vise = joueur.y + v.dy * vitesse;
    if (boiteLibre(etat, joueur, joueur.x, vise)) {
      joueur.y = vise;
      joueur.marche = true;
    } else {
      joueur.marche = false;
      caler(etat, joueur, v);
      tenterKick(etat, joueur, entree.dir);
    }
    if (contourner(etat, joueur, v, vitesse)) joueur.marche = true;
    else joueur.x = recentrer(joueur.x, vitesse);
  }

  sortirDeSaBombe(etat, joueur);
}

/**
 * Deplace tous les bombers.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./entrees.js').Entree[]} entrees indexees par place
 */
export function deplacerJoueurs(etat, entrees) {
  for (const joueur of etat.joueurs) {
    deplacerJoueur(etat, joueur, entrees[joueur.place] ?? { dir: -1, poser: false, declencher: false });
  }
}
