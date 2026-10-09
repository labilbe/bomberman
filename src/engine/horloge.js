/**
 * Transformation du temps mural en pas de simulation.
 *
 * Le moteur n'accepte pas de `dt` : un pas de duree variable ferait dependre la
 * physique de la cadence d'affichage, et deux machines ne tomberaient jamais sur
 * le meme resultat. C'est donc ici, et seulement ici, que le temps reel entre
 * dans le jeu — pour etre converti en un NOMBRE ENTIER d'appels a `pas()`.
 *
 * Deux appelants tres differents en dependent : la boucle de rendu du navigateur
 * en solo, et le `setInterval` du relais en ligne. Sans ce module, ce calcul
 * serait ecrit deux fois, et mal une fois.
 *
 * Le plafond de rattrapage est la protection qui compte : un onglet revenu
 * d'arriere-plan annonce parfois trente secondes d'un coup, et rejouer 1800 pas
 * dans une seule image gelerait la page avant de tuer tout le monde.
 */

import { PAS_MS } from './constantes.js';

/** Au-dela, on laisse filer le temps perdu plutot que de rattraper. */
export const RATTRAPAGE_MAX = 6;

/** @typedef {{ reste: number, dernier: number }} Horloge */

/**
 * @param {number} maintenant horodatage en ms (origine libre, seuls les ecarts comptent)
 * @returns {Horloge}
 */
export function creerHorloge(maintenant) {
  return { reste: 0, dernier: maintenant };
}

/**
 * Combien de pas jouer, et l'horloge suivante.
 *
 * @param {Horloge} horloge
 * @param {number} maintenant
 * @returns {{ horloge: Horloge, pas: number }}
 */
export function avancer(horloge, maintenant) {
  const ecoule = maintenant - horloge.dernier;
  // Une horloge qui recule (changement d'heure, horodatage farfelu venu du
  // reseau) ne doit pas faire reculer la partie.
  const utile = Number.isFinite(ecoule) && ecoule > 0 ? ecoule : 0;
  const cumul = horloge.reste + utile;
  const voulus = Math.floor(cumul / PAS_MS);
  const pas = Math.min(voulus, RATTRAPAGE_MAX);
  // On ne garde le reliquat que des pas reellement joues : au-dela du plafond,
  // le temps perdu est perdu pour de bon, sinon il reviendrait a l'image suivante.
  const reste = voulus > RATTRAPAGE_MAX ? 0 : cumul - voulus * PAS_MS;
  return { horloge: { reste, dernier: maintenant }, pas };
}
