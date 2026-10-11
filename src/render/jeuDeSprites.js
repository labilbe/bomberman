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

/** Demi-epaisseur du bandeau, en fraction de la hauteur du sprite. */
const BANDEAU = 0.13;

/** Ce qui est ecrit sur le bandeau, et de quelle couleur. */
const MOT_DETONATEUR = 'BOOM';
const TEXTE_DETONATEUR = '#ff2d2d';

/**
 * Inclinaison de repli, si le bouchon reste introuvable.
 *
 * Le bandeau suit normalement l'axe du BOUCHON JAUNE qui coiffe la bombe, parce
 * que c'est lui qui donne son assiette au dessin : un bandeau horizontal sur une
 * bombe penchee se lit comme une erreur de montage. On mesure donc le bouchon
 * plutot que de coder un angle, ce qui a l'avantage de rester juste si les
 * sprites changent.
 */
const INCLINAISON = (-14 * Math.PI) / 180;

/** Un pixel est-il du laiton du bouchon ? Jaune franc : bleu nettement en retrait. */
function estBouchon(r, v, b) {
  const min = Math.min(r, v);
  return min > 90 && b < min * 0.62;
}

/**
 * Axe du bouchon jaune, en radians, ou `null` s'il est introuvable.
 *
 * On prend l'axe principal du nuage de pixels jaunes — la direction dans
 * laquelle ils s'etalent le plus. C'est un calcul de covariance, pas une
 * reconnaissance de forme : le bouchon est un petit cylindre penche, et son
 * etalement suit sa pente.
 */
function axeDuBouchon(donnees, largeur, hauteur) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const i = (y * largeur + x) * 4;
      if (donnees[i + 3] < 128) continue;
      if (!estBouchon(donnees[i], donnees[i + 1], donnees[i + 2])) continue;
      n += 1;
      sx += x;
      sy += y;
    }
  }
  if (n < 8) return null;

  const mx = sx / n;
  const my = sy / n;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const i = (y * largeur + x) * 4;
      if (donnees[i + 3] < 128) continue;
      if (!estBouchon(donnees[i], donnees[i + 1], donnees[i + 2])) continue;
      const dx = x - mx;
      const dy = y - my;
      xx += dx * dx;
      yy += dy * dy;
      xy += dx * dy;
    }
  }
  if (xx === 0 && yy === 0) return null;
  return 0.5 * Math.atan2(2 * xy, xx - yy);
}

/**
 * La meme bombe, ceinte d'un bandeau noir : celle qui attend un detonateur.
 *
 * On ne prend PAS le sprite TRIGBOMB du jeu, bien qu'il existe et que
 * l'extraction le ramene. Ce n'est pas une bombe : c'est un dome aplati avec un
 * bouton rouge et une antenne qui tourne — le recepteur, pas l'engin. La bombe
 * a detonateur d'Atomic Bomberman est la bombe ordinaire, barree d'un bandeau.
 *
 * Le bandeau est pose a l'EQUATEUR, au milieu des lignes de pixels les plus
 * larges. Une fraction fixe de la hauteur ne marcherait pas : la meche occupe
 * le haut du sprite, sa longueur varie d'une image a l'autre, et le bandeau
 * glisserait le long de la bombe pendant l'animation. Le plus grand diametre,
 * lui, est toujours le milieu de la sphere.
 *
 * Il suit aussi la silhouette, puisqu'on ne repeint que les pixels deja opaques
 * — sinon il depasserait en rectangle de part et d'autre.
 */
function avecBandeau(toile, inclinaison = INCLINAISON) {
  const canvas = document.createElement('canvas');
  canvas.width = toile.width;
  canvas.height = toile.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(toile, 0, 0);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  const opaque = (x, y) => d[(y * canvas.width + x) * 4 + 3] > 32;

  // Largeur de chaque rang, puis le MILIEU du plateau le plus large.
  //
  // Le milieu, et non le premier rang qui atteint le maximum : une sphere
  // dessinee en pixels a le haut de son flanc plat, et la bombe compte sept
  // rangs de meme largeur. En gardant le premier, le bandeau se posait trois
  // pixels trop haut — assez pour qu'il coupe la bombe au-dessus de son plus
  // grand diametre, ce qui se voit immediatement.
  const largeurs = [];
  for (let y = 0; y < canvas.height; y += 1) {
    let compte = 0;
    for (let x = 0; x < canvas.width; x += 1) if (opaque(x, y)) compte += 1;
    largeurs.push(compte);
  }
  const plusLarge = Math.max(...largeurs);
  if (plusLarge === 0) return canvas;
  const equateur = Math.round(
    (largeurs.indexOf(plusLarge) + largeurs.lastIndexOf(plusLarge)) / 2,
  );

  let gauche = canvas.width;
  let droite = 0;
  for (let x = 0; x < canvas.width; x += 1) {
    if (!opaque(x, equateur)) continue;
    if (x < gauche) gauche = x;
    if (x > droite) droite = x;
  }
  const large = droite - gauche;
  if (large <= 6) return canvas;

  const demi = Math.max(2, Math.round(canvas.height * BANDEAU));

  // `source-atop` ne peint que la ou il y a deja quelque chose : le bandeau se
  // decoupe donc tout seul sur la silhouette de la bombe, meme en biais. C'est
  // ce qui permet de le poser EN TRAVERS sans deborder en rectangle, ce qu'un
  // parcours ligne par ligne ne savait pas faire.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.translate((gauche + droite) / 2, equateur + 0.5);
  ctx.rotate(inclinaison);

  const long = canvas.width + canvas.height;
  ctx.fillStyle = '#14141a';
  ctx.fillRect(-long, -demi, long * 2, demi * 2);
  // Un lisere plus clair en haut et en bas : sans lui le bandeau se confond
  // avec le bas de la bombe, qui est deja sombre.
  ctx.fillStyle = '#56565f';
  ctx.fillRect(-long, -demi, long * 2, 1);
  ctx.fillRect(-long, demi - 1, long * 2, 1);

  // Le mot. A cette taille il ne se LIT pas vraiment, et c'etait deja le cas
  // dans le jeu d'origine : ce qu'on reconnait, c'est qu'il y a de l'ecriture
  // rouge en travers de la bombe.
  ctx.font = `bold ${Math.max(5, demi * 2)}px 'Arial Narrow', Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = TEXTE_DETONATEUR;
  const mesure = ctx.measureText(MOT_DETONATEUR).width;
  // Le mot remplit le bandeau d un bord a l autre, quitte a s etirer : sur la
  // bombe du jeu il barre toute la sphere, il ne flotte pas au milieu.
  ctx.scale((large - 2) / mesure, 1);
  ctx.fillText(MOT_DETONATEUR, 0, 0);
  ctx.restore();

  return canvas;
}

/** La meme suite de sprites, chacun ceint de son bandeau. */
const suiteAvecBandeau = (suite) => {
  const inclinaison = angleDeLaSuite(suite);
  return suite.map((sprite) => ({ ...sprite, toile: avecBandeau(sprite.toile, inclinaison) }));
};

/**
 * Lit l'angle du bouchon sur la premiere image qui en montre un.
 *
 * L'angle est mesure UNE FOIS et sert pour toute la suite. Le mesurer image par
 * image ferait trembler le bandeau pendant la pulsation : le bouchon ne compte
 * que quelques dizaines de pixels, et un seul qui bascule d'une image a l'autre
 * deplace son axe d'un degre.
 */
function angleDeLaSuite(suite) {
  for (const { toile } of suite) {
    const canvas = document.createElement('canvas');
    canvas.width = toile.width;
    canvas.height = toile.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(toile, 0, 0);
    const donnees = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const angle = axeDuBouchon(donnees, canvas.width, canvas.height);
    if (angle !== null) return angle;
  }
  return INCLINAISON;
}

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
    // Meme regle que pour les sprites extraits : la bombe ordinaire, barree.
    bombeDetonateur: parPlace(() => suiteAvecBandeau(brut.bombe.map(sprite))),
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
    bombeDetonateur: Array.from({ length: places }, (_, p) => suiteAvecBandeau(parPlace('bombe')[p])),
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
