/**
 * Constantes du jeu.
 *
 * Deux choix d'unites commandent tout le moteur, et tous deux ont la meme
 * raison : l'arene est simulee par le relais et rejouee par les tests, donc
 * deux executions doivent donner exactement le meme etat, bit pour bit.
 *
 * 1. Les positions sont des ENTIERS en sous-unites de tuile (UNITES par tuile),
 *    jamais des pixels flottants. Un flottant accumule sur dix mille pas finit
 *    par differer d'une machine a l'autre, et un joueur se retrouve mort d'un
 *    cote et vivant de l'autre.
 * 2. Les durees se comptent en PAS de simulation, pas en millisecondes. Le pas
 *    est fixe ; seule la boucle appelante decide combien de pas rattraper.
 */

/** Grille classique : impaire dans les deux sens, pour que les coins soient des couloirs. */
export const COLS = 15;
export const ROWS = 13;

/** Nature d'une case. */
export const VIDE = 0;
export const DUR = 1;
export const BRIQUE = 2;

/** Sous-unites par tuile. Puissance de deux : les divisions restent exactes. */
export const UNITES = 1024;

/** Largeur de l'arene en sous-unites. */
export const LARGEUR_U = COLS * UNITES;
export const HAUTEUR_U = ROWS * UNITES;

/** Cadence de simulation. Fixe, et jamais negociee avec l'appelant. */
export const PAS_HZ = 60;
export const PAS_MS = 1000 / PAS_HZ;

/** Cadence de diffusion reseau : un instantane sur deux pas. */
export const TICK_HZ = 30;

/**
 * Demi-largeur de la boite d'un bomber : 0,37 tuile, soit 0,74 tuile de large
 * dans un couloir d'une tuile. Assez etroit pour tourner sans se coincer,
 * assez large pour que les flammes ne passent pas a cote.
 */
export const DEMI_BOMBER = Math.round(0.37 * UNITES);

/**
 * Vitesses, en sous-unites par pas.
 *
 * 94 u/pas ~= 5,5 tuiles/s : la vitesse d'Atomic Bomberman, ou l'on traverse la
 * grille en deux secondes et demie. Les paliers sont entiers pour que la somme
 * des pas ne depende pas de l'ordre des additions.
 */
export const VITESSE_BASE = 94;
export const VITESSE_PALIER = 18;
export const VITESSE_MAX = 184;
export const VITESSE_BOMBE = 240;

/** Duree de meche : 2,4 s. Le temps de reculer de deux cases, pas de trois. */
export const MECHE_PAS = 144;

/** Duree d'une flamme : 0,5 s a l'ecran, et mortelle pendant toute sa duree. */
export const FLAMME_PAS = 30;

/**
 * Dotation de depart d'un bomber a chaque manche.
 *
 * Ce sont les valeurs d'Atomic Bomberman, pas les notres : son fichier
 * DATA/RES/VALUELST.RES les donne en clair, « 50,1 ; number of bombs » et
 * « 51,2 ; flame length (cells beyond epicenter blast) ». On demarrait a une
 * seule case de portee, et le souffle paraissait court a qui connait le jeu.
 */
export const BOMBES_DEPART = 1;
export const FLAMME_DEPART = 2;

/** Plafonds des ramassages, pour qu'une manche ne degenere pas. */
export const BOMBES_MAX = 8;
export const FLAMME_MAX = 8;

/** Nombre maximal de bombers dans une arene. */
export const MAX_JOUEURS = 4;

/** Pause apres la derniere mort, avant l'annonce de la manche. */
export const FIN_MANCHE_PAS = 90;

/** Directions, dans l'ordre ou le moteur les evalue. */
export const HAUT = 0;
export const DROITE = 1;
export const BAS = 2;
export const GAUCHE = 3;

/** Vecteurs des quatre directions, indexes par les constantes ci-dessus. */
export const VECTEURS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

/** Types de bonus. Les chaines voyagent sur le reseau : elles sont en anglais. */
export const BONUS = {
  BOMBE: 'bomb',
  FLAMME: 'flame',
  VITESSE: 'speed',
  KICK: 'kick',
  DETONATEUR: 'trigger',
};
