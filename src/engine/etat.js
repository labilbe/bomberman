/**
 * Etat d'une manche : sa forme, sa creation, sa copie.
 *
 * Immuable ou mutable ? Le reste du projet est immuable — les salons, les
 * absences, l'arbitre rendent tous une valeur neuve. L'etat du moteur, lui, est
 * MUTABLE, et c'est un choix, pas un relachement.
 *
 * Recopier deux Uint8Array et quatre bombers trente fois par seconde produirait
 * des dizaines de kilo-octets de dechets par seconde pour un etat que PERSONNE
 * ne conserve : ni le relais, qui n'a besoin que du dernier, ni le client, qui
 * garde des instantanes serialises et non des etats. L'immutabilite du Tetris
 * paie parce que son `reduce` est appele a la touche ; ici elle ne paierait rien.
 *
 * Le determinisme est donc garanti autrement : par le pas fixe, par les entiers
 * en sous-unites, et par un generateur a graine dont le moteur est le seul a
 * faire avancer. Meme graine + meme suite d'entrees = meme suite d'etats, sur
 * n'importe quelle machine. C'est cela, et non l'immutabilite, qui rend le rejeu
 * et les tests possibles.
 *
 * `cloner` existe quand meme : les tests en ont besoin pour comparer deux
 * branches, et la prediction locale du client pour tenir deux etats cote a cote.
 */

import {
  BOMBES_DEPART,
  FLAMME_DEPART,
  VITESSE_BASE,
  BAS,
  MAX_JOUEURS,
} from './constantes.js';
import { centreDe } from './grille.js';
import { createRng } from './rng.js';
import { DEPARTS, genererArene } from './arene.js';

/**
 * @typedef {{
 *   place: number, vivant: boolean, x: number, y: number,
 *   dir: number, marche: boolean,
 *   vitesse: number, bombes: number, portee: number,
 *   kick: boolean, detonateur: boolean,
 *   posees: number, surBombe: number | null, mortAu: number | null
 * }} Joueur
 *
 * @typedef {{
 *   id: number, cx: number, cy: number, place: number, portee: number,
 *   meche: number, glisse: { dir: number, x: number, y: number } | null
 * }} Bombe
 *
 * @typedef {{ cx: number, cy: number, reste: number }} Flamme
 *
 * @typedef {{
 *   graine: number, rng: { seed: number }, pas: number,
 *   phase: 'jeu' | 'verdict', version: number,
 *   tuiles: Uint8Array, objets: Uint8Array,
 *   joueurs: Joueur[], bombes: Bombe[], flammes: Flamme[],
 *   evenements: unknown[][], prochainId: number,
 *   finA: number | null, verdict: { gagnante: number | null, nulle: boolean } | null
 * }} Etat
 */

/**
 * Un bomber neuf, a sa case de depart, avec la dotation de base.
 *
 * La dotation est remise a zero a chaque manche : garder les bonus d'une manche
 * sur l'autre donnerait au gagnant une avance que personne ne peut plus
 * rattraper, et la manche 3 serait decidee avant d'avoir commence.
 *
 * @param {number} place
 * @returns {Joueur}
 */
export function creerJoueur(place) {
  const depart = DEPARTS[place % DEPARTS.length];
  const centre = centreDe(depart.x, depart.y);
  return {
    place,
    vivant: true,
    x: centre.x,
    y: centre.y,
    dir: BAS,
    marche: false,
    vitesse: VITESSE_BASE,
    bombes: BOMBES_DEPART,
    portee: FLAMME_DEPART,
    kick: false,
    detonateur: false,
    posees: 0,
    surBombe: null,
    mortAu: null,
  };
}

/**
 * Cree l'etat d'une manche.
 *
 * @param {{ graine: number, places?: number }} options
 * @returns {Etat}
 */
export function creerEtat({ graine, places = 2 }) {
  const nb = Math.max(1, Math.min(MAX_JOUEURS, places));
  const arene = genererArene(createRng(graine));
  return {
    graine,
    rng: arene.rng,
    pas: 0,
    phase: 'jeu',
    version: 0,
    tuiles: arene.tuiles,
    objets: arene.objets,
    joueurs: Array.from({ length: nb }, (_, place) => creerJoueur(place)),
    bombes: [],
    flammes: [],
    evenements: [],
    prochainId: 1,
    finA: null,
    verdict: null,
  };
}

/**
 * Copie profonde. `slice()` sur un Uint8Array rend un tampon neuf, pas une vue :
 * c'est ce qui evite que les deux copies ne partagent la grille.
 *
 * @param {Etat} etat
 * @returns {Etat}
 */
export function cloner(etat) {
  return {
    ...etat,
    rng: { seed: etat.rng.seed },
    tuiles: etat.tuiles.slice(),
    objets: etat.objets.slice(),
    joueurs: etat.joueurs.map((joueur) => ({ ...joueur })),
    bombes: etat.bombes.map((bombe) => ({
      ...bombe,
      glisse: bombe.glisse ? { ...bombe.glisse } : null,
    })),
    flammes: etat.flammes.map((flamme) => ({ ...flamme })),
    evenements: etat.evenements.map((evenement) => evenement.slice()),
    verdict: etat.verdict ? { ...etat.verdict } : null,
  };
}

/**
 * Ajoute un evenement au pas courant.
 *
 * Les evenements sont des tuples dont le premier element est un nom anglais :
 * ils partent sur le reseau tels quels, et pilotent les sons et les animations
 * des deux cotes. Un tuple plutot qu'un objet parce qu'ils sont nombreux et que
 * les noms de champs repetes trente fois par seconde ne portent aucune
 * information.
 *
 * @param {Etat} etat
 * @param {unknown[]} evenement
 */
export function noter(etat, evenement) {
  etat.evenements.push(evenement);
}

/** Le bomber a cette place, ou undefined. */
export function joueurA(etat, place) {
  return etat.joueurs.find((joueur) => joueur.place === place);
}

/** Les bombers encore en vie. */
export function vivants(etat) {
  return etat.joueurs.filter((joueur) => joueur.vivant);
}
