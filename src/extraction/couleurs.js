/**
 * Les couleurs de joueur d'Atomic Bomberman, tirees des fichiers du jeu.
 *
 * Tous les sprites sont dessines en VERT — bombers, bombes, flammes — et c'est
 * voulu : le vert est une rampe neutre que le jeu remplace par la couleur du
 * joueur. Les sequences portent le mot dans leur nom : « bomb regular green »,
 * « flame center green ».
 *
 * Les tables sont a la racine du jeu, a cote de BM.EXE :
 *
 *   COLOR.PAL   768 octets de palette 6 bits, puis 32768 octets de table
 *               inverse qui donne, pour chaque couleur RGB555, l'index de
 *               palette le plus proche.
 *   0.RMP .. 9.RMP   un fichier par joueur : 3 octets d'en-tete puis 256
 *               entrees qui renvoient un index de palette sur un autre.
 *
 * ON NE PEUT PAS APPLIQUER CES TABLES TELLES QUELLES, et c'est le piege de tout
 * ce module. Elles substituent index par index, pour la palette precise de l'art
 * 8 BITS. Or les sprites qu'on extrait sont en 16 bits et portent des teintes
 * qui ne sont dans aucune palette : les chercher « au plus proche » fait tomber
 * deux pixels voisins sur des index sans rapport, et la substitution les envoie
 * sur des couleurs sans rapport. Le resultat est un sprite tachete, avec des
 * liserés et un casque bariole. La table n'est d'ailleurs pas monotone : la
 * source #044100 (luminance 39) devient un blanc casse quand #048600, plus
 * claire, devient un gris fonce.
 *
 * On ne lit donc des tables que ce qu'elles disent de VRAI a toute profondeur :
 * la TEINTE de chaque joueur. Le degrade, lui, reste celui du sprite.
 *
 * Ce module ne touche a aucun fichier : il recoit les octets. C'est ce qui lui
 * permet de servir deux appelants que tout oppose — le script d'extraction, qui
 * lit le disque, et la page, qui recoit le dossier choisi par le visiteur.
 */

/** Nombre de joueurs qu'Atomic Bomberman colorie. */
export const COULEURS = 10;

/** Longueur de la palette, en octets : 256 entrees de trois composantes. */
const PALETTE = 768;

/** Longueur de la table inverse qui suit la palette dans COLOR.PAL. */
const INVERSE = 32768;

/** En-tete d'un fichier .RMP, avant ses 256 entrees. */
const ENTETE_RMP = 3;

/** Index vers lequel pointe une entree qui ne remappe rien. */
const MORTE = 0;

/** Six bits vers huit, en repliant pour que le maximum atteigne vraiment 255. */
const six = (v) => (v << 2) | (v >> 4);

/** Teinte, saturation, luminosite, sur [0,360] et [0,1]. */
function versTsl([r, v, b]) {
  const max = Math.max(r, v, b) / 255;
  const min = Math.min(r, v, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const [R, V, B] = [r / 255, v / 255, b / 255];
  let t;
  if (max === R) t = ((V - B) / d) % 6;
  else if (max === V) t = (B - R) / d + 2;
  else t = (R - V) / d + 4;
  return [((t * 60) + 360) % 360, s, l];
}

/** Mediane : robuste aux quelques cibles aberrantes de ces vieilles tables. */
const mediane = (liste) => {
  const triee = [...liste].sort((a, b) => a - b);
  return triee.length ? triee[triee.length >> 1] : 0;
};

/**
 * Lit la couleur de chaque joueur : teinte, saturation, correction de clarte.
 *
 * On n'interroge les tables que sur les sources VERT PUR — saturation pleine,
 * teinte autour de 120 — car ce sont les seules dont le jeu garantit qu'elles
 * appartiennent a la rampe echangeable. Les gris et les teintes melangees qui
 * trainent dans la plage remappee sont du decor, et les inclure ramenait des
 * valeurs absurdes.
 *
 * @param {Uint8Array} pal contenu de COLOR.PAL
 * @param {Uint8Array[]} rmps contenu de 0.RMP a 9.RMP, dans l'ordre
 * @returns {{ teinte: number, saturation: number, clarte: number }[]}
 */
export function couleursJoueurs(pal, rmps) {
  if (pal.length !== PALETTE + INVERSE) {
    throw new Error(`COLOR.PAL fait ${pal.length} octets, attendu ${PALETTE + INVERSE}`);
  }
  if (rmps.length !== COULEURS) {
    throw new Error(`${rmps.length} fichiers .RMP, attendu ${COULEURS}`);
  }
  const couleur = (i) => [six(pal[i * 3]), six(pal[i * 3 + 1]), six(pal[i * 3 + 2])];

  const sources = [];
  for (let i = 1; i < 256; i += 1) {
    const [teinte, saturation] = versTsl(couleur(i));
    if (saturation < 0.9 || teinte < 100 || teinte > 140) continue;
    if (rmps.every((t) => t[ENTETE_RMP + i] === i)) continue;
    if (rmps.some((t) => t[ENTETE_RMP + i] === MORTE)) continue;
    sources.push(i);
  }

  return rmps.map((table) => {
    const cibles = sources.map((i) => ({
      source: versTsl(couleur(i)),
      cible: versTsl(couleur(table[ENTETE_RMP + i])),
    }));
    // On trie sur le CHROMA, pas sur la saturation TSL : celle-ci monte a 1
    // pour un blanc casse comme #f3fbff, et le joueur blanc passait alors pour
    // une couleur franche. L'ecart entre composantes, lui, ne ment pas.
    const chroma = (i) => (Math.max(...couleur(i)) - Math.min(...couleur(i))) / 255;
    const colorees = cibles.filter((_, k) => chroma(table[ENTETE_RMP + sources[k]]) > 0.12);
    // Blanc et noir n'ont pas de teinte : leurs cibles sont des gris. On garde
    // alors la saturation residuelle, qui est la bonne reponse — presque nulle.
    const retenues = colorees.length > cibles.length / 2 ? colorees : cibles;
    return {
      teinte: Math.round(mediane(retenues.map(({ cible }) => cible[0]))),
      saturation: Number(mediane(retenues.map(({ cible }) => cible[1])).toFixed(2)),
      // De combien le joueur eclaircit ou assombrit la rampe, en moyenne.
      clarte: Number(mediane(cibles.map(({ source, cible }) => cible[2] - source[2])).toFixed(2)),
    };
  });
}
