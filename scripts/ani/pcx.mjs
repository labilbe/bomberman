/**
 * Decodeur PCX, pour les fonds d'arene du dossier RES.
 *
 * Le sol d'Atomic Bomberman n'est pas une tuile repetee : c'est une image
 * peinte de 640 x 480, une par terrain (FIELD0 a FIELD10). C'est ce qui fait
 * que l'herbe du jeu d'origine ne se repete jamais tout a fait, la ou une seule
 * tuile recopiee se voit immediatement.
 *
 * Le format est simple et ancien : un en-tete de 128 octets, un RLE par octet,
 * et pour les images 8 bits une palette de 256 couleurs collee A LA FIN du
 * fichier, precedee d'un marqueur 0x0C — pas dans l'en-tete, ou l'on ne trouve
 * que l'ancienne palette EGA de seize entrees qui ne sert a rien ici.
 */

/** Longueur de l'en-tete PCX, fixe. */
const ENTETE = 128;

/**
 * Decode un PCX 8 bits en RGBA opaque.
 *
 * On ne gere que le cas present dans le jeu — un plan, huit bits, RLE — et on
 * refuse le reste bruyamment plutot que de rendre une image fausse.
 */
export function decoderPcx(octets) {
  if (octets[0] !== 0x0a) throw new Error('ce fichier n est pas un PCX');
  if (octets[3] !== 8 || octets[65] !== 1) {
    throw new Error(`PCX non gere : ${octets[3]} bits, ${octets[65]} plans`);
  }

  const largeur = octets.readUInt16LE(8) - octets.readUInt16LE(4) + 1;
  const hauteur = octets.readUInt16LE(10) - octets.readUInt16LE(6) + 1;
  // `octetsParLigne` peut depasser la largeur : le format arrondit a un nombre
  // pair, et les octets en trop sont du remplissage a jeter ligne par ligne.
  const octetsParLigne = octets.readUInt16LE(66);

  // La palette occupe les 768 derniers octets, derriere son marqueur.
  const debutPalette = octets.length - 769;
  if (octets[debutPalette] !== 0x0c) throw new Error('palette PCX introuvable');
  const palette = octets.subarray(debutPalette + 1);

  const indices = new Uint8Array(hauteur * octetsParLigne);
  let p = ENTETE;
  let sortie = 0;
  while (sortie < indices.length && p < debutPalette) {
    const octet = octets[p];
    p += 1;
    // Les deux bits de poids fort a un annoncent une repetition ; la longueur
    // tient sur les six autres, ce qui plafonne les series a 63.
    if ((octet & 0xc0) === 0xc0) {
      const nombre = octet & 0x3f;
      const valeur = octets[p];
      p += 1;
      indices.fill(valeur, sortie, Math.min(indices.length, sortie + nombre));
      sortie += nombre;
    } else {
      indices[sortie] = octet;
      sortie += 1;
    }
  }

  const rgba = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const indice = indices[y * octetsParLigne + x] * 3;
      const d = (y * largeur + x) * 4;
      rgba[d] = palette[indice];
      rgba[d + 1] = palette[indice + 1];
      rgba[d + 2] = palette[indice + 2];
      rgba[d + 3] = 255;
    }
  }

  return { largeur, hauteur, rgba };
}
