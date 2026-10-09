/**
 * Generation deterministe de l'arene et semis des bonus.
 *
 * Les quatre coins sont degages en L. Sans cela un bomber peut naitre enferme
 * entre deux briques, perdre la manche avant d'avoir bouge, et accuser le jeu
 * a juste titre.
 *
 * Les bonus sont semes ICI, au depart de la manche, et non au moment ou une
 * brique explose. C'est ce qui rend la partie rejouable : si le tirage avait
 * lieu a la destruction, la suite des bonus dependrait de l'ordre dans lequel
 * les joueurs cassent les murs, donc de la latence de chacun, et le journal ne
 * permettrait plus de reconstituer la manche.
 */

import { COLS, ROWS, VIDE, DUR, BRIQUE } from './constantes.js';
import { index } from './grille.js';
import { nextRandom } from './rng.js';
import { CACHE, TABLE_BONUS } from './bonus.js';

/** Proportion de briques parmi les cases libres. */
const DENSITE_BRIQUES = 0.78;

/** Proportion de briques qui cachent un bonus. */
const BRIQUES_AVEC_BONUS = 0.35;

/**
 * Coins de depart, dans l'ordre des places.
 *
 * En diagonale : a deux joueurs on se fait face d'un bout a l'autre de l'arene,
 * ce qui laisse le temps de se construire avant de se rencontrer. Les ranger
 * dans l'ordre de lecture aurait colle les places 0 et 1 cote a cote.
 */
export const DEPARTS = [
  { x: 1, y: 1 },
  { x: COLS - 2, y: ROWS - 2 },
  { x: COLS - 2, y: 1 },
  { x: 1, y: ROWS - 2 },
];

/** Vrai si la case est un mur indestructible du damier. */
export function estMurDur(x, y) {
  return x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0);
}

/**
 * Les trois cases a degager autour d'un depart : la sienne, et deux voisines
 * vers l'interieur de l'arene. Un bomber a donc toujours deux fuites.
 */
function degagements(depart) {
  const versX = depart.x === 1 ? 1 : -1;
  const versY = depart.y === 1 ? 1 : -1;
  return [
    { x: depart.x, y: depart.y },
    { x: depart.x + versX, y: depart.y },
    { x: depart.x, y: depart.y + versY },
  ];
}

/**
 * Tire un bonus dans la table ponderee.
 *
 * Un seul appel au generateur, quelle que soit la branche prise : si le nombre
 * de tirages dependait du resultat, deux machines se desynchroniseraient des le
 * premier bonus.
 *
 * @param {{ seed: number }} rng
 * @returns {{ rng: { seed: number }, bonus: number }}
 */
export function tirerBonus(rng) {
  const total = TABLE_BONUS.reduce((somme, [, poids]) => somme + poids, 0);
  const tirage = nextRandom(rng);
  let reste = tirage.value * total;
  for (const [code, poids] of TABLE_BONUS) {
    reste -= poids;
    if (reste < 0) return { rng: tirage.rng, bonus: code };
  }
  return { rng: tirage.rng, bonus: TABLE_BONUS[TABLE_BONUS.length - 1][0] };
}

/**
 * Genere une arene et y seme les bonus caches.
 *
 * @param {{ seed: number }} rng generateur a graine
 * @returns {{ tuiles: Uint8Array, objets: Uint8Array, rng: { seed: number } }}
 */
export function genererArene(rng) {
  const tuiles = new Uint8Array(COLS * ROWS);
  const objets = new Uint8Array(COLS * ROWS);
  let courant = rng;

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (estMurDur(x, y)) {
        tuiles[index(x, y)] = DUR;
        continue;
      }
      const tirage = nextRandom(courant);
      courant = tirage.rng;
      tuiles[index(x, y)] = tirage.value < DENSITE_BRIQUES ? BRIQUE : VIDE;
    }
  }

  // Apres le tirage des briques, et non pendant : la suite de nombres consommee
  // ne depend ainsi pas du nombre de coins degages, et reste la meme a 2 comme
  // a 4 joueurs.
  for (const depart of DEPARTS) {
    for (const libre of degagements(depart)) tuiles[index(libre.x, libre.y)] = VIDE;
  }

  // Parcours par indice croissant, un tirage par brique : jamais d'iteration sur
  // un Set ni d'ordre de cles, dont rien ne garantit la stabilite.
  for (let i = 0; i < tuiles.length; i += 1) {
    if (tuiles[i] !== BRIQUE) continue;
    const des = nextRandom(courant);
    courant = des.rng;
    if (des.value >= BRIQUES_AVEC_BONUS) continue;
    const choix = tirerBonus(courant);
    courant = choix.rng;
    objets[i] = CACHE + choix.bonus;
  }

  return { tuiles, objets, rng: courant };
}

export { VIDE, DUR, BRIQUE };
