/**
 * Lecture de SOUNDLST.RES : la table des sons du jeu.
 *
 * C'est un fichier texte, commente par l'auteur, ou chaque ligne utile vaut
 * « identifiant,nom » — le nom etant celui d'un .RSS du dossier SOUND. Les
 * identifiants sont groupes par usage, et les commentaires disent lequel :
 * 100-102 pour poser une bombe, 200-219 pour une explosion, 400-412 pour un
 * bonus ramasse.
 *
 * Certaines lignes sont MISES EN COMMENTAIRE et il faut les respecter : les
 * musiques de partie (1100 a 1110) et la musique du titre en font partie, et
 * leurs fichiers sont d'ailleurs absents d'une installation normale — c'etaient
 * des pistes audio du CD.
 */

/**
 * @param {string} texte contenu de SOUNDLST.RES
 * @returns {Map<number, string>} identifiant vers nom de fichier, sans extension
 */
export function lireListe(texte) {
  const table = new Map();
  for (const brute of texte.split(/\r?\n/)) {
    // Un point-virgule ouvre un commentaire, ou qu'il soit sur la ligne.
    const ligne = brute.split(';')[0].trim();
    if (!ligne) continue;
    const [identifiant, nom] = ligne.split(',');
    const n = Number(identifiant);
    if (!Number.isInteger(n) || !nom) continue;
    table.set(n, nom.trim());
  }
  return table;
}

/** Les identifiants d'une plage, dans l'ordre. */
export function plage(table, premier, dernier) {
  const sortie = [];
  for (let i = premier; i <= dernier; i += 1) {
    if (table.has(i)) sortie.push(table.get(i));
  }
  return sortie;
}
