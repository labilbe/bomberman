/**
 * Chargement des sprites vectoriels extraits d'Atomic Bomberman.
 *
 * Les SVG ne sont PAS dessines a chaque image. Ils sont rasterises une fois au
 * demarrage dans des canvas hors-ecran, et c'est ce canvas que la scene recopie
 * ensuite. La difference n'est pas marginale : un `drawImage` depuis un SVG
 * refait le tracage de quelques centaines de chemins a chaque appel, et le jeu
 * en fait plusieurs centaines par image — le compteur tombait sous dix images
 * par seconde. Rasterises, ce sont de simples recopies de pixels.
 *
 * C'est le prix du choix « SVG au runtime » : un temps de chargement, en echange
 * d'un depot sans asset binaire et de sprites qu'on peut agrandir sans perte.
 *
 * Le jeu d'origine ne stocke qu'un bomber VERT et recolorait sa palette par
 * joueur au moment du rendu. On fait pareil ici, faute de quoi les quatre places
 * seraient indiscernables.
 */

import { PLACES } from './palette.js';

/** Ou le moteur attend les sprites, relativement a la page. */
const DOSSIER = 'assets/jeu';

/**
 * Teinte, saturation, luminosite, sur [0,360] et [0,1].
 */
function versTsl(r, v, b) {
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

/** Retour en RGB. */
function versRvb(t, s, l) {
  if (s === 0) {
    const g = Math.round(l * 255);
    return [g, g, g];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (decalage) => {
    let x = ((t / 360 + decalage) % 1 + 1) % 1;
    if (x < 1 / 6) x = p + (q - p) * 6 * x;
    else if (x < 1 / 2) x = q;
    else if (x < 2 / 3) x = p + (q - p) * (2 / 3 - x) * 6;
    else x = p;
    return Math.round(x * 255);
  };
  return [canal(1 / 3), canal(0), canal(-1 / 3)];
}

/**
 * Repeint le vert d'un sprite dans la couleur d'un joueur.
 *
 * La couleur vient des tables du jeu (voir scripts/ani/remap.mjs), mais elle est
 * appliquee par une ROTATION DE TEINTE, et non en substituant les couleurs une a
 * une comme le fait Atomic Bomberman. La raison est dans ce module-la : ses
 * tables sont faites pour l'art 8 bits, et appliquees a nos sprites 16 bits
 * elles envoient deux pixels voisins sur des couleurs sans rapport. Le sprite
 * sortait tachete, le casque bariole.
 *
 * La rotation, elle, garde la LUMINOSITE de chaque pixel : les cent soixante
 * nuances du bomber survivent toutes, donc le volume et les reflets aussi.
 *
 * On ne touche qu'aux pixels franchement verts et assez satures. Le casque, la
 * visiere et les pieces metalliques sont gris : les teinter effacerait ce qui
 * rend la silhouette lisible, et c'est precisement ce que faisait la
 * substitution par palette.
 */
function recolorer(donnees, couleur) {
  for (let i = 0; i < donnees.length; i += 4) {
    if (donnees[i + 3] === 0) continue;
    const [t, s, l] = versTsl(donnees[i], donnees[i + 1], donnees[i + 2]);
    if (s < 0.25 || t < 70 || t > 170) continue;
    const clarte = Math.min(1, Math.max(0, l + couleur.clarte * (1 - l)));
    const [r, v, b] = versRvb(couleur.teinte, couleur.saturation, clarte);
    donnees[i] = r;
    donnees[i + 1] = v;
    donnees[i + 2] = b;
  }
}


/**
 * Charge une image, par `onload` et non par `decode()`.
 *
 * `decode()` est l'API faite pour ca, et c'est pourtant elle le piege : sur le
 * PNG du sol, elle ne rend JAMAIS la main — ni resolution ni rejet. Le meme
 * fichier se charge pourtant sans broncher par `onload`, par
 * `createImageBitmap`, et s'affiche tel quel dans un onglet ; il passe aussi la
 * verification de ses CRC et de la taille de son IDAT. Le fichier n'a donc rien,
 * c'est `decode()` qui s'arrete.
 *
 * Et comme le chargement est attendu en tete de module dans main.js, une seule
 * promesse en suspens suffisait a ne jamais construire la scene : le menu
 * restait affiche, les boutons sans effet, sans la moindre erreur en console.
 */
function charger(url) {
  return new Promise((resoudre, rejeter) => {
    const image = new Image();
    image.onload = () => resoudre(image);
    image.onerror = () => rejeter(new Error(`image illisible : ${url}`));
    image.src = url;
  });
}

/** Rasterise un SVG dans un canvas, a l'echelle demandee. */
async function rasteriser(url, largeur, hauteur, echelle) {
  const image = await charger(url);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(largeur * echelle);
  canvas.height = Math.round(hauteur * echelle);
  const ctx = canvas.getContext('2d');
  // Le lissage reste ACTIF ici, contrairement au reste du jeu : on agrandit un
  // dessin vectoriel, pas des pixels, et le navigateur rend les courbes mieux
  // que ne le ferait une recopie au plus proche.
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Un sprite tel que la scene le consomme : une toile et son point d'accroche. */
function sprite(canvas, source, echelle) {
  return {
    toile: canvas,
    largeur: canvas.width,
    hauteur: canvas.height,
    accrocheX: source.accrocheX * echelle,
    accrocheY: source.accrocheY * echelle,
  };
}

/**
 * Les roles qui portent la couleur du joueur, et doivent donc etre declines.
 *
 * Les flammes en font partie : dans Atomic Bomberman, une explosion prend la
 * couleur de celui qui a pose la bombe. C'est meme a ca qu'on reconnait qui
 * vient de vous tuer.
 */
const PAR_PLACE = /^(marche|immobile)\d$|^mort$|^bombe|^flamme/;

/**
 * Charge le jeu de sprites vectoriels.
 *
 * Rend `null` si les assets ne sont pas la — c'est le cas normal d'un depot
 * fraichement clone, et l'appelant retombe alors sur les sprites dessines au
 * code. Une absence d'assets n'est pas une erreur.
 */
export async function chargerVectoriels({ dossier = DOSSIER, echelle = 1 } = {}) {
  let manifeste;
  try {
    const reponse = await fetch(`${dossier}/manifeste.json`);
    if (!reponse.ok) return null;
    manifeste = await reponse.json();
  } catch {
    return null;
  }

  const toiles = await Promise.all(
    manifeste.images.map((im) => rasteriser(`${dossier}/${im.fichier}`, im.largeur, im.hauteur, echelle)),
  );

  // Le sol est la seule image matricielle du lot : c'est la bande peinte du
  // terrain, deux rangees sur toute la largeur, que la scene repete
  // verticalement. Il passe par le meme rasteriseur que les SVG.
  const sol = manifeste.sol
    ? {
      toile: await rasteriser(`${dossier}/${manifeste.sol.fichier}`, manifeste.sol.largeur, manifeste.sol.hauteur, echelle),
      largeur: Math.round(manifeste.sol.largeur * echelle),
      hauteur: Math.round(manifeste.sol.hauteur * echelle),
    }
    : null;

  /**
   * Applique une transformation de couleurs a une toile, une seule fois.
   *
   * Le cache porte sur la paire image/transformation, et il compte : une image
   * de bomber sert aux quatre places et une image de flamme revient dans
   * plusieurs sequences. Sans lui on repasserait des dizaines de milliers de
   * pixels a chaque reutilisation, au demarrage, pour un resultat identique.
   */
  const transformees = new Map();
  function transformer(indice, cle, operation) {
    const complete = `${indice}:${cle}`;
    if (!transformees.has(complete)) {
      const base = toiles[indice];
      const canvas = document.createElement('canvas');
      canvas.width = base.width;
      canvas.height = base.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(base, 0, 0);
      const donnees = ctx.getImageData(0, 0, canvas.width, canvas.height);
      operation(donnees.data);
      ctx.putImageData(donnees, 0, 0);
      transformees.set(complete, canvas);
    }
    return transformees.get(complete);
  }

  // Les dix couleurs du jeu, lues a l'extraction dans COLOR.PAL et les .RMP.
  const couleurs = manifeste.couleursJoueur ?? [];
  const roles = {};
  /**
   * Duree d'un tour complet de chaque sequence, en millisecondes.
   *
   * C'est le rythme qu'Atomic Bomberman donnait lui-meme a l'animation, somme
   * des durees de ses pas. Sans lui il faut inventer une cadence, et une cadence
   * inventee ne tient pas d'un jeu de sprites a l'autre : la bombe du jeu compte
   * dix-huit pas la ou celle dessinee au code en compte trois.
   */
  const cycles = {};
  for (const [nom, pas] of Object.entries(manifeste.roles)) {
    cycles[nom] = pas.reduce((somme, p) => somme + p.duree, 0);
    const suite = (toile, p) => sprite(toile, manifeste.images[p.image], echelle);
    if (PAR_PLACE.test(nom)) {
      roles[nom] = PLACES.map((_, place) =>
        pas.map((p) => suite(transformer(p.image, `place${place}`, (d) => recolorer(d, couleurs[place % couleurs.length])), p)));
    } else {
      roles[nom] = pas.map((p) => suite(toiles[p.image], p));
    }
  }

  return {
    tuile: {
      largeur: Math.round(manifeste.tuile.largeur * echelle),
      hauteur: Math.round(manifeste.tuile.hauteur * echelle),
    },
    sol,
    roles,
    cycles,
  };
}
