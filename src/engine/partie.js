/**
 * Enchainement des manches : la partie au-dessus de l'arene.
 *
 * Ce module est pur et sans horloge, comme le reste du moteur, et c'est
 * volontaire : il tournera DANS LE RELAIS en ligne et dans la page en solo. Si
 * l'enchainement des manches vivait dans le navigateur, le solo et le reseau
 * auraient deux regles de fin de match, et c'est exactement le genre d'ecart
 * qu'on ne decouvre qu'en finale.
 *
 * Il n'expose qu'une fonction d'avancement, `pasPartie`, qui rend les
 * TRANSITIONS : nouvelle manche, score, fin de match. L'appelant n'a plus qu'a
 * les diffuser ou les afficher, sans jamais decider lui-meme ou en est la
 * soiree.
 */

import { creerEtat } from './etat.js';
import { pas } from './pas.js';
import {
  creerMatch,
  marquer,
  matchTermine,
  vainqueur,
  classement,
  graineDeManche,
  FORMATS,
} from './manche.js';

/** Temps d'affichage du tableau des scores entre deux manches : 3 secondes. */
export const PAUSE_MANCHE_PAS = 180;

/**
 * Temps d'arret au DEBUT d'une manche : 1,2 seconde.
 *
 * L'arene est posee, visible et figee pendant qu'on annonce « Manche N ». Sans
 * cela l'annonce s'affichait par-dessus une partie deja lancee : les bots
 * avaient le temps de poser une bombe avant que le joueur ait fini de lire, et
 * la manche commencait sans lui.
 *
 * C'est le moteur qui tient ce decompte, et non la page qui masquerait sa
 * banniere apres un `setTimeout`. En ligne, chaque navigateur aurait eu son
 * propre delai pendant que le relais, lui, simulait : la manche aurait demarre a
 * un instant different pour chacun.
 */
export const DEPART_MANCHE_PAS = 72;

/**
 * @typedef {{
 *   graine: number, format: number, places: number,
 *   match: import('./manche.js').Match,
 *   etat: import('./etat.js').Etat,
 *   manche: number, pause: number, depart: number, compte: boolean, fini: boolean
 * }} Partie
 */

/**
 * @param {{ graine: number, places: number, format?: number }} options
 * @returns {Partie}
 */
export function creerPartie({ graine, places, format = FORMATS[0] }) {
  const match = creerMatch({ places, total: format });
  return {
    graine,
    format: match.total,
    places,
    match,
    etat: creerEtat({ graine: graineDeManche(graine, 1), places }),
    manche: 1,
    pause: 0,
    depart: DEPART_MANCHE_PAS,
    compte: false,
    fini: false,
  };
}

/** L'etat d'une manche neuve, pour la manche courante de la partie. */
function nouvelleManche(partie) {
  partie.etat = creerEtat({
    graine: graineDeManche(partie.graine, partie.manche),
    places: partie.places,
  });
  partie.depart = DEPART_MANCHE_PAS;
  return {
    type: 'round',
    manche: partie.manche,
    graine: partie.etat.graine,
    // L'appelant cale l'affichage de son annonce sur cette duree, plutot que de
    // choisir la sienne : deux comptes a rebours finiraient par diverger.
    attente: DEPART_MANCHE_PAS,
  };
}

/**
 * Avance la partie d'un pas.
 *
 * @param {Partie} partie
 * @param {import('./entrees.js').Entree[]} entrees
 * @returns {{ evenements: unknown[][], transition: Record<string, unknown> | null }}
 */
export function pasPartie(partie, entrees = []) {
  if (partie.fini) return { evenements: [], transition: null };

  // Entre deux manches : l'arene est figee, seul le tableau des scores vit.
  if (partie.pause > 0) {
    partie.pause -= 1;
    if (partie.pause > 0) return { evenements: [], transition: null };
    partie.manche = partie.match.manche;
    return { evenements: [], transition: nouvelleManche(partie) };
  }

  // Debut de manche : l'arene est en place mais personne ne bouge encore, ni les
  // joueurs ni les bots. Les intentions recues pendant ce temps sont ignorees,
  // puisqu'on n'appelle pas `pas`.
  if (partie.depart > 0) {
    partie.depart -= 1;
    return { evenements: [], transition: null };
  }

  pas(partie.etat, entrees);
  const evenements = partie.etat.evenements;

  if (partie.etat.phase !== 'verdict' || partie.compte) {
    return { evenements, transition: null };
  }

  // Le verdict vient de tomber : on le compte une seule fois.
  partie.compte = true;
  partie.match = marquer(partie.match, partie.etat.verdict);

  if (matchTermine(partie.match)) {
    partie.fini = true;
    return {
      evenements,
      transition: {
        type: 'finished',
        vainqueur: vainqueur(partie.match),
        scores: partie.match.scores.slice(),
        classement: classement(partie.match),
      },
    };
  }

  partie.pause = PAUSE_MANCHE_PAS;
  partie.compte = false;
  return {
    evenements,
    transition: {
      type: 'score',
      verdict: partie.etat.verdict,
      scores: partie.match.scores.slice(),
      manche: partie.manche,
      attente: PAUSE_MANCHE_PAS,
    },
  };
}

/** La partie attend-elle entre deux manches ? */
export function enPause(partie) {
  return partie.pause > 0;
}

/** L'arene est-elle figee, pour une raison ou pour une autre ? */
export function figee(partie) {
  return partie.pause > 0 || partie.depart > 0;
}
