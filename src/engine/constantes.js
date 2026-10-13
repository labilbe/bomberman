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

/**
 * Cadence de diffusion reseau : un instantane par pas.
 *
 * Elle valait 30 Hz, soit un pas sur deux, et c'etait la cause du « lag » qu'on
 * ressentait en ligne — a tort, car ce n'en etait pas. L'aller-retour jusqu'au
 * relais est de QUATORZE millisecondes, mesure : le reseau n'y est pour rien.
 * Mais le moteur avance a 60 Hz et l'ecran se rafraichit a 60 Hz, tandis que les
 * positions n'arrivaient qu'a 30 : le bomber sautait deux pas d'un coup, une
 * image sur deux. Ce n'etait pas du retard, c'etait de la saccade.
 *
 * A 60 Hz, chaque image affichee a sa position. Le cout est une trame de plus
 * par pas et par joueur — quelques centaines d'octets, la ou l'on economise par
 * ailleurs les soixante intentions par seconde que la page envoyait sans raison.
 */
export const TICK_HZ = 60;

/**
 * Demi-largeur de la boite d'un bomber : 0,37 tuile, soit 0,74 tuile de large
 * dans un couloir d'une tuile. Assez etroit pour tourner sans se coincer,
 * assez large pour que les flammes ne passent pas a cote.
 */
export const DEMI_BOMBER = Math.round(0.37 * UNITES);

/**
 * Demi-largeur de la boite qui PREND FEU, plus petite que celle qui se cogne.
 *
 * Les deux etaient confondues, et c'etait une injustice que le jeu d'origine ne
 * commet pas. La boite de collision doit etre large — sans quoi le bomber passe
 * dans les murs — mais s'en servir pour la mort fait mourir a 0,13 tuile du feu,
 * donc AVANT de l'atteindre. On le voyait le mieux sur une brique qui vient de
 * tomber : le joueur abrite derriere elle avancait dans le trou et mourait de la
 * flamme d'a cote, sans jamais etre entre dedans.
 *
 * 0,28 N'EST PAS UN CHIFFRE ROND MAIS UN PLANCHER MESURE. En descendant plus
 * bas, le jeu se desamorce : a 0,25, les bots ne parviennent plus a s'achever
 * et vingt-deux matchs sur quarante s'enlisent — preuve, au passage, qu'une
 * bonne part des morts venait de cet effet de bord plutot que d'un vrai coup au
 * but. C'est le test « quatre bots jouent une partie entiere » qui fixe cette
 * limite, et c'est lui qu'il faudra relire avant de toucher a cette valeur.
 *
 * Elle reste non nulle a dessein : un bomber a moitie dans les flammes doit
 * mourir, sinon on se gare au bord du souffle et le jeu perd son danger. La
 * case voisine d'un foyer devient sure sur 72 % de sa largeur au lieu de 63 —
 * assez pour se tenir dans le trou d'une brique, pas assez pour y flaner.
 */
export const DEMI_MORTEL = Math.round(0.28 * UNITES);

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

/**
 * Vitesse d'une bombe de la GOUTTE : la moitie de celle d'un simple kick.
 *
 * Une bombe shootee ne fait que quelques cases avant de buter sur un mur ; a
 * 14 tuiles par seconde, sa course est breve et le joueur n'a qu'a s'ecarter
 * une fois. Celle de la goutte, elle, ne s'arrete plus : au meme rythme elle
 * balayait l'arene en zigzag plus vite que l'oeil ne la suit, et mourir sous
 * elle tenait du tirage au sort plutot que du placement.
 *
 * A la moitie — 7 tuiles par seconde — on la voit venir, on la contourne, on la
 * reprend d'un coup de pied. Elle reste plus rapide qu'un bomber de base, qui
 * en fait 5,5 : fuir en ligne droite ne suffit pas, il faut tourner. Celui qui
 * a ramasse des patins, lui, la seme — et c'est tant mieux, un bonus doit
 * servir a quelque chose.
 */
export const VITESSE_BOMBE_GOUTTE = 120;

/** Duree de meche : 2,4 s. Le temps de reculer de deux cases, pas de trois. */
export const MECHE_PAS = 144;

/** Duree d'une flamme : 0,5 s a l'ecran, et mortelle pendant toute sa duree. */
export const FLAMME_PAS = 30;

/**
 * Duree de la chute d'une brique : 0,32 s, pendant lesquelles elle BLOQUE.
 *
 * La case ne se vidait pas progressivement, elle se vidait d'un coup : la
 * brique disparaissait a l'instant de l'explosion et l'animation de chute
 * n'etait qu'un decor peint par-dessus du vide. On traversait donc une brique
 * qu'on voyait encore tomber.
 *
 * Elle reste BRIQUE pendant ce decompte, donc infranchissable, et un second
 * souffle s'y arrete comme avant. C'est le moteur qui tient cette duree, et le
 * rendu qui la lit : deux comptes a rebours separes auraient fini par diverger,
 * et le passage se serait ouvert avant ou apres ce que montre l'ecran.
 */
export const CHUTE_PAS = 19;

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

/**
 * Nombre de bombes qu'un detonateur ramasse peut faire sauter.
 *
 * Le detonateur n'est pas un etat acquis mais une RESERVE : il s'epuise, et on
 * revient aux bombes a meche. C'est ce qui l'empeche de dominer la fin de
 * manche — avec un detonateur permanent, celui qui l'a ramasse le premier pose
 * ou il veut et attend indefiniment, et l'autre n'a plus de reponse.
 */
export const DETONATEURS_PAR_BONUS = 5;

/**
 * Le gant de boxe : combien de cases une bombe frappee survole AU MOINS, et en
 * combien de temps par case.
 *
 * Trois cases, parce que c'est ce qui le distingue du coup de pied. Le kick
 * pousse au ras du sol et s'arrete au premier obstacle ; le gant fait PASSER
 * la bombe par-dessus — murs, briques, joueurs — pour la poser derriere. Avec
 * une ou deux cases, les deux bonus se ressembleraient.
 *
 * C'est un minimum et non une limite : si la troisieme case est prise, la bombe
 * continue tout droit jusqu'au premier trou, en sortant par un bord s'il le
 * faut. Un vol peut donc durer bien plus que trois cases — jusqu'a faire le tour
 * du plateau — et la meche brule pendant ce temps.
 *
 * Huit pas par case, soit un peu moins d'une demi-seconde pour trois cases :
 * assez lent pour qu'on voie la bombe arriver et qu'on ait le temps de s'oter
 * de sa trajectoire, assez vif pour que la frappe reste une riposte.
 */
export const PORTEE_GANT = 3;
export const VOL_PAS_PAR_CASE = 8;

/**
 * Duree du GESTE de frappe, en pas : le temps que le poing part et revient.
 *
 * Il est joue des que le bouton est presse avec le gant, meme si rien ne
 * s'envole. C'est ce qui apprend le bonus : sans retour a l'ecran, un joueur qui
 * frappe a cote croit que le gant ne marche pas, et il n'a aucun moyen de
 * deviner qu'il lui manquait seulement une bombe devant lui.
 *
 * Douze pas, soit deux tiers de seconde : assez pour se voir, trop court pour
 * couvrir deux appuis de suite.
 */
export const FRAPPE_PAS = 12;

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
  GANT: 'punch',
  GOUTTE: 'jelly',
};
