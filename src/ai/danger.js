/**
 * Carte de danger et chemins surs : le coeur de l'adversaire artificiel.
 *
 * Tout est pur, sans DOM, sans horloge et sans hasard. Ce n'est pas une
 * coquetterie : ces fonctions tournent DANS LE RELAIS, qui simule l'arene, et
 * elles doivent donner le meme resultat que dans la page en solo. Un seul
 * `Math.random` ici, et deux machines verraient deux bots differents.
 *
 * La carte donne, pour chaque case, le nombre de PAS avant qu'elle ne brule, ou
 * `SUR` si rien ne la menace. Un bot ne consulte jamais les bombes directement :
 * tout ce qu'il a besoin de savoir du danger tient dans ce tableau, et c'est ce
 * qui lui evite de raisonner sur des portees et des murs a chaque decision.
 */

import { COLS, ROWS, VECTEURS, FLAMME_PAS } from '../engine/constantes.js';
import { index, caseDe, estLibre, caseAxe } from '../engine/grille.js';

/** Valeur d'une case que rien ne menace. */
export const SUR = 30000;

/**
 * Carte de danger de l'etat.
 *
 * Les chaines ne sont pas simulees : une bombe prise dans l'explosion d'une
 * autre partira plus tot que sa meche ne le dit. On prend donc le minimum des
 * meches qui couvrent la case, ce qui sous-estime parfois le danger d'un ou deux
 * pas. Simuler les chaines couterait une file par appel, soixante fois par
 * seconde et par bot, pour une prudence dont le bot n'a pas besoin : il garde
 * deja une marge de securite.
 *
 * @param {import('../engine/etat.js').Etat} etat
 * @returns {Int32Array}
 */
export function carteDanger(etat) {
  const carte = new Int32Array(COLS * ROWS).fill(SUR);

  for (const flamme of etat.flammes) {
    const i = index(flamme.cx, flamme.cy);
    if (i >= 0 && i < carte.length) carte[i] = 0;
  }

  for (const bombe of etat.bombes) {
    const meche = Math.max(0, bombe.meche);
    const centre = index(bombe.cx, bombe.cy);
    if (carte[centre] > meche) carte[centre] = meche;
    for (const v of VECTEURS) {
      for (let pas = 1; pas <= bombe.portee; pas += 1) {
        const x = bombe.cx + v.dx * pas;
        const y = bombe.cy + v.dy * pas;
        const tuile = caseDe(etat, x, y);
        if (!estLibre(tuile)) break;
        const i = index(x, y);
        if (carte[i] > meche) carte[i] = meche;
      }
    }
  }

  return carte;
}

/**
 * Carte de danger telle qu'elle serait si le bomber posait une bombe maintenant.
 *
 * C'est la question que le bot se pose avant chaque pose : « si je lache ca ici,
 * ai-je encore une sortie ? ». Sans elle, un bot se mure tout seul dans un
 * cul-de-sac, et c'est le defaut le plus visible qu'une IA de Bomberman puisse
 * avoir.
 *
 * @param {import('../engine/etat.js').Etat} etat
 * @param {import('../engine/etat.js').Joueur} joueur
 * @param {Int32Array} base
 * @param {number} meche
 */
export function dangerAvecBombe(etat, joueur, base, meche) {
  const carte = base.slice();
  const cx = caseAxe(joueur.x);
  const cy = caseAxe(joueur.y);
  const centre = index(cx, cy);
  if (carte[centre] > meche) carte[centre] = meche;
  for (const v of VECTEURS) {
    for (let pas = 1; pas <= joueur.portee; pas += 1) {
      const x = cx + v.dx * pas;
      const y = cy + v.dy * pas;
      if (!estLibre(caseDe(etat, x, y))) break;
      const i = index(x, y);
      if (carte[i] > meche) carte[i] = meche;
    }
  }
  return carte;
}

/** Une case est-elle franchissable par un bot ? Les bombes bloquent, toutes. */
export function ouverte(etat, cx, cy) {
  if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return false;
  if (!estLibre(caseDe(etat, cx, cy))) return false;
  for (const bombe of etat.bombes) {
    if (bombe.cx === cx && bombe.cy === cy) return false;
  }
  return true;
}

/**
 * Parcours en largeur depuis la case d'un bomber.
 *
 * Renvoie, pour chaque case atteignable, la distance en cases et la PREMIERE
 * direction a prendre pour y aller. Garder la premiere direction plutot que le
 * chemin entier suffit : le bot redecide avant d'avoir fini de marcher.
 *
 * Le parcours est fait dans l'ordre des directions de `VECTEURS`, toujours le
 * meme : a distance egale, deux machines choisissent la meme case.
 *
 * `evite` rend infranchissables les cases menacees. C'est indispensable des
 * qu'on cherche une destination et non une fuite : sans lui, un bot qui s'est
 * mis a l'abri repart vers une brique en RETRAVERSANT le souffle de sa propre
 * bombe, et arrive dessus juste a temps pour mourir. C'etait la cause de presque
 * toutes les manches nulles.
 *
 * @param {import('../engine/etat.js').Etat} etat
 * @param {number} departX
 * @param {number} departY
 * @param {{ evite?: Int32Array }} options
 * @returns {{ distance: Int32Array, premier: Int8Array }}
 */
export function parcourir(etat, departX, departY, { evite = null } = {}) {
  const distance = new Int32Array(COLS * ROWS).fill(-1);
  const premier = new Int8Array(COLS * ROWS).fill(-1);
  const file = [index(departX, departY)];
  distance[file[0]] = 0;

  for (let tete = 0; tete < file.length; tete += 1) {
    const courant = file[tete];
    const cx = courant % COLS;
    const cy = Math.floor(courant / COLS);
    for (let dir = 0; dir < VECTEURS.length; dir += 1) {
      const x = cx + VECTEURS[dir].dx;
      const y = cy + VECTEURS[dir].dy;
      if (!ouverte(etat, x, y)) continue;
      const suivant = index(x, y);
      if (distance[suivant] >= 0) continue;
      if (evite !== null && evite[suivant] < SUR) continue;
      distance[suivant] = distance[courant] + 1;
      premier[suivant] = distance[courant] === 0 ? dir : premier[courant];
      file.push(suivant);
    }
  }

  return { distance, premier };
}

/**
 * Cherche la sortie la plus proche hors de danger.
 *
 * Un refuge est une case que RIEN ne menace. C'est la nuance qui decide de la
 * qualite du bot : la premiere version acceptait toute case ou l'on arrive avant
 * le feu, ce qui incluait la case ou l'on se tient — on vient d'y poser une
 * bombe, sa meche dure deux secondes et demie, donc on « arrive a temps ». Le
 * bot restait assis sur sa propre bombe et mourait. Sept morts sur dix venaient
 * de la.
 *
 * A defaut de refuge, on rend un repli : la case atteignable qui brulera le plus
 * tard. Cela ne sauve pas toujours, mais gagner du temps vaut mieux que ne pas
 * bouger, et une chaine peut tres bien degager le passage entre-temps.
 *
 * @param {import('../engine/etat.js').Etat} etat
 * @param {import('../engine/etat.js').Joueur} joueur
 * @param {Int32Array} danger
 * @returns {{ dir: number, distance: number, sur: boolean } | null}
 */
export function fuite(etat, joueur, danger) {
  const cx = caseAxe(joueur.x);
  const cy = caseAxe(joueur.y);
  const pasParCase = Math.ceil(1024 / Math.max(1, joueur.vitesse));

  // Parcours DATE : chaque case porte le pas auquel on y arriverait. C'est la
  // correction du defaut le plus couteux de ce bot — il cherchait le refuge le
  // plus proche sans jamais verifier qu'il y arrivait a temps, ni que le chemin
  // etait encore praticable. Un bot qui venait de poser partait donc le long de
  // son propre souffle et explosait en chemin : un mort sur cinq.
  //
  // On ne TRAVERSE une case menacee que si on en ressort avant qu'elle ne brule,
  // et on ne s'ARRETE que sur une case que rien ne menace.
  const distance = new Int32Array(COLS * ROWS).fill(-1);
  const premier = new Int8Array(COLS * ROWS).fill(-1);
  const depart = index(cx, cy);
  const file = [depart];
  distance[depart] = 0;

  let refuge = null;
  let repli = null;

  for (let tete = 0; tete < file.length; tete += 1) {
    const courant = file[tete];
    const ax = courant % COLS;
    const ay = Math.floor(courant / COLS);

    for (let dir = 0; dir < VECTEURS.length; dir += 1) {
      const x = ax + VECTEURS[dir].dx;
      const y = ay + VECTEURS[dir].dy;
      if (!ouverte(etat, x, y)) continue;
      const suivant = index(x, y);
      if (distance[suivant] >= 0) continue;

      const pasFaits = distance[courant] + 1;
      const arrivee = pasFaits * pasParCase;
      // Pour passer, il faut avoir quitte la case avant qu'elle ne s'allume.
      if (danger[suivant] < SUR && arrivee + pasParCase >= danger[suivant]) continue;

      distance[suivant] = pasFaits;
      premier[suivant] = distance[courant] === 0 ? dir : premier[courant];
      file.push(suivant);

      if (danger[suivant] >= SUR) {
        // Le parcours en largeur sort les cases par distance croissante : la
        // premiere case sure rencontree est la plus proche.
        if (refuge === null) refuge = { dir: premier[suivant], distance: pasFaits, sur: true };
      } else if (danger[suivant] > arrivee + FLAMME_PAS
        && (repli === null || danger[suivant] > repli.delai)) {
        repli = { dir: premier[suivant], distance: pasFaits, sur: false, delai: danger[suivant] };
      }
    }

    if (refuge) break;
  }

  if (refuge) return refuge;
  if (repli) return { dir: repli.dir, distance: repli.distance, sur: false };
  return null;
}
