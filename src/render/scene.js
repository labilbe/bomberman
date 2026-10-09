/**
 * Dessin d'un etat d'arene.
 *
 * Le rendu ne decide RIEN : il recoit une vue — grille, objets, bombers,
 * bombes, flammes — et la peint. En solo cette vue est l'etat du moteur ; en
 * ligne, c'est un instantane recu du relais, remis dans la meme forme. Un seul
 * chemin de rendu pour les deux, donc une seule chose a regarder quand l'ecran
 * ne montre pas ce qu'on attend.
 *
 * Il ne sait pas non plus d'ou viennent ses images : il recoit un jeu de sprites
 * (voir jeuDeSprites.js), peint au code ou extrait d'Atomic Bomberman. Les deux
 * n'ont ni la meme taille de case ni la meme taille de sprite, et c'est pour ca
 * que tout passe par `poser()` et par le point d'accroche : aucune mesure n'est
 * ecrite en dur ici.
 */

import {
  COLS,
  ROWS,
  UNITES,
  DUR,
  BRIQUE,
  FLAMME_PAS,
  MECHE_PAS,
  PAS_MS,
  VITESSE_BASE,
} from '../engine/constantes.js';
import { index } from '../engine/grille.js';
import { estVisible, NOMS_BONUS } from '../engine/bonus.js';
import { depuisDessins } from './jeuDeSprites.js';
import { FOND } from './palette.js';

/**
 * De combien le premier battement d'une bombe est plus lent que le dernier.
 *
 * La bombe finit sa meche AU RYTHME DU JEU D'ORIGINE — la duree vient des
 * sequences elles-memes, pas d'un reglage ici — et commence une fois et demie
 * plus lentement. La pulsation reste donc un compte a rebours lisible sans
 * jamais aller plus vite que ce qu'Interplay avait prevu.
 *
 * C'est la correction du reglage precedent, invente de toutes pieces : il
 * finissait a soixante-sept images par seconde, au-dessus du rafraichissement de
 * l'ecran, si bien que les images sautaient et que la bombe clignotait au lieu
 * de battre.
 */
const LENTEUR_DEPART = 1.5;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {ReturnType<typeof depuisDessins>} [jeu]
 */
export function creerScene(canvas, jeu = depuisDessins()) {
  // Le pas de la grille vient du jeu de sprites, et non d'une constante : les
  // tuiles d'Atomic Bomberman font 40 x 36, celles dessinees au code 16 x 16, et
  // une case qui ne colle pas a son dessin laisse des coutures entre les tuiles.
  const TUILE_L = jeu.tuile.largeur;
  const TUILE_H = jeu.tuile.hauteur;
  const LARGEUR_PX = COLS * TUILE_L;
  const HAUTEUR_PX = ROWS * TUILE_H;

  canvas.width = LARGEUR_PX;
  canvas.height = HAUTEUR_PX;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  /** Gravats : purement decoratifs, nourris par l'evenement `brick`. */
  let gravats = [];

  /**
   * Pose un sprite par son point d'accroche.
   *
   * Les coordonnees donnees sont celles du POINT du monde ou le sprite s'accroche
   * — les pieds d'un bomber, le bas d'une tuile — et non le coin de l'image. Tout
   * le calage tient donc ici, une seule fois, au lieu d'un decalage ad hoc a
   * chaque appel.
   */
  function poser(sprite, x, y) {
    if (!sprite) return;
    ctx.drawImage(sprite.toile, Math.round(x - sprite.accrocheX), Math.round(y - sprite.accrocheY));
  }

  /** Le point d'accroche d'une case : son bord bas, au centre. */
  const accrocheCase = (cx, cy) => [cx * TUILE_L + TUILE_L / 2, (cy + 1) * TUILE_H];

  /** Une position du moteur, en pixels. */
  const enPixels = (x, y) => [(x / UNITES) * TUILE_L, (y / UNITES) * TUILE_H];

  /** Image d'une sequence d'apres ce qu'il reste a bruler. */
  function imageDe(suite, reste, total) {
    const avance = 1 - reste / total;
    return suite[Math.min(suite.length - 1, Math.max(0, Math.floor(avance * suite.length)))];
  }

  /**
   * Le sol, en une passe.
   *
   * Quand le jeu de sprites apporte le fond peint du terrain, on le repete
   * verticalement et c'est tout : il fait toute la largeur de l'arene, donc rien
   * ne se repete horizontalement, et ses rangees claires et sombres alternent
   * d'elles-memes puisque la bande en contient deux. C'est ce qui manquait pour
   * retrouver le terrain d'origine — une tuile unique recopiee 195 fois donnait
   * un damier regulier que le jeu n'a jamais eu.
   */
  function dessinerSol() {
    if (jeu.fond) {
      for (let y = 0; y < HAUTEUR_PX; y += jeu.fond.hauteur) {
        ctx.drawImage(jeu.fond.toile, 0, y);
      }
      return;
    }
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const [ax, ay] = accrocheCase(x, y);
        poser(jeu.sol[(x + y) % jeu.sol.length], ax, ay);
      }
    }
  }

  function dessinerTuiles(vue, temps) {
    dessinerSol();
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const [ax, ay] = accrocheCase(x, y);
        const tuile = vue.tuiles[index(x, y)];
        if (tuile === DUR) poser(jeu.mur, ax, ay);
        else if (tuile === BRIQUE) poser(jeu.brique, ax, ay);
      }
    }

    // Bonus au sol, par-dessus le sol et sous tout le reste.
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const valeur = vue.objets[index(x, y)];
        if (!estVisible(valeur)) continue;
        const sprite = jeu.bonus[NOMS_BONUS[valeur]];
        if (!sprite) continue;
        // Un leger flottement : un bonus immobile se confond avec le decor.
        const flotte = Math.round(Math.sin(temps / 220 + x + y) * 1.5);
        const [ax, ay] = accrocheCase(x, y);
        poser(sprite, ax, ay + flotte);
      }
    }
  }

  function dessinerBombes(vue, temps) {
    for (const bombe of vue.bombes) {
      const x = bombe.glisse ? bombe.glisse.x : bombe.cx * UNITES + UNITES / 2;
      const y = bombe.glisse ? bombe.glisse.y : bombe.cy * UNITES + UNITES / 2;
      // La pulsation accelere a mesure que la meche brule : c'est le compte a
      // rebours, et il doit se lire sans chiffre.
      //
      // Elle est tiree de la MECHE, pas de l'horloge. Une cadence qui varie
      // divisant un horodatage absolu — `temps / cadence` — ne donne pas une
      // animation qui accelere : `temps` valant des dizaines de milliers de
      // millisecondes, raccourcir la cadence d'un cheveu deplace le quotient de
      // plusieurs images d'un coup. L'animation suivait la DERIVEE de la
      // cadence et partait en vrille. Partir de la meche supprime le probleme,
      // et rend la pulsation identique sur tous les ecrans d'une partie en
      // ligne, puisqu'elle ne depend plus que de l'etat du moteur.
      const brule = MECHE_PAS - bombe.meche;
      // Cycles par pas, au depart puis a l'arrivee ; la phase est leur integrale,
      // ce qui donne une acceleration continue au lieu d'un saut de cadence.
      const fin = PAS_MS / jeu.bombeCycle;
      const debut = fin / LENTEUR_DEPART;
      const cycles = debut * brule + ((fin - debut) * brule * brule) / (2 * MECHE_PAS);
      const suite = jeu.bombe[bombe.place] ?? jeu.bombe[0];
      const [px, py] = enPixels(x, y);
      poser(suite[Math.floor(cycles * suite.length) % suite.length], px, py + TUILE_H / 2);
    }
  }

  /**
   * Choisit la piece de flamme d'une case : centre, milieu ou bout.
   *
   * Le moteur ne dit pas de quelle branche vient une flamme — il ne connait que
   * des cases qui brulent. On le deduit du voisinage, ici et pas dans le moteur :
   * c'est une question d'image, pas de regle, et les sprites dessines au code
   * n'en ont aucun besoin. Un bout pointe a l'OPPOSE de son voisin, sinon le
   * souffle a l'air de rentrer dans le mur au lieu d'en sortir.
   */
  function pieceFlamme(occupees, flamme) {
    // Les pieces sont declinees par place : l'explosion porte la couleur de
    // celui qui a pose la bombe, comme dans Atomic Bomberman.
    const jeuDeFlammes = jeu.flamme[flamme.place] ?? jeu.flamme[0];
    const cx = flamme.cx;
    const cy = flamme.cy;
    const la = (x, y) => occupees.has(`${x},${y}`);
    const haut = la(cx, cy - 1);
    const bas = la(cx, cy + 1);
    const gauche = la(cx - 1, cy);
    const droite = la(cx + 1, cy);

    if ((haut || bas) && (gauche || droite)) return jeuDeFlammes.centre;
    if (gauche && droite) return jeuDeFlammes.milieu[1];
    if (haut && bas) return jeuDeFlammes.milieu[0];
    if (droite) return jeuDeFlammes.bout[3];
    if (gauche) return jeuDeFlammes.bout[1];
    if (bas) return jeuDeFlammes.bout[0];
    if (haut) return jeuDeFlammes.bout[2];
    return jeuDeFlammes.centre;
  }

  function dessinerFlammes(vue) {
    const occupees = new Set(vue.flammes.map((f) => `${f.cx},${f.cy}`));
    for (const flamme of vue.flammes) {
      const suite = pieceFlamme(occupees, flamme);
      const [ax, ay] = accrocheCase(flamme.cx, flamme.cy);
      poser(imageDe(suite, flamme.reste, FLAMME_PAS), ax, ay);
    }
  }

  /**
   * Image du cycle de marche, choisie d'apres la DISTANCE PARCOURUE.
   *
   * C'est ce qui empeche les pieds de glisser sur l'herbe. Reglee sur l'horloge
   * — une image toutes les 100 ms — la foulee ne savait rien de la vitesse : le
   * bomber traversait une case en 180 ms sans avoir fait deux pas, et avec le
   * bonus de vitesse l'ecart doublait. En comptant les sous-unites parcourues,
   * la jambe avance exactement avec le sol, a n'importe quelle vitesse.
   *
   * Le calibrage part de la cadence du jeu d'origine : a la vitesse de base, on
   * retrouve exactement ses 30 ms par image.
   */
  const parcours = new Map();
  const dernierePosition = new Map();

  function imageDeMarche(joueur, images) {
    const avant = dernierePosition.get(joueur.place);
    const fait = parcours.get(joueur.place) ?? 0;
    let total = fait;
    if (avant) {
      // Un instantane reseau peut faire sauter un bomber de plusieurs cases. On
      // plafonne le pas pour que la jambe ne parte pas en toupie.
      const bond = Math.abs(joueur.x - avant.x) + Math.abs(joueur.y - avant.y);
      total += Math.min(bond, UNITES);
    }
    parcours.set(joueur.place, total);
    dernierePosition.set(joueur.place, { x: joueur.x, y: joueur.y });

    const parImage = (VITESSE_BASE * jeu.marcheCycle) / (images * PAS_MS);
    return Math.floor(total / parImage) % images;
  }

  function dessinerBombers(vue, temps) {
    // Du haut vers le bas : un bomber plus bas passe devant celui du dessus,
    // sans quoi les silhouettes se chevauchent a l'envers.
    const ordre = vue.joueurs.slice().sort((a, b) => a.y - b.y);
    for (const joueur of ordre) {
      const [px, milieu] = enPixels(joueur.x, joueur.y);
      // Les sprites d'Atomic Bomberman s'accrochent par les PIEDS, et le moteur
      // donne le centre du bomber dans sa case : il faut donc descendre d'une
      // demi-case pour poser le personnage sur le sol de la sienne. Sans ce
      // decalage il flottait une demi-case trop haut et mordait la rangee du
      // dessus — les tuiles, elles, s'accrochent deja a leur bord bas.
      const py = milieu + TUILE_H / 2;

      if (!joueur.vivant) {
        const depuis = vue.pas - (joueur.mortAu ?? vue.pas);
        const suite = jeu.morts[joueur.place];
        ctx.globalAlpha = depuis > 90 ? 0.45 : 1;
        // Une image par pas : l'animation d'origine compte 83 images, et le
        // corps s'efface a 90 pas. Les deux tombent juste ensemble — ralentie,
        // la mort se figeait sur ses dernieres images avant d'avoir fini.
        poser(suite[Math.min(suite.length - 1, depuis)], px, py);
        ctx.globalAlpha = 1;
        continue;
      }

      if (joueur.marche) {
        const suite = jeu.bombers[joueur.place][joueur.dir];
        poser(suite[imageDeMarche(joueur, suite.length)], px, py);
      } else {
        poser(jeu.immobiles[joueur.place][joueur.dir], px, py);
      }

      if (joueur.absent) {
        // Un joueur coupe reste en jeu, immobile : il faut le dire a l'ecran,
        // sinon les autres croient a un bomber qui les guette.
        ctx.fillStyle = 'rgba(18, 15, 28, 0.55)';
        ctx.fillRect(px - TUILE_L / 2, py - TUILE_H, TUILE_L, TUILE_H);
      }
    }
  }

  /**
   * Une brique qui tombe.
   *
   * Avec les sprites du jeu d'origine on joue la vraie animation ; sans eux, on
   * retombe sur une poignee d'eclats. Les deux durent 320 ms, pour que le reste
   * du rendu n'ait pas a savoir lequel tourne.
   */
  function dessinerGravats(temps) {
    gravats = gravats.filter((gravat) => temps - gravat.ne < 320);
    for (const gravat of gravats) {
      const avance = (temps - gravat.ne) / 320;
      if (jeu.briqueCasse) {
        const suite = jeu.briqueCasse;
        const [ax, ay] = accrocheCase(gravat.cx, gravat.cy);
        poser(suite[Math.min(suite.length - 1, Math.floor(avance * suite.length))], ax, ay);
        continue;
      }
      ctx.globalAlpha = 1 - avance;
      ctx.fillStyle = '#7a3526';
      for (const eclat of gravat.eclats) {
        const ex = gravat.cx * TUILE_L + TUILE_L / 2 + eclat.vx * avance * 26;
        const ey = gravat.cy * TUILE_H + TUILE_H / 2 + eclat.vy * avance * 26 + avance * avance * 34;
        ctx.fillRect(Math.round(ex), Math.round(ey), 3, 3);
      }
      ctx.globalAlpha = 1;
    }
  }

  return {
    largeur: LARGEUR_PX,
    hauteur: HAUTEUR_PX,

    /**
     * Prend acte des evenements d'un pas, pour les effets purement visuels.
     * Le rendu ne lit jamais les regles : il se contente de ce qu'on lui raconte.
     */
    evenements(liste, temps) {
      for (const evenement of liste) {
        if (evenement[0] === 'brick') {
          gravats.push({
            cx: evenement[1],
            cy: evenement[2],
            ne: temps,
            eclats: Array.from({ length: 6 }, (_, i) => ({
              vx: Math.cos((i / 6) * Math.PI * 2),
              vy: Math.sin((i / 6) * Math.PI * 2) - 0.4,
            })),
          });
        }
      }
    },

    /**
     * @param {{ tuiles: Uint8Array, objets: Uint8Array, joueurs: unknown[], bombes: unknown[], flammes: unknown[], pas: number }} vue
     * @param {number} temps horodatage d'animation, en ms
     */
    dessiner(vue, temps) {
      // L'arene ne bouge pas. Une secousse a l'explosion donnait du poids au
      // souffle, mais elle deplace aussi les murs sous les yeux du joueur au
      // moment precis ou il cherche par ou sortir — dans un jeu ou l'on meurt
      // pour une case, le decor doit rester le seul point fixe.
      ctx.fillStyle = FOND;
      ctx.fillRect(0, 0, LARGEUR_PX, HAUTEUR_PX);
      dessinerTuiles(vue, temps);
      dessinerGravats(temps);
      dessinerBombes(vue, temps);
      dessinerBombers(vue, temps);
      dessinerFlammes(vue);
    },
  };
}
