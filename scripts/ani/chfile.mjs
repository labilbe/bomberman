/**
 * Lecteur de conteneur CHFILE, le format des .ANI d'Atomic Bomberman.
 *
 * Ce n'est pas du RIFF, malgre la ressemblance. L'en-tete de fichier fait seize
 * octets — « CHFILE » puis un sous-type de quatre caracteres (« ANI  »), puis la
 * taille utile — et chaque morceau porte dix octets d'en-tete : identifiant sur
 * quatre, taille sur quatre, et deux octets de drapeaux. C'est ce « dix » qui
 * fait trebucher : lu comme du RIFF (huit octets, bourrage pair), le second
 * morceau tombe deux octets trop tot et tout l'arbre part de travers.
 *
 * Les morceaux s'imbriquent avec la meme convention — un FRAM contient HEAD,
 * FNAM, CIMG — et il n'y a aucun bourrage.
 */

/** Taille de l'en-tete d'un morceau : id(4) + taille(4) + drapeaux(2). */
export const ENTETE_MORCEAU = 10;

/** Taille de l'en-tete de fichier. */
export const ENTETE_FICHIER = 16;

/**
 * Identifiants qui contiennent eux-memes des morceaux.
 *
 * On ne devine pas l'imbrication en reniflant les premiers octets : un CIMG
 * compresse peut commencer par n'importe quoi, et le reniflage le prendrait
 * pour un conteneur. La liste explicite est le seul moyen sur.
 */
const CONTENEURS = new Set(['FRAM', 'SEQ ']);

function id(octets, position) {
  return octets.toString('latin1', position, position + 4);
}

/** Verifie l'en-tete et rend le sous-type. Leve si ce n'est pas un CHFILE. */
export function lireEntete(octets) {
  if (octets.length < ENTETE_FICHIER || octets.toString('latin1', 0, 6) !== 'CHFILE') {
    throw new Error('ce fichier ne commence pas par CHFILE');
  }
  return {
    sousType: octets.toString('latin1', 6, 10).trim(),
    taille: octets.readUInt32LE(10),
  };
}

/**
 * Parcourt une suite de morceaux et rend un tableau de noeuds.
 *
 * Chaque noeud porte `id`, `debut` (position absolue de la charge utile),
 * `taille` et `drapeaux`, plus `enfants` pour un conteneur. On garde les
 * positions dans le tampon d'origine au lieu de decouper : les images font
 * plusieurs kilo-octets et recopier a chaque niveau serait du gaspillage pur.
 */
export function lireMorceaux(octets, debut = ENTETE_FICHIER, fin = octets.length) {
  const noeuds = [];
  let position = debut;

  while (position + ENTETE_MORCEAU <= fin) {
    const identifiant = id(octets, position);
    const taille = octets.readUInt32LE(position + 4);
    const drapeaux = octets.readUInt16LE(position + 8);
    const charge = position + ENTETE_MORCEAU;

    // Une taille qui depasse les bornes veut dire que l'arbre est desynchronise.
    // On s'arrete en le signalant plutot que de lire au hasard.
    if (taille > fin - charge) {
      noeuds.push({ id: identifiant, debut: charge, taille: fin - charge, drapeaux, tronque: true });
      break;
    }

    const noeud = { id: identifiant, debut: charge, taille, drapeaux };
    if (CONTENEURS.has(identifiant)) {
      noeud.enfants = lireMorceaux(octets, charge, charge + taille);
    }
    noeuds.push(noeud);
    position = charge + taille;
  }

  return noeuds;
}

/** Rend la charge utile d'un noeud, sans recopie. */
export function charge(octets, noeud) {
  return octets.subarray(noeud.debut, noeud.debut + noeud.taille);
}

/** Parcours en profondeur : « tous les CIMG du fichier », en une boucle. */
export function* parcourir(noeuds, chemin = []) {
  for (const noeud of noeuds) {
    yield { noeud, chemin };
    if (noeud.enfants) yield* parcourir(noeud.enfants, [...chemin, noeud.id]);
  }
}

/** Une chaine terminee par zero, comme le jeu ecrit les noms. */
export function chaine(octets) {
  const zero = octets.indexOf(0);
  return octets.toString('latin1', 0, zero === -1 ? octets.length : zero);
}
