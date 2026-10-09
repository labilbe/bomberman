/**
 * Manches, scores et fin de match.
 *
 * Tout est pur et immuable ici, contrairement a l'etat de l'arene : un match
 * change cinq a neuf fois dans une soiree, pas trente fois par seconde, et c'est
 * la valeur qu'on affiche, qu'on persiste en SQL et qu'on compare dans les
 * tests. L'immutabilite y est gratuite et elle evite qu'un score soit modifie
 * par surprise au milieu d'une diffusion.
 *
 * Le verdict ne regarde que l'etat FINAL du pas, jamais l'ordre d'arrivee des
 * morts. Deux bombers tues au meme pas font une manche nulle, et non une
 * victoire pour celui qui se trouvait plus loin dans le tableau.
 */

/** Formats de match proposes : premier a 2, a 3, ou a 4 manches. */
export const FORMATS = [3, 5, 7];

/**
 * Borne les nuls a repetition. Sans elle, deux bombers qui se tuent
 * mutuellement a chaque manche jouent jusqu'a la fin des temps.
 */
export const MANCHES_MAX = 9;

/**
 * @typedef {{ gagnante: number | null, nulle: boolean }} Verdict
 * @typedef {{ total: number, aGagner: number, manche: number, scores: number[], nuls: number, fini: boolean }} Match
 */

/**
 * @param {{ places: number, total?: number }} options
 * @returns {Match}
 */
export function creerMatch({ places, total = FORMATS[0] }) {
  const format = FORMATS.includes(total) ? total : FORMATS[0];
  return {
    total: format,
    aGagner: Math.ceil(format / 2),
    manche: 1,
    scores: Array.from({ length: places }, () => 0),
    nuls: 0,
    fini: false,
  };
}

/**
 * Verdict d'une manche, ou null si elle n'est pas finie.
 *
 * A un seul bomber dans l'arene — l'entrainement — la manche ne s'arrete qu'a
 * sa mort : attendre qu'il reste « un survivant » l'aurait terminee avant
 * d'avoir commence.
 *
 * @param {import('./etat.js').Etat} etat
 * @returns {Verdict | null}
 */
export function verdictManche(etat) {
  const vivants = etat.joueurs.filter((joueur) => joueur.vivant);
  const seuil = etat.joueurs.length > 1 ? 1 : 0;
  if (vivants.length > seuil) return null;
  if (vivants.length === 1) return { gagnante: vivants[0].place, nulle: false };
  return { gagnante: null, nulle: true };
}

/**
 * Inscrit un verdict au tableau et avance d'une manche.
 *
 * @param {Match} match
 * @param {Verdict} verdict
 * @returns {Match}
 */
export function marquer(match, verdict) {
  const scores = match.scores.slice();
  if (verdict.gagnante !== null && scores[verdict.gagnante] !== undefined) {
    scores[verdict.gagnante] += 1;
  }
  const nuls = match.nuls + (verdict.nulle ? 1 : 0);
  const atteint = scores.some((score) => score >= match.aGagner);
  const epuise = match.manche >= MANCHES_MAX;
  return {
    ...match,
    scores,
    nuls,
    manche: match.manche + 1,
    fini: atteint || epuise,
  };
}

/** @param {Match} match */
export function matchTermine(match) {
  return match.fini;
}

/**
 * La place qui remporte le match, ou null si personne ne se detache.
 *
 * @param {Match} match
 * @returns {number | null}
 */
export function vainqueur(match) {
  let meilleure = null;
  let meilleur = -1;
  let exaequo = false;
  match.scores.forEach((score, place) => {
    if (score > meilleur) {
      meilleur = score;
      meilleure = place;
      exaequo = false;
    } else if (score === meilleur) {
      exaequo = true;
    }
  });
  if (meilleur <= 0 || exaequo) return null;
  return meilleure;
}

/**
 * Classement, du meilleur au moins bon. L'egalite est tranchee par le numero de
 * place, pour que l'ordre soit le meme partout et ne depende pas de la stabilite
 * du tri de l'execution.
 *
 * @param {Match} match
 */
export function classement(match) {
  return match.scores
    .map((score, place) => ({ place, score }))
    .sort((a, b) => b.score - a.score || a.place - b.place);
}

/**
 * Graine de la manche n, derivee de celle du match.
 *
 * Une arene differente a chaque manche, mais reproductible depuis la seule
 * graine du match : c'est ce qui permet au journal de rejouer la soiree entiere
 * sans stocker quatre arenes.
 *
 * @param {number} graineMatch
 * @param {number} manche
 */
export function graineDeManche(graineMatch, manche) {
  // Melange par un entier impair large : incrementer la graine d'un xorshift
  // donne des arenes jumelles, parce que ses premiers bits avancent peu.
  return (Math.imul(graineMatch ^ (manche * 0x9e3779b9), 0x85ebca6b) >>> 0) || 1;
}
