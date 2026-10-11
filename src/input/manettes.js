/**
 * Manettes : une par siege local, a cote du clavier.
 *
 * Ce module rend exactement ce que rend le clavier — `lire(siege)` donne une
 * intention, `oubli()` relache tout — et pour la meme raison : la boucle de jeu
 * ne doit pas savoir d'ou vient une direction. C'est ce qui permet de brancher
 * les manettes sans toucher au rendu, au moteur ni au transport.
 *
 * LA GRANDE DIFFERENCE AVEC LE CLAVIER EST QU'ON SONDE AU LIEU D'ECOUTER. Il
 * n'existe pas d'evenement « bouton enfonce » : l'API ne donne qu'un instantane
 * de l'etat, qu'il faut relire a chaque image. Deux consequences, assumees :
 *
 * - les impulsions se deduisent d'un FRONT. On garde l'etat precedent de chaque
 *   bouton, et poser une bombe veut dire « relache a l'image d'avant, enfonce a
 *   celle-ci ». Sans ca, tenir le bouton poserait une bombe par pas.
 * - un appui plus court qu'une image passe inapercu. C'est inherent au sondage,
 *   et sans consequence a soixante images par seconde : personne n'appuie et ne
 *   relache en moins de seize millisecondes.
 *
 * Les manettes sont attribuees DANS L'ORDRE DE LEURS EMPLACEMENTS, pas par leur
 * index brut. Debrancher la premiere de deux manettes laisse un trou dans le
 * tableau que rend le navigateur ; en lisant l'index brut, le joueur restant
 * perdrait sa manette alors qu'elle est toujours branchee.
 *
 * Rien ici ne touche `navigator` directement : la sonde est injectee, comme la
 * cible d'evenements du clavier. C'est ce qui rend le module testable sans
 * navigateur.
 */

import { HAUT, DROITE, BAS, GAUCHE } from '../engine/constantes.js';

/**
 * Boutons, dans la disposition « standard » que le navigateur normalise.
 *
 * 0 et 1 sont les deux boutons du bas a droite — A et B sur une manette Xbox,
 * croix et rond sur une PlayStation. On prend les deux plus accessibles du
 * pouce droit : poser une bombe et la declencher sont les deux gestes du jeu.
 */
export const BOUTONS = { bombe: 0, detonateur: 1 };

/** La croix directionnelle, toujours aux memes index en disposition standard. */
export const CROIX = { haut: 12, bas: 13, gauche: 14, droite: 15 };

/** Le stick gauche : axe horizontal, axe vertical. */
export const AXES = { x: 0, y: 1 };

/**
 * A partir de quelle inclinaison le stick compte comme une direction.
 *
 * Elle est haute volontairement. Le jeu ne connait que quatre directions, et un
 * stick au repos ne rend jamais exactement zero : avec un seuil bas, une manette
 * un peu usee fait avancer le bomber tout seul, et une poussee en diagonale le
 * fait hesiter entre deux couloirs a chaque image.
 */
export const ZONE_MORTE = 0.45;

/** Un bouton est-il enfonce ? Les gachettes sont analogiques, d'ou le seuil. */
const enfonce = (bouton) => {
  if (!bouton) return false;
  if (typeof bouton === 'number') return bouton > 0.5;
  return bouton.pressed === true || bouton.value > 0.5;
};

const DIRECTIONS = { haut: HAUT, bas: BAS, gauche: GAUCHE, droite: DROITE };
const ROLES = /** @type {const} */ (['haut', 'bas', 'gauche', 'droite']);

/** Les manettes reellement branchees, dans l'ordre de leurs emplacements. */
function branchees(sonde) {
  const brut = sonde() ?? [];
  return Array.from(brut).filter((manette) => manette && manette.connected !== false);
}

/**
 * Direction tiree du stick : l'axe le plus incline gagne.
 *
 * On ne rend jamais deux directions. Prendre les deux axes des qu'ils depassent
 * la zone morte ferait vibrer le bomber entre deux couloirs sur une poussee
 * diagonale, qui est la poussee normale quand on vise un coin.
 */
function duStick(axes, zoneMorte) {
  const x = Number(axes?.[AXES.x]) || 0;
  const y = Number(axes?.[AXES.y]) || 0;
  if (Math.abs(x) < zoneMorte && Math.abs(y) < zoneMorte) return -1;
  if (Math.abs(x) >= Math.abs(y)) return x > 0 ? DROITE : GAUCHE;
  return y > 0 ? BAS : HAUT;
}

/**
 * @param {{ sonde?: () => ArrayLike<unknown>, nombre?: number, zoneMorte?: number }} options
 */
export function creerManettes({
  sonde = () => (typeof navigator === 'undefined' ? [] : navigator.getGamepads?.() ?? []),
  nombre = 2,
  zoneMorte = ZONE_MORTE,
} = {}) {
  const sieges = Array.from({ length: nombre }, () => ({
    /** Directions de la croix encore tenues, dans l'ordre ou elles l'ont ete. */
    tenues: [],
    /** Etat des deux boutons a l'image precedente, pour en lire les fronts. */
    avant: { bombe: false, detonateur: false },
    /**
     * Vrai tant qu'on n'a pas encore vu cette manette.
     *
     * La premiere lecture ne fait qu'enregistrer l'etat des boutons, sans en
     * tirer d'impulsion. Sans ca, arriver sur la page ou rebrancher une manette
     * dont on tient la gachette poserait une bombe que personne n'a demandee :
     * un bouton deja enfonce n'est pas un front, c'est un etat qu'on decouvre.
     */
    reprise: true,
  }));

  /**
   * Met a jour un siege d'apres l'etat d'une manette, et rend son intention.
   *
   * La croix suit la DERNIERE direction enfoncee encore tenue, comme le clavier,
   * et pour la meme raison : en gardant la premiere, un joueur qui anticipe son
   * virage avant de relacher continuerait tout droit. Le stick, lui, n'a pas
   * d'ordre — il n'a qu'une inclinaison — donc il ne sert que si la croix se tait.
   */
  function sonder(etat, manette) {
    const boutons = manette?.buttons ?? [];

    for (const role of ROLES) {
      const tenu = enfonce(boutons[CROIX[role]]);
      const deja = etat.tenues.includes(role);
      if (tenu && !deja) etat.tenues.push(role);
      else if (!tenu && deja) etat.tenues = etat.tenues.filter((r) => r !== role);
    }

    const impulsion = {};
    for (const role of /** @type {const} */ (['bombe', 'detonateur'])) {
      const maintenant = enfonce(boutons[BOUTONS[role]]);
      impulsion[role] = maintenant && !etat.avant[role] && !etat.reprise;
      etat.avant[role] = maintenant;
    }
    etat.reprise = false;

    const derniere = etat.tenues[etat.tenues.length - 1];
    return {
      dir: derniere === undefined ? duStick(manette?.axes, zoneMorte) : DIRECTIONS[derniere],
      poser: impulsion.bombe,
      declencher: impulsion.detonateur,
    };
  }

  /** Remet un siege a zero, sans emettre d'impulsion au retour. */
  function vider(etat) {
    etat.tenues = [];
    etat.avant.bombe = false;
    etat.avant.detonateur = false;
    etat.reprise = true;
  }

  return {
    /**
     * L'intention d'une place locale, sondee a l'instant.
     *
     * @param {number} siege
     * @returns {import('../engine/entrees.js').Entree}
     */
    lire(siege) {
      const etat = sieges[siege];
      if (!etat) return { dir: -1, poser: false, declencher: false };

      const manette = branchees(sonde)[siege];
      if (!manette) {
        // Manette debranchee en pleine partie : on relache tout plutot que de
        // laisser le bomber courir vers un mur avec sa derniere direction.
        vider(etat);
        return { dir: -1, poser: false, declencher: false };
      }
      return sonder(etat, manette);
    },

    /** Combien de manettes sont branchees, pour le dire a l'ecran. */
    combien() {
      return branchees(sonde).length;
    },

    oubli() {
      for (const etat of sieges) vider(etat);
    },
  };
}
