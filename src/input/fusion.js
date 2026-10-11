/**
 * Fusion de plusieurs sources d'entree pour un meme siege.
 *
 * Un joueur assis devant la machine a maintenant deux facons de jouer, et il ne
 * devrait pas avoir a en declarer une : il prend la manette, il joue a la
 * manette ; il la pose et reprend les fleches, il joue aux fleches. Le choix se
 * fait en jouant, pas dans un menu.
 *
 * C'est aussi pour ca que cette fonction est a part. Chaque source lit son
 * materiel sans rien savoir de l'autre, et personne n'arbitre dans la boucle de
 * jeu : il n'y a qu'un seul endroit ou la regle est ecrite.
 */

/**
 * Combine des intentions en une seule.
 *
 * La DIRECTION revient a la premiere source qui en declare une. Les sources
 * sont donc passees par ordre de priorite, et l'ordre ne departage qu'un cas
 * qui n'arrive jamais en vrai : tenir une fleche et pousser le stick en meme
 * temps. Une source au repos rend -1 et laisse donc passer la suivante.
 *
 * Les IMPULSIONS, elles, s'additionnent. Elles ont deja ete consommees chez
 * leur source au moment ou on les lit — c'est le contrat de `lire` — donc les
 * perdre ici perdrait vraiment une bombe. On ne peut pas se contenter de
 * prendre celles de la source qui a gagne la direction.
 *
 * @param {...import('../engine/entrees.js').Entree} sources
 * @returns {import('../engine/entrees.js').Entree}
 */
export function fusionner(...sources) {
  let dir = -1;
  let poser = false;
  let declencher = false;

  for (const source of sources) {
    if (!source) continue;
    if (dir === -1 && source.dir !== -1 && source.dir !== undefined) dir = source.dir;
    poser = poser || source.poser === true;
    declencher = declencher || source.declencher === true;
  }

  return { dir, poser, declencher };
}
