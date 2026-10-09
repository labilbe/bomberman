/**
 * Palette du jeu.
 *
 * Elle est saturee et contrastee, a la facon d'Atomic Bomberman, parce que la
 * lisibilite est ici une regle du jeu : on doit distinguer d'un coup d'oeil une
 * brique d'un mur dur — l'une s'ouvre, l'autre jamais — et reconnaitre son
 * bomber parmi quatre dans une melee. Les quatre couleurs de joueur sont donc
 * choisies pour rester distinctes a la fois en teinte et en luminosite, ce qui
 * les separe aussi pour un oeil daltonien.
 *
 * Les couleurs sont attachees au NUMERO DE PLACE, jamais au joueur : on se
 * repere a la couleur pendant tout le match, et elle ne doit pas changer parce
 * qu'un adversaire est parti.
 */

export const FOND = '#120f1c';
export const SOL_CLAIR = '#2f7d4f';
export const SOL_SOMBRE = '#276942';
export const SOL_MOTIF = '#286a44';

export const MUR_FACE = '#8b94a8';
export const MUR_HAUT = '#b9c2d4';
export const MUR_BAS = '#5b6377';
export const MUR_TRAIT = '#3b4150';

export const BRIQUE_FACE = '#b5563c';
export const BRIQUE_HAUT = '#d4714f';
export const BRIQUE_JOINT = '#7a3526';

export const BOMBE_CORPS = '#1b1b2a';
export const BOMBE_REFLET = '#9aa4bd';
export const MECHE = '#c9a227';
export const ETINCELLE = ['#fff4c2', '#ffd45e', '#ff9f1c'];

export const FLAMME = ['#fffbe8', '#ffe066', '#ff9f1c', '#f4511e'];

export const CONTOUR = '#14121f';
export const OMBRE = 'rgba(0, 0, 0, 0.28)';

/**
 * Couleurs des quatre places : blanc, noir, rouge, bleu — les quatre bombers
 * historiques. Chacune porte son ombre, pour que le volume ne depende pas d'un
 * calcul de teinte a l'execution.
 */
export const PLACES = [
  { nom: 'Blanc', clair: '#f2f2f7', vive: '#d8d8e4', sombre: '#9b9bb0' },
  { nom: 'Noir', clair: '#4a4a5e', vive: '#33333f', sombre: '#1f1f28' },
  { nom: 'Rouge', clair: '#ff6b5e', vive: '#e63946', sombre: '#9d2235' },
  { nom: 'Bleu', clair: '#66c7ff', vive: '#2f80ed', sombre: '#1b4f9c' },
];

/** Couleur d'une place, bornee pour ne jamais rendre undefined. */
export function couleurDePlace(place) {
  return PLACES[((place % PLACES.length) + PLACES.length) % PLACES.length];
}

/**
 * Couleurs des bonus.
 *
 * La plaquette est VIVE et le glyphe sombre, et non l'inverse. Un bonus pose au
 * sol doit sauter aux yeux au milieu d'un damier vert et brun, parfois sous une
 * flamme : avec une plaquette sombre, il se confondait avec le decor et on
 * marchait dessus sans le voir.
 */
export const BONUS_COULEURS = {
  bomb: { fond: '#8d99ae', glyphe: '#14121f', eclat: '#e2e8f0' },
  flame: { fond: '#ff9f1c', glyphe: '#7a2e00', eclat: '#ffe066' },
  speed: { fond: '#48cae4', glyphe: '#073b4c', eclat: '#caf0f8' },
  kick: { fond: '#c77dff', glyphe: '#3c096c', eclat: '#e9d5ff' },
  trigger: { fond: '#70e000', glyphe: '#14331f', eclat: '#ccff33' },
};
