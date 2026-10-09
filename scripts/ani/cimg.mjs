/**
 * Decodeur des morceaux CIMG : les images d'un .ANI.
 *
 * Deux familles coexistent dans les donnees du jeu, distinguees par le champ
 * `extra` de l'en-tete :
 *
 *   extra = 24    image 16 bits, un mot RGB565 par pixel (2254 images sur 2327)
 *   extra = 1056  image 8 bits, avec sa palette de 256 entrees embarquee
 *
 * Les deux partagent la meme compression, decrite sur `developper`.
 *
 * Le fond n'est pas un canal alpha mais une couleur-cle rangee dans l'en-tete —
 * le jeu de 1997 ecrivait en 16 bits sans transparence. On la convertit en alpha
 * zero a la sortie, sinon chaque sprite arrive sur un rectangle opaque.
 */

/** Longueur de l'en-tete de base, avant le bloc `extra`. */
const ENTETE = 12;

/**
 * Lit l'en-tete d'un CIMG.
 *
 * Deux choses ne sont pas devinables. `extra` se compte a partir de l'octet 12,
 * et ses douze derniers octets forment un sous-en-tete qui porte les deux
 * tailles — donc un seul calcul couvre les deux familles. Et `compresse` compte
 * ces douze octets dans son propre total : la charge utile vaut
 * `compresse - 12`. C'est cet ecart qui fait deborder un decodeur naif sur le
 * morceau suivant.
 */
export function lireEnteteImage(octets) {
  const extra = octets.readUInt32LE(4);
  const sousEntete = ENTETE + extra - 12;

  const entete = {
    type: octets.readUInt16LE(0),
    sousType: octets.readUInt16LE(2),
    extra,
    largeur: octets.readUInt16LE(12),
    hauteur: octets.readUInt16LE(14),
    // Le point d'accroche : ou le jeu pose le sprite par rapport a sa case. Les
    // sprites d'Atomic Bomberman sont cadres large avec des marges inegales, et
    // c'est ce point — pas le coin de l'image — qui les aligne sur la grille.
    accrocheX: octets.readUInt16LE(16),
    accrocheY: octets.readUInt16LE(18),
    cle: octets.readUInt16LE(20),
    compresse: octets.readUInt32LE(sousEntete + 4),
    brut: octets.readUInt32LE(sousEntete + 8),
    donnees: ENTETE + extra,
  };

  // La profondeur se lit sur la taille decompressee, pas sur `extra` : trente-deux
  // images du jeu sont en 16 bits ET trainent une palette dont elles ne se
  // servent pas. Deduite de `extra`, elles sortaient lues en 8 bits — un flux
  // deux fois trop court, donc une image tronquee aux trois quarts.
  entete.bits = entete.brut === entete.largeur * entete.hauteur * 2 ? 16 : 8;
  // Quand une palette est la, elle s'intercale entre l'en-tete de base et le
  // sous-en-tete : 20 octets de rabiot, 1024 de palette, 12 de sous-en-tete.
  if (extra >= 1056) entete.palette = 32;
  return entete;
}

/**
 * Developpe le RLE d'un CIMG en mots 16 bits ou en indices de palette.
 *
 * Le codage, reconstitue en exigeant que le flux se consomme exactement et
 * remplisse exactement la surface — verifie sur les 2327 images du jeu :
 *
 *   0x00..0x7f   (commande + 1) pixels litteraux, a la suite
 *   0x80..0xfe   repetition du pixel suivant, (commande & 0x7f) + 1 fois
 *   0xff         fin d'image
 *
 * Le piege est le « + 1 » : les deux longueurs sont decalees d'une unite, parce
 * qu'un litteral ou une repetition de zero pixel n'aurait aucun sens et que le
 * format recupere la valeur. Sans le decalage, l'image derive d'un pixel de plus
 * a chaque commande — le genre d'erreur qui laisse les premieres lignes justes
 * et pourrit tout le reste.
 *
 * Il n'y a aucune marque de fin de ligne : les lignes se suivent sans separateur
 * et une repetition traverse les bords sans rien signaler. On compte donc en
 * index lineaire, jamais en (x, y).
 */
export function developper(donnees, largeur, hauteur, bits, cle) {
  const total = largeur * hauteur;
  const pixels = new (bits === 16 ? Uint16Array : Uint8Array)(total).fill(cle);
  const pas = bits === 16 ? 2 : 1;
  const lire = bits === 16 ? (p) => donnees.readUInt16LE(p) : (p) => donnees[p];

  let p = 0;
  let index = 0;

  while (p < donnees.length && index < total) {
    const commande = donnees[p];
    p += 1;
    if (commande === 0xff) break;

    const repetition = (commande & 0x80) !== 0;
    const nombre = (commande & 0x7f) + 1;
    if (index + nombre > total || p + (repetition ? pas : nombre * pas) > donnees.length) {
      throw new Error(`flux CIMG incoherent a l'octet ${p - 1} (index ${index}/${total})`);
    }

    if (repetition) {
      pixels.fill(lire(p), index, index + nombre);
      p += pas;
    } else {
      for (let i = 0; i < nombre; i += 1) pixels[index + i] = lire(p + i * pas);
      p += nombre * pas;
    }
    index += nombre;
  }

  return { pixels, consomme: p, remplis: index };
}

/**
 * Convertit un mot 16 bits en RGB.
 *
 * Les donnees sont en RGB555, pas en 565 : cinq bits par composante et le bit de
 * poids fort inutilise. L'histogramme le prouve — les gris du jeu valent 0x0c63,
 * 0x1084, 0x6739, c'est-a-dire la meme valeur repetee sur trois champs de cinq
 * bits. Lus en 565, ces gris virent au vert parce qu'un bit de rouge tombe dans
 * le vert, et toute la planche part en teinte.
 *
 * Les composantes sont repliees sur elles-memes (`<< 3 | >> 2`) plutot que
 * seulement decalees : sinon le blanc plafonne a 248 et les aplats clairs
 * prennent un voile gris.
 */
export function rgb555(mot) {
  const r = (mot >> 10) & 0x1f;
  const v = (mot >> 5) & 0x1f;
  const b = mot & 0x1f;
  return [(r << 3) | (r >> 2), (v << 3) | (v >> 2), (b << 3) | (b >> 2)];
}

/** Decode un CIMG complet en RGBA, la couleur-cle devenant transparente. */
export function decoder(octets) {
  const entete = lireEnteteImage(octets);
  const { largeur, hauteur, bits, cle } = entete;
  const donnees = octets.subarray(entete.donnees, entete.donnees + entete.compresse - 12);
  const { pixels } = developper(donnees, largeur, hauteur, bits, cle);

  // Palette des images 8 bits : 256 entrees BGRX, comme Windows les ecrivait.
  let palette = null;
  if (bits === 8) {
    palette = [];
    for (let i = 0; i < 256; i += 1) {
      const o = entete.palette + i * 4;
      palette.push([octets[o + 2], octets[o + 1], octets[o]]);
    }
  }

  const rgba = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    const valeur = pixels[i];
    if (valeur === cle) continue;
    const [r, v, b] = palette ? palette[valeur] : rgb555(valeur);
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }

  return { ...entete, rgba };
}
