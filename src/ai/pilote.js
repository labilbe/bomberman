/**
 * Adversaire artificiel.
 *
 * `decider` est pure : meme etat + meme memoire = meme intention, et elle ne
 * touche jamais l'etat qu'on lui donne. C'est ce qui permet de la faire tourner
 * dans le relais (ou vivent les bots en ligne), dans la page en solo, et sous
 * `node --test` sans arene graphique.
 *
 * Les bots tournent dans le relais et non dans un onglet, contrairement a ceux
 * du Tetris qui ouvraient une vraie WebSocket. Trois raisons : la simulation est
 * dans le relais, donc un bot-client paierait un aller-retour par decision — 60
 * a 100 ms de reflexe en plus, dans un jeu ou l'on meurt pour moins que cela ;
 * il vivrait dans l'onglet d'un joueur, qui en fermant son onglet figerait trois
 * adversaires en pleine manche ; et chacun compterait comme une connexion.
 *
 * Quatre regles, dans cet ordre, et c'est tout le comportement :
 *   1. ma case va bruler    -> fuir
 *   2. un adversaire a portee et j'ai une sortie -> poser
 *   3. une brique a cote et j'ai une sortie      -> poser
 *   4. sinon                -> marcher vers la case la plus interessante
 *
 * La regle qui compte est la condition « et j'ai une sortie » : c'est elle qui
 * empeche le defaut le plus visible d'une IA de Bomberman, celui qui se mure
 * tout seul dans un cul-de-sac.
 */

import { COLS, VECTEURS, MECHE_PAS, FLAMME_PAS } from '../engine/constantes.js';
import { index, caseDe, estLibre, estBrique, caseAxe } from '../engine/grille.js';
import { estVisible } from '../engine/bonus.js';
import { ENTREE_VIDE } from '../engine/entrees.js';
import { carteDanger, dangerAvecBombe, parcourir, fuite, ouverte, SUR } from './danger.js';

/**
 * Pas entre deux decisions, quand rien ne menace.
 *
 * Un bot ne redecide pas a chaque pas : il tiendrait des plans d'un dixieme de
 * case. Mais la valeur exacte se voit a l'ecran — c'est elle qui fait qu'un bot
 * parait pose ou agite — et elle a ete reglee par la mesure, sur 150 manches a
 * quatre bots et 50 matchs complets, plutot qu'au jugement :
 *
 *    4 pas   6,9 changements de direction/s   agite ; 2 matchs sur 50 s'enlisent
 *    8 pas   4,7 /s                           aucun enlisement sur 50
 *   12 pas   3,5 /s                           plus calme, mais 1 match s'enlise
 *   16 pas   2,9 /s                           et les morts sur sa bombe remontent
 *
 * Huit est le compromis : presque deux fois plus calme qu'avant, sans qu'un
 * match reste bloque. Au-dela, deux survivants prudents tournent l'un autour de
 * l'autre sans jamais s'engager, et la manche expire.
 *
 * Attention a ce que ce chiffre MESURE : les deux tiers des changements de
 * direction restants sont le geste normal « je pose contre une brique et je
 * recule », pas de l'hesitation.
 */
export const REFLEXE_PAS = 8;

/** Niveaux : la portee du regard, donc la force. */
export const NIVEAUX = {
  tranquille: { vue: 6, agressivite: 0 },
  normal: { vue: 10, agressivite: 1 },
  teigneux: { vue: 18, agressivite: 2 },
};

/** @typedef {{ dir: number, poser: boolean, depuis: number }} Memoire */

/** Memoire neuve. */
export function creerMemoire() {
  return { dir: -1, poser: false, depuis: -999 };
}

/** Y a-t-il une brique a casser dans l'une des quatre directions, a portee ? */
function briqueAPortee(etat, joueur) {
  const cx = caseAxe(joueur.x);
  const cy = caseAxe(joueur.y);
  for (const v of VECTEURS) {
    for (let pas = 1; pas <= joueur.portee; pas += 1) {
      const tuile = caseDe(etat, cx + v.dx * pas, cy + v.dy * pas);
      if (estBrique(tuile)) return true;
      if (!estLibre(tuile)) break;
    }
  }
  return false;
}

/** Un adversaire vivant est-il aligne, a portee, sans mur entre nous ? */
function adversaireAPortee(etat, joueur) {
  const cx = caseAxe(joueur.x);
  const cy = caseAxe(joueur.y);
  for (const v of VECTEURS) {
    for (let pas = 1; pas <= joueur.portee; pas += 1) {
      const x = cx + v.dx * pas;
      const y = cy + v.dy * pas;
      if (!estLibre(caseDe(etat, x, y))) break;
      for (const autre of etat.joueurs) {
        if (autre.place === joueur.place || !autre.vivant) continue;
        if (caseAxe(autre.x) === x && caseAxe(autre.y) === y) return true;
      }
    }
  }
  return false;
}

/** Interet d'une case : un bonus vaut mieux qu'une brique, qui vaut mieux que rien. */
function interet(etat, joueur, i, niveau) {
  let valeur = 0;
  if (estVisible(etat.objets[i])) valeur += 60;

  const cx = i % COLS;
  const cy = Math.floor(i / COLS);
  for (const v of VECTEURS) {
    if (estBrique(caseDe(etat, cx + v.dx, cy + v.dy))) {
      valeur += 14;
      break;
    }
  }

  if (niveau.agressivite > 0) {
    for (const autre of etat.joueurs) {
      if (autre.place === joueur.place || !autre.vivant) continue;
      const distance = Math.abs(caseAxe(autre.x) - cx) + Math.abs(caseAxe(autre.y) - cy);
      if (distance <= 2) valeur += 10 * niveau.agressivite;
    }
  }

  return valeur;
}

/**
 * Peut-on poser ici sans se condamner ?
 *
 * On ne pose jamais sans avoir verifie qu'une case hors de l'explosion reste
 * atteignable avant la fin de la meche.
 */
function sortieApresPose(etat, joueur, danger) {
  const projete = dangerAvecBombe(etat, joueur, danger, MECHE_PAS);
  const sortie = fuite(etat, joueur, projete);
  // Un repli ne suffit pas : on exige une case que RIEN ne menace, sinon le bot
  // se contente de reculer d'une case dans son propre souffle.
  if (sortie === null || !sortie.sur) return false;
  const pasParCase = Math.ceil(1024 / Math.max(1, joueur.vitesse));
  return sortie.distance * pasParCase + FLAMME_PAS < MECHE_PAS;
}

/**
 * Decide de l'intention d'un bot.
 *
 * @param {import('../engine/etat.js').Etat} etat
 * @param {number} place
 * @param {Memoire} memoire
 * @param {{ niveau?: keyof typeof NIVEAUX }} options
 * @returns {{ entree: import('../engine/entrees.js').Entree, memoire: Memoire }}
 */
export function decider(etat, place, memoire = creerMemoire(), options = {}) {
  const joueur = etat.joueurs.find((candidat) => candidat.place === place);
  if (!joueur || !joueur.vivant) {
    return { entree: { ...ENTREE_VIDE }, memoire: creerMemoire() };
  }

  const niveau = NIVEAUX[options.niveau ?? 'normal'] ?? NIVEAUX.normal;
  const danger = carteDanger(etat);
  const cx = caseAxe(joueur.x);
  const cy = caseAxe(joueur.y);
  const ici = index(cx, cy);
  const menace = danger[ici] < SUR;

  // Entre deux decisions, on tient le cap deja choisi. La pose, elle, n'est
  // jamais repetee : c'est une impulsion.
  //
  // SAUF quand la case va bruler : la peur ne regarde pas la montre. Separer les
  // deux est ce qui permet de ralentir un bot sans le rendre suicidaire — tant
  // que le delai de reflexe s'appliquait aussi au danger, l'allonger pour calmer
  // les allers-retours faisait remonter a 17 % les morts sur sa propre bombe,
  // le bot n'ayant plus le droit de reagir au moment ou il l'aurait fallu.
  if (!menace && etat.pas - memoire.depuis < REFLEXE_PAS) {
    return {
      entree: { dir: memoire.dir, poser: false, declencher: false },
      memoire,
    };
  }

  // 1. Ma case va bruler : tout le reste attend.
  if (menace) {
    const sortie = fuite(etat, joueur, danger);
    const dir = sortie === null ? memoire.dir : sortie.dir;
    const suite = { dir, poser: false, depuis: etat.pas };
    return { entree: { dir, poser: false, declencher: false }, memoire: suite };
  }

  // 2 et 3. Poser, s'il y a quelque chose a casser et qu'il reste une sortie.
  //
  // On n'exige pas que le bomber soit centre sur sa case : le moteur pose la
  // bombe sous le centre du personnage, et sa propre bombe ne le bloque pas tant
  // qu'il est dessus. Exiger le centrage empechait en pratique toute pose, le
  // bot etant presque toujours en transit au moment ou il decide.
  if (adversaireAPortee(etat, joueur) || briqueAPortee(etat, joueur)) {
    if (sortieApresPose(etat, joueur, danger)) {
      const projete = dangerAvecBombe(etat, joueur, danger, MECHE_PAS);
      const sortie = fuite(etat, joueur, projete);
      const dir = sortie === null ? memoire.dir : sortie.dir;
      return {
        entree: { dir, poser: true, declencher: false },
        memoire: { dir, poser: true, depuis: etat.pas },
      };
    }
  }

  // 4. Marcher vers la case la plus interessante, parmi celles qui sont sures.
  //
  // La case courante est exclue de la recherche. Sans cela elle gagnait presque
  // toujours — meme interet que ses voisines, mais distance nulle — le bot
  // n'avait aucune cible, retombait sur l'exploration et faisait des allers et
  // retours entre deux cases jusqu'a la fin de la manche.
  // Le parcours evite les cases menacees : la destination ET le chemin doivent
  // etre surs, sinon le bot repart vers une brique en traversant son propre
  // souffle.
  const { distance, premier } = parcourir(etat, cx, cy, { evite: danger });

  let meilleur = 0;
  let choix = -1;
  for (let i = 0; i < distance.length; i += 1) {
    if (distance[i] <= 0 || distance[i] > niveau.vue) continue;
    const note = interet(etat, joueur, i, niveau) - distance[i];
    if (note > meilleur) {
      meilleur = note;
      choix = i;
    }
  }

  let dir = choix >= 0 ? premier[choix] : -1;
  if (dir < 0) {
    // Rien a faire alentour : on continue tout droit tant que c'est ouvert,
    // sinon on tourne. Garder le cap est ce qui evite l'oscillation : un bot qui
    // rechoisit sa direction a chaque decision fait du sur-place.
    const libre = (v) =>
      v !== null && ouverte(etat, cx + v.dx, cy + v.dy) && danger[index(cx + v.dx, cy + v.dy)] >= SUR;

    dir = memoire.dir;
    if (!libre(VECTEURS[dir] ?? null)) {
      dir = -1;
      for (let candidat = 0; candidat < VECTEURS.length; candidat += 1) {
        // Le decalage par numero de place evite que quatre bots coinces au meme
        // endroit choisissent tous la meme issue, sans faire appel au hasard.
        const essai = (candidat + place) % VECTEURS.length;
        if (libre(VECTEURS[essai])) {
          dir = essai;
          break;
        }
      }
    }
  }

  return {
    entree: { dir, poser: false, declencher: false },
    memoire: { dir, poser: false, depuis: etat.pas },
  };
}

/**
 * Fabrique un pilote pret a brancher dans un transport : il garde sa memoire et
 * ne presente que `(etat, place) -> entree`.
 *
 * @param {{ niveau?: keyof typeof NIVEAUX }} options
 */
export function creerPilote(options = {}) {
  let memoire = creerMemoire();
  return (etat, place) => {
    const resultat = decider(etat, place, memoire, options);
    memoire = resultat.memoire;
    return resultat.entree;
  };
}
