/**
 * Entrees des bombers : ce que veut un joueur a un pas donne.
 *
 * Deux natures de champs, et la distinction compte :
 *
 * - `dir` est un ETAT maintenu. Tant que la touche est enfoncee, la direction
 *   reste, et un message perdu n'y change rien : le suivant la rappellera.
 * - `poser` et `declencher` sont des IMPULSIONS, vraies une seule fois. Le
 *   moteur les consomme au pas suivant. Un etat maintenu aurait pose une bombe
 *   par pas tant que la touche est tenue ; une impulsion perdue, elle, perd
 *   juste une bombe — et le reseau ne la perd pas, puisqu'elle est renvoyee
 *   jusqu'a ce que le relais l'accuse.
 *
 * `normaliser` existe parce que ces objets viennent du reseau : ils sont
 * fabriques par un inconnu, et rien ne garantit qu'ils ressemblent a cela.
 */

/** @typedef {{ dir: -1|0|1|2|3, poser: boolean, declencher: boolean }} Entree */

/** @type {Entree} */
export const ENTREE_VIDE = Object.freeze({ dir: -1, poser: false, declencher: false });

/**
 * Ramene n'importe quoi a une entree utilisable. -1 signifie « immobile ».
 *
 * @param {unknown} brut
 * @returns {Entree}
 */
export function normaliser(brut) {
  if (!brut || typeof brut !== 'object') return { ...ENTREE_VIDE };
  const source = /** @type {Record<string, unknown>} */ (brut);
  const dir = Number(source.dir);
  return {
    dir: Number.isInteger(dir) && dir >= 0 && dir <= 3 ? /** @type {0|1|2|3} */ (dir) : -1,
    poser: source.poser === true,
    declencher: source.declencher === true,
  };
}

/**
 * Un jeu d'entrees vides, une par place.
 *
 * @param {number} nb
 * @returns {Entree[]}
 */
export function entreesVides(nb) {
  return Array.from({ length: nb }, () => ({ ...ENTREE_VIDE }));
}
