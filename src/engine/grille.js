/**
 * Lecture et ecriture de la grille, et geometrie des boites.
 *
 * La grille est un Uint8Array a plat plutot qu'un tableau de tableaux : elle est
 * clonee a chaque manche, parcourue soixante fois par seconde par le relais et
 * serialisee pour le reseau. Un tampon d'octets se copie et s'encode d'un bloc,
 * la ou des tableaux imbriques obligeraient a boucler.
 *
 * `poserCase` est le SEUL chemin d'ecriture, et il incremente `etat.version`.
 * C'est de cela que depend la reparation des desynchronisations : le client ne
 * recoit l'arene en entier qu'au debut de la manche, puis la modifie par
 * evenements ; en comparant sa version a celle du relais, il sait tout de suite
 * qu'il a manque quelque chose, au lieu de jouer sur une arene fantome.
 */

import { COLS, ROWS, VIDE, DUR, BRIQUE, UNITES, DEMI_BOMBER } from './constantes.js';

/** @param {number} x @param {number} y */
export function index(x, y) {
  return y * COLS + x;
}

/** Vrai si la case est dans la grille. */
export function dansArene(x, y) {
  return x >= 0 && y >= 0 && x < COLS && y < ROWS;
}

/**
 * Nature d'une case. Hors arene, on repond DUR : les propagations de flamme et
 * les deplacements s'arretent alors sans avoir a tester les bords deux fois.
 *
 * @param {{ tuiles: Uint8Array }} etat
 */
export function caseDe(etat, x, y) {
  if (!dansArene(x, y)) return DUR;
  return etat.tuiles[index(x, y)];
}

/**
 * Change une case et marque l'arene comme modifiee.
 *
 * @param {{ tuiles: Uint8Array, version: number }} etat
 */
export function poserCase(etat, x, y, valeur) {
  if (!dansArene(x, y)) return;
  etat.tuiles[index(x, y)] = valeur;
  etat.version += 1;
}

/** Une case arrete-t-elle un bomber et une flamme ? */
export function estSolide(valeur) {
  return valeur === DUR || valeur === BRIQUE;
}

/** Vrai si la case est une brique destructible. */
export function estBrique(valeur) {
  return valeur === BRIQUE;
}

/**
 * Vrai si la case est traversable, sans tenir compte des bombes.
 *
 * Une brique detruite passe directement a VIDE, sans etat intermediaire de
 * ruine : les gravats sont une animation du rendu, declenchee par l'evenement
 * `brick`. Une case « en ruine » dans la grille aurait demande une seconde
 * ecriture quelques pas plus tard, donc une seconde incrementation de version a
 * reproduire a l'identique chez le client — toute une classe de desynchronisation
 * pour un effet purement decoratif.
 */
export function estLibre(valeur) {
  return valeur === VIDE;
}

/** Centre d'une case, en sous-unites. */
export function centreDe(cx, cy) {
  return { x: cx * UNITES + UNITES / 2, y: cy * UNITES + UNITES / 2 };
}

/** Coordonnee du centre d'une case sur un axe. */
export function centreAxe(c) {
  return c * UNITES + UNITES / 2;
}

/** Case occupee par une position en sous-unites. */
export function caseAt(x, y) {
  return { cx: Math.floor(x / UNITES), cy: Math.floor(y / UNITES) };
}

/** Case occupee sur un seul axe. */
export function caseAxe(v) {
  return Math.floor(v / UNITES);
}

/**
 * Boite d'un bomber autour d'une position, en sous-unites.
 *
 * @returns {{ g: number, d: number, h: number, b: number }}
 */
export function boite(x, y) {
  return {
    g: x - DEMI_BOMBER,
    d: x + DEMI_BOMBER,
    h: y - DEMI_BOMBER,
    b: y + DEMI_BOMBER,
  };
}

/**
 * Cases touchees par une boite. Une a quatre cases, jamais plus : la boite est
 * plus petite qu'une tuile.
 *
 * @returns {{ cx: number, cy: number }[]}
 */
export function casesTouchees(x, y) {
  const b = boite(x, y);
  const gx = caseAxe(b.g);
  const dx = caseAxe(b.d);
  const hy = caseAxe(b.h);
  const by = caseAxe(b.b);
  const cases = [];
  for (let cy = hy; cy <= by; cy += 1) {
    for (let cx = gx; cx <= dx; cx += 1) cases.push({ cx, cy });
  }
  return cases;
}

/**
 * Vrai si la boite d'un bomber chevauche une case donnee.
 *
 * Comparaisons strictes : un bomber exactement colle au bord d'une case n'est
 * pas dedans. Sans cela, une flamme tuerait a travers un mur d'une tuile.
 */
export function boiteSurCase(x, y, cx, cy) {
  const b = boite(x, y);
  return (
    b.d > cx * UNITES && b.g < (cx + 1) * UNITES && b.b > cy * UNITES && b.h < (cy + 1) * UNITES
  );
}

export { COLS, ROWS, VIDE, DUR, BRIQUE };
