/**
 * Les sons d'Atomic Bomberman : lecture des .RSS, ecriture en WAV.
 *
 * Il n'y a rien a deviner pour une fois — l'auteur du jeu a ecrit le format en
 * tete de son propre fichier de ressources, DATA/RES/SOUNDLST.RES :
 *
 *   « These files all should have a .RSS extension and be raw 22khz Stereo
 *     16bit signed, Intel-endian. »
 *
 * Donc aucun en-tete, aucune compression : le fichier EST le flux. Verifie sur
 * les 251 sons — toutes les tailles sont des multiples de quatre octets (une
 * trame stereo de deux echantillons 16 bits), les cretes montent a pleine
 * echelle et la composante continue est nulle.
 *
 * On ressort en WAV parce que c'est le seul format que le navigateur decode
 * nativement sans qu'on embarque un encodeur : le depot n'a aucune dependance,
 * et il n'y a pas de ffmpeg sur la machine.
 */

/** Frequence d'echantillonnage des .RSS, annoncee par le jeu. */
export const FREQUENCE = 22050;

/** Nombre de canaux d'un .RSS. */
const CANAUX = 2;

/**
 * Lit un .RSS en echantillons entrelaces.
 *
 * @param {Buffer} octets
 * @returns {Int16Array}
 */
export function lireRss(octets) {
  const trames = Math.floor(octets.length / (2 * CANAUX));
  const sortie = new Int16Array(trames * CANAUX);
  for (let i = 0; i < sortie.length; i += 1) sortie[i] = octets.readInt16LE(i * 2);
  return sortie;
}

/**
 * Replie un flux stereo en mono.
 *
 * Les bruitages du jeu sont a 99 % identiques sur les deux canaux — c'est du
 * mono stocke en stereo. Les replier divise le poids par deux sans rien perdre,
 * et le jeu les joue de toute facon au centre.
 *
 * @param {Int16Array} entrelace
 */
export function enMono(entrelace) {
  const trames = entrelace.length / CANAUX;
  const sortie = new Int16Array(trames);
  for (let i = 0; i < trames; i += 1) {
    sortie[i] = (entrelace[i * CANAUX] + entrelace[i * CANAUX + 1]) / 2;
  }
  return sortie;
}

/**
 * Reechantillonne, en moyennant la fenetre quand on descend.
 *
 * La moyenne n'est pas un ornement. Sans elle, descendre de 22 a 11 kHz prend
 * un echantillon sur deux et replie tout l'aigu dans le grave : la musique
 * devient metallique et sale. C'est exactement ce qui s'etait entendu sur la
 * musique du menu, reduite par simple interpolation.
 *
 * Ce filtre a moyenne glissante vaut ce qu'il vaut — il n'a pas la raideur d'un
 * vrai passe-bas — mais il supprime l'essentiel du repliement pour trois lignes.
 * Le mieux reste de ne pas reechantillonner du tout, ce que fait maintenant la
 * musique.
 *
 * @param {Int16Array} source
 * @param {number} de
 * @param {number} vers
 */
export function reechantillonner(source, de, vers) {
  if (de === vers) return source;
  const rapport = vers / de;
  const trames = Math.floor(source.length * rapport);
  const sortie = new Int16Array(trames);
  // Largeur de la fenetre a moyenner : une sortie couvre autant d'entrees.
  const fenetre = Math.max(1, Math.round(de / vers));

  for (let i = 0; i < trames; i += 1) {
    const centre = Math.round(i / rapport);
    let somme = 0;
    let compte = 0;
    for (let k = -(fenetre >> 1); k <= fenetre >> 1; k += 1) {
      const j = centre + k;
      if (j < 0 || j >= source.length) continue;
      somme += source[j];
      compte += 1;
    }
    sortie[i] = Math.round(somme / compte);
  }
  return sortie;
}

/** Ecrit un morceau RIFF : identifiant, longueur, charge. */
function morceau(type, charge) {
  const entete = Buffer.alloc(8);
  entete.write(type, 0, 'latin1');
  entete.writeUInt32LE(charge.length, 4);
  return Buffer.concat([entete, charge]);
}

/**
 * Encode des echantillons en WAV PCM.
 *
 * @param {Int16Array} echantillons entrelaces
 * @param {{ canaux?: number, frequence?: number }} options
 */
export function versWav(echantillons, { canaux = 1, frequence = FREQUENCE } = {}) {
  const octetsParTrame = canaux * 2;
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0); // PCM entier
  format.writeUInt16LE(canaux, 2);
  format.writeUInt32LE(frequence, 4);
  format.writeUInt32LE(frequence * octetsParTrame, 8);
  format.writeUInt16LE(octetsParTrame, 12);
  format.writeUInt16LE(16, 14);

  const donnees = Buffer.from(echantillons.buffer, echantillons.byteOffset, echantillons.byteLength);
  const corps = Buffer.concat([
    Buffer.from('WAVE', 'latin1'),
    morceau('fmt ', format),
    morceau('data', donnees),
  ]);
  return morceau('RIFF', corps);
}
