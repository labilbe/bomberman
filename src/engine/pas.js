/**
 * Un pas de simulation, et l'ordre dans lequel il se deroule.
 *
 * Il n'y a pas de parametre de duree, volontairement : un pas de duree variable
 * ferait dependre la physique de la cadence d'affichage, et deux machines ne
 * tomberaient jamais sur le meme resultat. C'est `horloge.js` qui convertit du
 * temps mural en un nombre entier d'appels a `pas`.
 *
 * L'ORDRE CI-DESSOUS EST LE CONTRAT DU MOTEUR. Trois points s'y jouent, et
 * chacun corrige une injustice qu'on ne voit qu'en jouant :
 *
 * - Poser AVANT de se deplacer. « Poser puis fuir » est le geste fondamental du
 *   jeu. Si l'on bougeait d'abord, la bombe apparaitrait sur la case d'arrivee
 *   et le joueur mourrait de son propre reflexe.
 * - Les bombes kickees AVANT les bombers. Une bombe qui bougerait apres eux les
 *   traverserait d'un pas, chacun voyant l'autre a sa position d'avant.
 * - Bruler AVANT de ramasser. On ne ramasse pas en mourant, et un bonus sous une
 *   flamme est detruit et non empoche.
 */

import { FIN_MANCHE_PAS } from './constantes.js';
import { ENTREE_VIDE } from './entrees.js';
import { noter } from './etat.js';
import { poser, declencher, avancerMeches, avancerGlissements } from './bombes.js';
import { deplacerJoueurs } from './collision.js';
import {
  resoudreChaine,
  brulerObjets,
  revelerBonus,
  brulerJoueurs,
  ramasserBonus,
  vieillirFlammes,
} from './explosion.js';
import { verdictManche } from './manche.js';

/** L'entree d'une place, ou l'immobilite si le reseau ne l'a pas encore dit. */
function entreeDe(entrees, place) {
  const entree = entrees[place];
  return entree ?? ENTREE_VIDE;
}

/**
 * Decide si la manche est finie, avec un temps de latence.
 *
 * La pause n'est pas cosmetique : la derniere flamme doit avoir fini de bruler
 * et l'oeil doit avoir vu qui est mort. Annoncer le verdict au pas meme de la
 * derniere mort donnerait l'impression que le jeu a coupe.
 */
function conclure(etat) {
  const verdict = verdictManche(etat);
  if (verdict === null) {
    etat.finA = null;
    return;
  }
  if (etat.finA === null) {
    etat.finA = etat.pas + FIN_MANCHE_PAS;
    return;
  }
  if (etat.pas < etat.finA) return;
  etat.phase = 'verdict';
  etat.verdict = verdict;
  noter(etat, ['round', verdict.gagnante, verdict.nulle ? 1 : 0]);
}

/**
 * Avance la partie d'EXACTEMENT un pas. Mute `etat` et le renvoie.
 *
 * Meme graine + meme suite d'entrees = meme suite d'etats, sur n'importe quelle
 * machine : c'est cela, et non l'immutabilite, qui rend le rejeu et les tests
 * possibles.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./entrees.js').Entree[]} entrees indexees par place
 * @returns {import('./etat.js').Etat} le meme objet
 */
export function pas(etat, entrees = []) {
  etat.evenements.length = 0;
  if (etat.phase === 'verdict') return etat;
  etat.pas += 1;

  for (const joueur of etat.joueurs) {
    if (entreeDe(entrees, joueur.place).poser) poser(etat, joueur);
  }

  for (const joueur of etat.joueurs) {
    if (!entreeDe(entrees, joueur.place).declencher) continue;
    const bombe = declencher(etat, joueur);
    // Une meche a 1 part au releve de ce pas : le detonateur n'a donc pas de
    // chemin a lui, il emprunte celui des meches et toute la chaine avec.
    if (bombe) bombe.meche = 1;
  }

  avancerGlissements(etat);
  deplacerJoueurs(etat, entrees);

  const terminees = avancerMeches(etat);
  const { neuves, briques } = resoudreChaine(etat, terminees);
  brulerObjets(etat, neuves);
  revelerBonus(etat, briques);
  brulerJoueurs(etat);
  ramasserBonus(etat);
  vieillirFlammes(etat);
  conclure(etat);

  return etat;
}

/**
 * Joue plusieurs pas d'affilee, avec les memes entrees. Raccourci des tests et
 * du rattrapage.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {number} nombre
 * @param {import('./entrees.js').Entree[]} entrees
 */
export function avancerDe(etat, nombre, entrees = []) {
  for (let i = 0; i < nombre; i += 1) pas(etat, entrees);
  return etat;
}
