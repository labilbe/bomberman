/**
 * Sprites dessines au code, une fois, au demarrage.
 *
 * Aucun fichier image dans ce projet, et c'est un choix structurel : le depot
 * reste sans dependance ni asset binaire, le service worker n'a rien de lourd a
 * mettre en cache, et il n'y a aucune question de droits sur des sprites tires
 * d'un jeu commercial. Tout est peint dans des canvas hors-ecran, puis recopie
 * des milliers de fois par seconde — dessiner a chaque image couterait cent fois
 * plus cher.
 *
 * Tout est peint sur une grille de 16 x 16 PIXELS, puis agrandi d'un facteur
 * entier avec le lissage coupe. C'est ce qui donne des bords francs : un sprite
 * dessine a 32 pixels puis reduit baverait, et un agrandissement non entier
 * ferait des pixels de largeurs differentes dans la meme image.
 */

import {
  SOL_CLAIR,
  SOL_SOMBRE,
  SOL_MOTIF,
  MUR_FACE,
  MUR_HAUT,
  MUR_BAS,
  MUR_TRAIT,
  BRIQUE_FACE,
  BRIQUE_HAUT,
  BRIQUE_JOINT,
  BOMBE_CORPS,
  BOMBE_REFLET,
  MECHE,
  ETINCELLE,
  FLAMME,
  CONTOUR,
  OMBRE,
  BONUS_COULEURS,
  couleurDePlace,
} from './palette.js';

/** Cote d'un sprite, en pixels d'art. */
export const COTE = 16;

/** Nombre d'images du cycle de marche. */
export const IMAGES_MARCHE = 4;

function toile(largeur = COTE, hauteur = COTE) {
  const canvas = document.createElement('canvas');
  canvas.width = largeur;
  canvas.height = hauteur;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function bloc(ctx, x, y, largeur, hauteur, couleur) {
  ctx.fillStyle = couleur;
  ctx.fillRect(x, y, largeur, hauteur);
}

function point(ctx, x, y, couleur) {
  bloc(ctx, x, y, 1, 1, couleur);
}

/**
 * Disque trace pixel par pixel.
 *
 * `arc()` aurait donne un bord lisse, donc flou apres agrandissement : sur une
 * grille de 16 pixels, un contour anticrenele mange la moitie de la silhouette.
 */
function disque(ctx, cx, cy, rayon, couleur) {
  const limite = rayon * rayon;
  for (let y = Math.floor(cy - rayon); y <= Math.ceil(cy + rayon); y += 1) {
    for (let x = Math.floor(cx - rayon); x <= Math.ceil(cx + rayon); x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= limite) point(ctx, x, y, couleur);
    }
  }
}

/** Le sol : deux nuances en damier, pour que le deplacement se voie. */
function peindreSol(pair) {
  const { canvas, ctx } = toile();
  bloc(ctx, 0, 0, COTE, COTE, pair ? SOL_CLAIR : SOL_SOMBRE);
  for (let y = 1; y < COTE; y += 4) {
    for (let x = pair ? 1 : 3; x < COTE; x += 4) point(ctx, x, y, SOL_MOTIF);
  }
  return canvas;
}

/** Mur indestructible : un bloc biseaute, franchement plus clair que la brique. */
function peindreMurDur() {
  const { canvas, ctx } = toile();
  bloc(ctx, 0, 0, COTE, COTE, MUR_FACE);
  bloc(ctx, 0, 0, COTE, 2, MUR_HAUT);
  bloc(ctx, 0, 0, 2, COTE, MUR_HAUT);
  bloc(ctx, 0, COTE - 3, COTE, 3, MUR_BAS);
  bloc(ctx, COTE - 3, 0, 3, COTE, MUR_BAS);
  bloc(ctx, 0, 0, COTE, 1, MUR_TRAIT);
  bloc(ctx, 0, 0, 1, COTE, MUR_TRAIT);
  bloc(ctx, 0, COTE - 1, COTE, 1, MUR_TRAIT);
  bloc(ctx, COTE - 1, 0, 1, COTE, MUR_TRAIT);
  // Un reflet en haut a gauche : il donne le volume et distingue le mur de la
  // brique sans dependre de la teinte, donc meme pour un oeil daltonien.
  bloc(ctx, 2, 2, 4, 2, '#d7deec');
  return canvas;
}

/** Brique destructible : appareillage visible, joints sombres. */
function peindreBrique() {
  const { canvas, ctx } = toile();
  bloc(ctx, 0, 0, COTE, COTE, BRIQUE_JOINT);
  for (let rang = 0; rang < 4; rang += 1) {
    const y = rang * 4;
    const decalage = rang % 2 === 0 ? 0 : 4;
    for (let x = -4; x < COTE; x += 8) {
      bloc(ctx, x + decalage, y, 7, 3, BRIQUE_FACE);
      bloc(ctx, x + decalage, y, 7, 1, BRIQUE_HAUT);
    }
  }
  bloc(ctx, 0, 0, COTE, 1, CONTOUR);
  bloc(ctx, 0, COTE - 1, COTE, 1, CONTOUR);
  bloc(ctx, 0, 0, 1, COTE, CONTOUR);
  bloc(ctx, COTE - 1, 0, 1, COTE, CONTOUR);
  return canvas;
}

/**
 * Bombe : trois images de pulsation.
 *
 * La pulsation n'est pas une coquetterie — c'est le seul signal qui dit qu'une
 * bombe est vivante, et le joueur l'utilise pour juger du temps qui reste.
 */
function peindreBombe(image) {
  const { canvas, ctx } = toile();
  const rayon = 5 + image * 0.6;
  const cy = 9;
  bloc(ctx, 4, COTE - 2, 8, 1, OMBRE);
  disque(ctx, 8, cy, rayon + 0.9, CONTOUR);
  disque(ctx, 8, cy, rayon, BOMBE_CORPS);
  point(ctx, 6, cy - 2, BOMBE_REFLET);
  point(ctx, 5, cy - 1, BOMBE_REFLET);
  // Meche, puis etincelle : elle change de couleur a chaque image, ce qui rend
  // la pulsation lisible meme quand la bombe est cachee derriere un bomber.
  bloc(ctx, 9, 3, 1, 2, MECHE);
  bloc(ctx, 10, 2, 1, 2, MECHE);
  point(ctx, 11, 1, ETINCELLE[image % ETINCELLE.length]);
  point(ctx, 12, 0, ETINCELLE[(image + 1) % ETINCELLE.length]);
  return canvas;
}

/**
 * Flamme : quatre images, du blanc au rouge.
 *
 * Chaque couche est une CROIX pleine bord a bord, plus un disque au centre. La
 * croix n'est pas decorative : les flammes voisines doivent se rejoindre d'une
 * case a l'autre pour former un bras continu. Avec des disques seuls, une
 * explosion de portee trois ressemblait a un chapelet de bulles separees, et on
 * ne voyait plus ou s'arretait le souffle — ce qui est precisement ce qu'il faut
 * lire pour survivre.
 */
function peindreFlamme(image) {
  const { canvas, ctx } = toile();
  const epaisseurs = [
    [6, 5, 3.5, 2],
    [7, 5.5, 4, 2.5],
    [5.5, 4, 3, 1.5],
    [3.5, 2.5, 1.5, 1],
  ][image];

  for (let couche = 0; couche < 4; couche += 1) {
    const demi = epaisseurs[couche];
    if (demi <= 0) continue;
    const couleur = FLAMME[3 - couche];
    const bande = Math.max(1, Math.round(demi * 2));
    const debut = Math.round(8 - demi);
    bloc(ctx, 0, debut, COTE, bande, couleur);
    bloc(ctx, debut, 0, bande, COTE, couleur);
    disque(ctx, 8, 8, demi + 1, couleur);
  }
  return canvas;
}

/** Glyphes des bonus, dessines dans une plaquette. */
function peindreBonus(nom) {
  const { canvas, ctx } = toile();
  const couleurs = BONUS_COULEURS[nom] ?? BONUS_COULEURS.bomb;
  bloc(ctx, 1, 1, 14, 14, CONTOUR);
  bloc(ctx, 2, 2, 12, 12, couleurs.fond);
  bloc(ctx, 2, 2, 12, 2, couleurs.eclat);
  bloc(ctx, 2, 12, 12, 2, couleurs.glyphe);

  if (nom === 'bomb') {
    disque(ctx, 8, 9, 3.2, couleurs.glyphe);
    bloc(ctx, 9, 5, 1, 2, MECHE);
    point(ctx, 10, 4, couleurs.eclat);
  } else if (nom === 'flame') {
    for (let y = 0; y < 6; y += 1) bloc(ctx, 6 - Math.floor(y / 2), 5 + y, 4 + y, 1, couleurs.glyphe);
    bloc(ctx, 7, 8, 2, 3, couleurs.eclat);
  } else if (nom === 'speed') {
    // Un eclair : trois segments decales, lisibles meme a 16 pixels.
    bloc(ctx, 9, 4, 3, 1, couleurs.glyphe);
    bloc(ctx, 7, 5, 4, 1, couleurs.glyphe);
    bloc(ctx, 6, 6, 4, 1, couleurs.glyphe);
    bloc(ctx, 5, 7, 6, 1, couleurs.eclat);
    bloc(ctx, 7, 8, 4, 1, couleurs.glyphe);
    bloc(ctx, 6, 9, 4, 1, couleurs.glyphe);
    bloc(ctx, 5, 10, 3, 1, couleurs.glyphe);
  } else if (nom === 'kick') {
    // Une semelle de botte, de profil.
    bloc(ctx, 5, 5, 3, 5, couleurs.glyphe);
    bloc(ctx, 5, 9, 7, 2, couleurs.glyphe);
    bloc(ctx, 5, 5, 3, 1, couleurs.eclat);
  } else {
    // Detonateur : un boitier et son antenne.
    bloc(ctx, 6, 7, 5, 4, couleurs.glyphe);
    bloc(ctx, 10, 4, 1, 3, couleurs.glyphe);
    point(ctx, 11, 3, couleurs.eclat);
    bloc(ctx, 7, 8, 2, 1, couleurs.eclat);
  }
  return canvas;
}

/**
 * Un bomber : place, direction, image de marche.
 *
 * Dessine en 16 x 16 avec les pieds en bas. La silhouette est la meme dans les
 * quatre directions — un ovale casque — et seuls la visiere et le balancement
 * des pieds changent. C'est ce qui permet de reconnaitre son personnage de loin
 * tout en voyant ou il regarde.
 */
function peindreBomber(place, dir, image) {
  const { canvas, ctx } = toile();
  const couleur = couleurDePlace(place);
  const pied = [0, 1, 0, -1][image % IMAGES_MARCHE];

  bloc(ctx, 4, 15, 8, 1, OMBRE);

  // Jambes, decalees en opposition pour donner le pas.
  bloc(ctx, 5, 12 + Math.max(0, pied), 3, 3, CONTOUR);
  bloc(ctx, 8, 12 + Math.max(0, -pied), 3, 3, CONTOUR);
  bloc(ctx, 5, 13 + Math.max(0, pied), 3, 2, couleur.sombre);
  bloc(ctx, 8, 13 + Math.max(0, -pied), 3, 2, couleur.sombre);

  // Corps.
  disque(ctx, 8, 8, 6.4, CONTOUR);
  disque(ctx, 8, 8, 5.6, couleur.vive);
  // Lumiere en haut a gauche, ombre en bas a droite : le volume, en deux traits.
  disque(ctx, 6.6, 6.4, 3.2, couleur.clair);
  for (let y = 10; y < 13; y += 1) bloc(ctx, 9, y, 3, 1, couleur.sombre);

  // Casque : une calotte plus claire, qui separe la tete du corps.
  for (let y = 2; y < 5; y += 1) bloc(ctx, 5 + (y === 2 ? 1 : 0), y, y === 2 ? 6 : 8, 1, couleur.clair);
  bloc(ctx, 4, 5, 8, 1, CONTOUR);

  // Visiere, orientee.
  if (dir === 2) {
    bloc(ctx, 5, 6, 6, 3, '#eaf2ff');
    bloc(ctx, 6, 7, 1, 1, CONTOUR);
    bloc(ctx, 9, 7, 1, 1, CONTOUR);
  } else if (dir === 0) {
    bloc(ctx, 5, 6, 6, 2, couleur.sombre);
    bloc(ctx, 6, 6, 4, 1, CONTOUR);
  } else if (dir === 1) {
    bloc(ctx, 7, 6, 5, 3, '#eaf2ff');
    bloc(ctx, 10, 7, 1, 1, CONTOUR);
    bloc(ctx, 5, 6, 2, 3, couleur.sombre);
  } else {
    bloc(ctx, 4, 6, 5, 3, '#eaf2ff');
    bloc(ctx, 5, 7, 1, 1, CONTOUR);
    bloc(ctx, 9, 6, 2, 3, couleur.sombre);
  }

  return canvas;
}

/** Un bomber mort : la silhouette s'affaisse et perd ses couleurs. */
function peindreMort(place, image) {
  const { canvas, ctx } = toile();
  const couleur = couleurDePlace(place);
  const aplat = image;
  bloc(ctx, 3, 15, 10, 1, OMBRE);
  disque(ctx, 8, 12 + aplat, 5.2 - aplat, CONTOUR);
  disque(ctx, 8, 12 + aplat, 4.4 - aplat, couleur.sombre);
  if (aplat < 2) {
    bloc(ctx, 6, 10, 1, 1, '#eaf2ff');
    bloc(ctx, 9, 10, 1, 1, '#eaf2ff');
  }
  return canvas;
}

/**
 * Construit tous les sprites. A appeler une fois, apres le chargement du
 * document.
 */
export function construireSprites(places = 4) {
  const bombers = [];
  const morts = [];
  for (let place = 0; place < places; place += 1) {
    bombers.push(
      [0, 1, 2, 3].map((dir) =>
        Array.from({ length: IMAGES_MARCHE }, (_, image) => peindreBomber(place, dir, image)),
      ),
    );
    morts.push(Array.from({ length: 3 }, (_, image) => peindreMort(place, image)));
  }

  return {
    sol: [peindreSol(true), peindreSol(false)],
    murDur: peindreMurDur(),
    brique: peindreBrique(),
    bombe: Array.from({ length: 3 }, (_, image) => peindreBombe(image)),
    flamme: Array.from({ length: 4 }, (_, image) => peindreFlamme(image)),
    bonus: {
      bomb: peindreBonus('bomb'),
      flame: peindreBonus('flame'),
      speed: peindreBonus('speed'),
      kick: peindreBonus('kick'),
      trigger: peindreBonus('trigger'),
    },
    bombers,
    morts,
  };
}
