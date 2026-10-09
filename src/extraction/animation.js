/**
 * Lecture d'un .ANI complet : les images, et les sequences qui les animent.
 *
 * Un fichier contient une suite de FRAM — chacun une image et son nom de
 * fichier d'origine — puis des SEQ nommes (« walkbomb south », « standbomb
 * north ») qui pointent ces images dans l'ordre, avec une duree. C'est cette
 * seconde partie qui vaut d'etre lue : sans elle on a 2327 images en vrac, et il
 * faut deviner a l'oeil lesquelles forment un cycle de marche.
 */

import { lireMorceaux, charge, chaine, lireEntete } from './chfile.js';
import { decoder } from './cimg.js';

/**
 * Duree qui veut dire « la meme que le pas precedent ».
 *
 * Le format ne repete pas une duree inchangee : seul le premier pas d'une
 * sequence porte la sienne, les suivants valent 0xFFFF. Lu au premier degre, ce
 * 65535 passait pour une duree de 65 secondes — la bombe additionnait dix-huit
 * minutes de cycle et restait donc figee sur sa premiere image pendant toute sa
 * meche.
 */
const DUREE_HERITEE = 0xffff;

/** Un pas de sequence vit dans un STAT : une duree, puis un renvoi vers un FRAM. */
function lirePas(octets, stat, dureePrecedente) {
  const sous = lireMorceaux(octets, stat.debut, stat.debut + stat.taille);
  const tete = sous.find((n) => n.id === 'HEAD');
  const renvoi = sous.find((n) => n.id === 'FRAM');
  if (!renvoi) return null;
  const r = charge(octets, renvoi);
  const brute = tete ? charge(octets, tete).readUInt16LE(0) : 0;
  return {
    image: r.readUInt16LE(2),
    duree: brute === DUREE_HERITEE ? dureePrecedente : brute,
    // Decalages par pas : le jeu bouge le sprite sans bouger son point
    // d'accroche, c'est ce qui donne le dandinement de la marche.
    dx: r.readInt16LE(4),
    dy: r.readInt16LE(6),
  };
}

/** Ouvre un .ANI et rend ses images decodees et ses sequences nommees. */
export function lireAnimation(octets) {
  lireEntete(octets);
  const racine = lireMorceaux(octets);

  const images = racine
    .filter((n) => n.id === 'FRAM')
    .map((fram) => {
      const nom = fram.enfants.find((n) => n.id === 'FNAM');
      const cimg = fram.enfants.find((n) => n.id === 'CIMG');
      return { nom: nom ? chaine(charge(octets, nom)) : '', ...decoder(charge(octets, cimg)) };
    });

  const sequences = racine
    .filter((n) => n.id === 'SEQ ')
    .map((seq) => {
      // La duree se propage de pas en pas : on la porte le long de la sequence.
      let duree = 0;
      const pas = [];
      for (const stat of seq.enfants.filter((n) => n.id === 'STAT')) {
        const lu = lirePas(octets, stat, duree);
        if (!lu) continue;
        duree = lu.duree;
        pas.push(lu);
      }
      return {
        nom: chaine(charge(octets, seq.enfants.find((n) => n.id === 'HEAD'))),
        pas,
      };
    });

  return { images, sequences };
}
