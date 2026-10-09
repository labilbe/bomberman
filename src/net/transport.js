/**
 * Transport : par ou passent les intentions et les etats.
 *
 * Le jeu ne touche jamais le moteur directement. Il pousse les intentions dans
 * un transport, et recoit des vues d'arene par ses abonnements. Le mode de jeu
 * choisit l'implementation, et rien d'autre dans la page ne sait comment les
 * messages voyagent — c'est ce qui permettra de brancher le relais a l'etape
 * suivante sans toucher au rendu ni au clavier.
 *
 * Contrat commun :
 *   demarrer()               -> Promise<{ places, format, miens: number[] }>
 *   intention(place, entree) -> void   derniere intention connue d'une place
 *   battre(maintenantMs)     -> void   fait avancer le temps (solo seulement)
 *   surVue(f)                -> () => void   f(vue)
 *   surEvenements(f)         -> () => void   f(evenements, pas)
 *   surTransition(f)         -> () => void   f(transition)   round / score / finished
 *   surEtatReseau(f)         -> () => void   f(etat)         attente, absence, erreur
 *   fermer()                 -> void
 *
 * En solo, `battre` fait tourner le moteur dans la page. En ligne, c'est le
 * relais qui bat, et `battre` ne fait rien : la page n'a plus qu'a recevoir.
 * C'est la seule difference visible entre les deux, et elle est contenue ici.
 */

import { randomSeed } from '../engine/rng.js';
import { creerPartie, pasPartie } from '../engine/partie.js';
import { creerHorloge, avancer } from '../engine/horloge.js';
import { ENTREE_VIDE } from '../engine/entrees.js';
import { FORMATS } from '../engine/manche.js';

/**
 * Solo et jeu local : le moteur tourne dans la page, sans latence ni reseau.
 *
 * @param {{
 *   graine?: number, places?: number, humains?: number, format?: number,
 *   pilotes?: Record<number, (etat: object, place: number) => object>
 * }} options
 */
export function creerTransportLocal({
  graine = randomSeed(),
  places = 2,
  humains = 1,
  format = FORMATS[0],
  pilotes = {},
} = {}) {
  const partie = creerPartie({ graine, places, format });
  const intentions = Array.from({ length: places }, () => ({ ...ENTREE_VIDE }));
  const vues = new Set();
  const evenements = new Set();
  const transitions = new Set();

  let horloge = null;
  let arrete = false;

  function diffuser(ensemble, ...args) {
    for (const abonne of ensemble) abonne(...args);
  }

  /**
   * Les entrees du pas : celles des humains telles qu'elles ont ete poussees,
   * celles des pilotes calculees a l'instant.
   *
   * Les impulsions sont consommees ici, et non a la lecture du clavier : un pas
   * de rattrapage ne doit pas reposer une deuxieme bombe avec la meme intention.
   */
  function entreesDuPas() {
    const entrees = [];
    for (let place = 0; place < places; place += 1) {
      const pilote = pilotes[place];
      if (pilote) {
        entrees[place] = pilote(partie.etat, place);
        continue;
      }
      const voulue = intentions[place];
      entrees[place] = { ...voulue };
      voulue.poser = false;
      voulue.declencher = false;
    }
    return entrees;
  }

  return {
    async demarrer() {
      horloge = null;
      const miens = Array.from({ length: Math.min(humains, places) }, (_, i) => i);
      // La premiere manche est deja prete : on l'annonce comme le relais le
      // ferait, pour que la page n'ait qu'un seul chemin de demarrage.
      queueMicrotask(() =>
        diffuser(transitions, {
          type: 'round',
          manche: partie.manche,
          graine: partie.etat.graine,
        }),
      );
      return { places, format: partie.format, miens, noms: null };
    },

    intention(place, entree) {
      if (!intentions[place]) return;
      intentions[place] = {
        dir: entree.dir,
        // Une impulsion deja en attente ne se perd pas si l'image suivante
        // arrive avant le pas de simulation.
        poser: intentions[place].poser || entree.poser,
        declencher: intentions[place].declencher || entree.declencher,
      };
    },

    battre(maintenant) {
      if (arrete) return;
      if (horloge === null) horloge = creerHorloge(maintenant);
      const avance = avancer(horloge, maintenant);
      horloge = avance.horloge;

      for (let i = 0; i < avance.pas; i += 1) {
        const resultat = pasPartie(partie, entreesDuPas());
        if (resultat.evenements.length > 0) {
          diffuser(evenements, resultat.evenements, partie.etat.pas);
        }
        if (resultat.transition) diffuser(transitions, resultat.transition);
      }

      diffuser(vues, partie.etat, partie.match);
    },

    surVue(f) {
      vues.add(f);
      return () => vues.delete(f);
    },

    surEvenements(f) {
      evenements.add(f);
      return () => evenements.delete(f);
    },

    surTransition(f) {
      transitions.add(f);
      return () => transitions.delete(f);
    },

    surEtatReseau() {
      // En solo il n'y a pas de reseau, donc rien a raconter.
      return () => {};
    },

    fermer() {
      arrete = true;
      vues.clear();
      evenements.clear();
      transitions.clear();
    },

    /** Reserve aux tests et au debogage : l'etat vivant du moteur. */
    partie,
  };
}
