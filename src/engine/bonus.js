/**
 * Bonus : codes, table de tirage, et effet sur un bomber.
 *
 * Les bonus sont des OCTETS dans un Uint8Array parallele a la grille, pas des
 * objets dans une liste. Deux raisons : l'arene entiere tient alors en 195
 * octets de plus, qui partent d'un bloc au debut de la manche ; et un bonus est
 * toujours sur une case, jamais entre deux, donc une liste n'apporterait rien
 * qu'une indirection.
 *
 * Le meme tableau porte les bonus VISIBLES (code 1 a 5) et ceux CACHES sous une
 * brique (CACHE + code). Un seul tableau, parce qu'un bonus revele ne change
 * alors que de valeur, sans qu'il faille le deplacer d'une structure a l'autre —
 * deplacement qui est exactement l'endroit ou l'on oublie un cas.
 */

import { BOMBES_MAX, FLAMME_MAX, VITESSE_MAX, VITESSE_PALIER } from './constantes.js';

/** Decalage des bonus encore caches sous une brique. */
export const CACHE = 128;

/** Codes des bonus, tels qu'ils vivent dans le tableau des objets. */
export const CODES_BONUS = {
  BOMBE: 1,
  FLAMME: 2,
  VITESSE: 3,
  KICK: 4,
  DETONATEUR: 5,
};

/**
 * Noms reseau des bonus. Le protocole est en anglais, comme au Tetris : la
 * frontiere entre le code (francais) et le fil (anglais) doit rester nette.
 */
export const NOMS_BONUS = {
  [CODES_BONUS.BOMBE]: 'bomb',
  [CODES_BONUS.FLAMME]: 'flame',
  [CODES_BONUS.VITESSE]: 'speed',
  [CODES_BONUS.KICK]: 'kick',
  [CODES_BONUS.DETONATEUR]: 'trigger',
};

/**
 * Table ponderee.
 *
 * Bombe et flamme dominent : ce sont elles qui font progresser une manche, et
 * les voir souvent recompense le fait de casser des briques. Kick et detonateur
 * sont rares parce qu'ils changent la facon de jouer, pas seulement sa force.
 */
export const TABLE_BONUS = [
  [CODES_BONUS.BOMBE, 30],
  [CODES_BONUS.FLAMME, 30],
  [CODES_BONUS.VITESSE, 15],
  [CODES_BONUS.KICK, 12],
  [CODES_BONUS.DETONATEUR, 8],
];

/** Vrai si l'octet designe un bonus encore cache sous une brique. */
export function estCache(valeur) {
  return valeur > CACHE;
}

/** Vrai si l'octet designe un bonus pose au sol, ramassable. */
export function estVisible(valeur) {
  return valeur > 0 && valeur < CACHE;
}

/** Code du bonus, qu'il soit cache ou visible. */
export function codeDe(valeur) {
  return estCache(valeur) ? valeur - CACHE : valeur;
}

/**
 * Applique un bonus a un bomber. Mute le bomber, qui appartient a l'etat.
 *
 * Les plafonds ne sont pas de la prudence : sans eux, une manche longue finit
 * avec huit bombes de portee quinze chacune, l'arene entiere brule en
 * permanence et plus personne ne joue.
 *
 * @param {{ bombes: number, portee: number, vitesse: number, kick: boolean, detonateur: boolean }} joueur
 * @param {number} code
 */
export function appliquer(joueur, code) {
  switch (code) {
    case CODES_BONUS.BOMBE:
      joueur.bombes = Math.min(BOMBES_MAX, joueur.bombes + 1);
      break;
    case CODES_BONUS.FLAMME:
      joueur.portee = Math.min(FLAMME_MAX, joueur.portee + 1);
      break;
    case CODES_BONUS.VITESSE:
      joueur.vitesse = Math.min(VITESSE_MAX, joueur.vitesse + VITESSE_PALIER);
      break;
    case CODES_BONUS.KICK:
      joueur.kick = true;
      break;
    case CODES_BONUS.DETONATEUR:
      joueur.detonateur = true;
      break;
    default:
      break;
  }
}
