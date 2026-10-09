/**
 * Lecture sur disque des tables de couleurs du jeu.
 *
 * Tout le raisonnement est dans `src/extraction/couleurs.js`, qui ne connait que
 * des octets. Ici il ne reste que d'aller les chercher : c'est la seule chose
 * qu'un script en ligne de commande peut faire et qu'une page ne peut pas.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { couleursJoueurs, COULEURS } from '../../src/extraction/couleurs.js';

export { COULEURS };

/**
 * Lit la couleur de chaque joueur dans une installation du jeu.
 *
 * @param {string} racine dossier contenant COLOR.PAL et les .RMP
 * @returns {{ teinte: number, saturation: number, clarte: number }[]}
 */
export function lireCouleursJoueurs(racine) {
  const pal = readFileSync(join(racine, 'COLOR.PAL'));
  const rmps = [];
  for (let n = 0; n < COULEURS; n += 1) rmps.push(readFileSync(join(racine, `${n}.RMP`)));
  return couleursJoueurs(pal, rmps);
}
