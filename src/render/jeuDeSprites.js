/**
 * Le contrat que le rendu attend d'un jeu de sprites, et ses deux fournisseurs.
 *
 * La scene ne doit pas savoir d'ou viennent ses images. Elle en demande par
 * role — le sol, un bout de flamme vers la droite, le bomber de la place 2 qui
 * marche vers le bas — et deux fournisseurs repondent : celui qui peint tout au
 * code, et celui qui rasterise les SVG extraits d'Atomic Bomberman.
 *
 * Chaque sprite est une TOILE plus un POINT D'ACCROCHE. C'est le point qui
 * compte : les sprites du jeu d'origine ne sont pas de la taille d'une case — un
 * bomber fait 110 pixels de haut pour une case de 36 — et ils se posent par
 * leurs pieds, pas par leur coin. Sans accroche, chaque sprite demanderait son
 * propre calage a la main dans la scene.
 */

import { construireSprites, COTE, IMAGES_MARCHE } from './sprites.js';
import { PLACES } from './palette.js';

/** Nombre d'images du cycle de marche, pour les deux fournisseurs. */
export { IMAGES_MARCHE };

/** Les quatre directions du moteur : HAUT, DROITE, BAS, GAUCHE. */
const DIRS = [0, 1, 2, 3];

/**
 * Duree d'un battement de bombe, en millisecondes, faute de mieux.
 *
 * Atomic Bomberman donne la sienne — dix-huit pas de 30 ms, soit 540 — et c'est
 * elle qu'on prend quand les sprites du jeu sont la. Les sprites dessines au
 * code n'ont pas de duree a eux, d'ou cette valeur : trois images a ce rythme
 * font un battement qui se lit, sans clignoter.
 */
const CYCLE_BOMBE_DEFAUT = 660;

/**
 * Duree d un cycle de marche, en millisecondes, faute de mieux.
 *
 * Atomic Bomberman donne la sienne : quinze images de 30 ms, soit 450. Les
 * sprites dessines au code n en ont pas, d ou cette valeur — leurs quatre images
 * sur cette duree donnent une foulee de rythme comparable.
 */
const CYCLE_MARCHE_DEFAUT = 450;

/**
 * Jeu de sprites peint au code.
 *
 * Les sprites dessines font tous 16 x 16 et se posent par le bas au centre, donc
 * l'accroche est la meme partout. Le fournisseur sert surtout de repli, et de
 * reference : si la scene rend juste avec lui, elle rendra juste avec l'autre.
 */
export function depuisDessins(places = PLACES.length) {
  const brut = construireSprites(places);
  const sprite = (toile) => ({ toile, largeur: COTE, hauteur: COTE, accrocheX: COTE / 2, accrocheY: COTE });
  const parPlace = (fabrique) => Array.from({ length: places }, (_, p) => fabrique(p));

  return {
    tuile: { largeur: COTE, hauteur: COTE },
    // Pas de fond peint ici : le damier des deux nuances de sol fait le travail.
    fond: null,
    bombeCycle: CYCLE_BOMBE_DEFAUT,
    marcheCycle: CYCLE_MARCHE_DEFAUT,
    sol: brut.sol.map(sprite),
    mur: sprite(brut.murDur),
    brique: sprite(brut.brique),
    briqueCasse: null,
    bonus: Object.fromEntries(Object.entries(brut.bonus).map(([nom, t]) => [nom, sprite(t)])),
    // Les bombes dessinees ne portent pas la couleur du joueur : la meme
    // sequence sert pour toutes les places.
    bombe: parPlace(() => brut.bombe.map(sprite)),
    // Un seul jeu de flammes, reutilise pour le centre, les milieux et les
    // bouts : le dessin au code fait une croix pleine, qui se raccorde d'une
    // case a l'autre sans avoir besoin de pieces distinctes.
    flamme: parPlace(() => ({
      centre: brut.flamme.map(sprite),
      milieu: DIRS.map(() => brut.flamme.map(sprite)),
      bout: DIRS.map(() => brut.flamme.map(sprite)),
    })),
    bombers: parPlace((p) => DIRS.map((d) => brut.bombers[p][d].map(sprite))),
    immobiles: parPlace((p) => DIRS.map((d) => sprite(brut.bombers[p][d][0]))),
    morts: parPlace((p) => brut.morts[p].map(sprite)),
  };
}

/**
 * Jeu de sprites vectoriels, a partir de ce que rend `chargerVectoriels`.
 *
 * Le sol arrive sous deux formes. `fond` est la bande peinte du terrain, large
 * de toute l'arene, que la scene prefere quand elle est la : c'est le vrai sol
 * d'Atomic Bomberman, avec ses rangees claires et sombres alternees. `sol` reste
 * la tuile « blank » des .ANI, gardee en repli — elle fait le travail si le
 * fichier du terrain manque, mais c'est une autre herbe, a pois, qui recopiee
 * d'une case a l'autre se voit tout de suite.
 */
export function depuisVectoriels(charge, places = PLACES.length) {
  const { tuile, sol: fond, roles, cycles } = charge;
  const un = (nom) => roles[nom]?.[0] ?? null;
  const parPlace = (nom) => Array.from({ length: places }, (_, p) => roles[nom][p % roles[nom].length]);

  return {
    tuile,
    fond,
    // Le rythme de pulsation vient du jeu d'origine, pas d'un reglage a nous.
    bombeCycle: cycles?.bombe ?? CYCLE_BOMBE_DEFAUT,
    marcheCycle: cycles?.marche0 ?? CYCLE_MARCHE_DEFAUT,
    sol: [un('sol'), un('sol')],
    mur: un('mur'),
    brique: un('brique'),
    briqueCasse: roles.briqueCasse ?? null,
    bonus: {
      bomb: un('bonusBomb'),
      flame: un('bonusFlame'),
      speed: un('bonusSpeed'),
      kick: un('bonusKick'),
      trigger: un('bonusTrigger'),
    },
    bombe: parPlace('bombe'),
    // Une explosion prend la couleur de celui qui a pose la bombe : chaque piece
    // existe donc en autant d'exemplaires que de places.
    flamme: Array.from({ length: places }, (_, p) => ({
      centre: roles.flammeCentre[p],
      milieu: DIRS.map((d) => roles[`flammeMilieu${d}`][p]),
      bout: DIRS.map((d) => roles[`flammeBout${d}`][p]),
    })),
    bombers: Array.from({ length: places }, (_, p) => DIRS.map((d) => roles[`marche${d}`][p])),
    immobiles: Array.from({ length: places }, (_, p) => DIRS.map((d) => roles[`immobile${d}`][p][0])),
    morts: Array.from({ length: places }, (_, p) => roles.mort[p]),
  };
}
