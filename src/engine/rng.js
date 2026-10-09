/**
 * Generateur pseudo-aleatoire a graine (xorshift32).
 *
 * Le coeur est purement fonctionnel, comme au Tetris : tirer un nombre ne
 * modifie rien, il renvoie la valeur ET le generateur suivant. C'est ce qui
 * permet au relais, au navigateur et aux tests de voir la meme arene et les
 * memes bonus a partir de la meme graine, et de rejouer une partie depuis son
 * journal.
 *
 * Une seule facilite est accordee au moteur : `tirer(etat)`, qui avance le
 * generateur loge dans l'etat. La mutation est admise parce que le moteur
 * possede son etat, et seulement la ; rien d'autre dans le projet n'a le droit
 * de faire avancer un generateur sur place.
 */

/** @typedef {{ seed: number }} Rng */

/**
 * @param {number} seed graine initiale (0 est remplace par 1, xorshift y reste bloque)
 * @returns {Rng}
 */
export function createRng(seed) {
  const normalise = seed >>> 0;
  return { seed: normalise === 0 ? 1 : normalise };
}

/**
 * Tire un flottant dans [0, 1).
 * @param {Rng} rng
 * @returns {{ rng: Rng, value: number }}
 */
export function nextRandom(rng) {
  let x = rng.seed;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return { rng: { seed: x }, value: x / 0x100000000 };
}

/**
 * Tire un entier dans [0, borne). Renvoie 0 si la borne n'a pas de sens.
 * @param {Rng} rng
 * @param {number} borne
 * @returns {{ rng: Rng, value: number }}
 */
export function nextEntier(rng, borne) {
  const tirage = nextRandom(rng);
  if (!Number.isFinite(borne) || borne <= 0) return { rng: tirage.rng, value: 0 };
  return { rng: tirage.rng, value: Math.min(borne - 1, Math.floor(tirage.value * borne)) };
}

/**
 * Avance le generateur loge dans un porteur (l'etat du moteur) et rend le
 * flottant tire. Seul le moteur s'en sert.
 *
 * @param {{ rng: Rng }} porteur
 * @returns {number}
 */
export function tirer(porteur) {
  const tirage = nextRandom(porteur.rng);
  porteur.rng = tirage.rng;
  return tirage.value;
}

/**
 * Meme chose pour un entier dans [0, borne).
 *
 * @param {{ rng: Rng }} porteur
 * @param {number} borne
 * @returns {number}
 */
export function tirerEntier(porteur, borne) {
  const tirage = nextEntier(porteur.rng, borne);
  porteur.rng = tirage.rng;
  return tirage.value;
}

/**
 * Melange une copie du tableau (Fisher-Yates) sans toucher a l'original.
 * @template T
 * @param {readonly T[]} items
 * @param {Rng} rng
 * @returns {{ rng: Rng, items: T[] }}
 */
export function shuffle(items, rng) {
  const out = items.slice();
  let courant = rng;
  for (let i = out.length - 1; i > 0; i -= 1) {
    const tirage = nextEntier(courant, i + 1);
    courant = tirage.rng;
    const j = tirage.value;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return { rng: courant, items: out };
}

/** Graine aleatoire, a utiliser uniquement en solo : en reseau elle vient du relais. */
export function randomSeed() {
  return (Math.random() * 0x100000000) >>> 0;
}
