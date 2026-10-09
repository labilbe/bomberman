/**
 * Outils des tests du moteur.
 *
 * Les tests de regles se font sur une arene NUE — murs du damier seulement,
 * aucune brique, aucun bonus — et non sur une arene tiree au sort. Une assertion
 * qui depend de l'endroit ou le hasard a mis une brique ne dit rien de la regle
 * qu'elle pretend verifier, et elle casse le jour ou la densite change.
 */

import { creerEtat } from '../src/engine/etat.js';
import { estMurDur } from '../src/engine/arene.js';
import { index, centreDe } from '../src/engine/grille.js';
import { COLS, ROWS, VIDE, DUR, BRIQUE } from '../src/engine/constantes.js';

/**
 * Un etat sans brique ni bonus.
 *
 * @param {{ places?: number, graine?: number }} options
 */
export function areneNue({ places = 2, graine = 1 } = {}) {
  const etat = creerEtat({ graine, places });
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      etat.tuiles[index(x, y)] = estMurDur(x, y) ? DUR : VIDE;
      etat.objets[index(x, y)] = 0;
    }
  }
  etat.version = 0;
  return etat;
}

/** Pose une brique. */
export function brique(etat, cx, cy) {
  etat.tuiles[index(cx, cy)] = BRIQUE;
}

/** Pose un bonus visible. */
export function objet(etat, cx, cy, code) {
  etat.objets[index(cx, cy)] = code;
}

/** Teleporte un bomber au centre d'une case. */
export function placer(etat, place, cx, cy) {
  const joueur = etat.joueurs[place];
  const centre = centreDe(cx, cy);
  joueur.x = centre.x;
  joueur.y = centre.y;
  return joueur;
}

/** Une entree pour une seule place, les autres immobiles. */
export function entree(place, { dir = -1, poser = false, declencher = false } = {}) {
  const entrees = [];
  entrees[place] = { dir, poser, declencher };
  return entrees;
}

/** Les evenements d'un type donne au dernier pas. */
export function evenements(etat, nom) {
  return etat.evenements.filter((item) => item[0] === nom);
}
