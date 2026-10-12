/**
 * Explosions, chaines, briques, bonus brules, morts.
 *
 * Deux decisions commandent ce module.
 *
 * 1. Une chaine se resout ENTIEREMENT dans le meme pas, par une file. C'est le
 *    comportement d'Atomic Bomberman, et c'est surtout le seul qui ne depende
 *    pas de l'ordre du tableau des bombes : l'etaler sur plusieurs pas ferait
 *    dependre le resultat de l'ordre de pose, donc de la latence de chacun.
 *
 * 2. Un bonus n'est detruit que par une flamme NEUVE, jamais par une flamme
 *    deja la. Sans cette nuance, un bonus revele par une explosion serait
 *    aussitot brule par la flamme qui vient de le decouvrir, et casser une
 *    brique ne rapporterait jamais rien.
 */

import { FLAMME_PAS, CHUTE_PAS, DEMI_MORTEL, VECTEURS, VIDE, BRIQUE } from './constantes.js';
import { caseDe, poserCase, index, estLibre, boiteSurCase, caseAxe } from './grille.js';
import { noter } from './etat.js';
import { bombeSur, rendreLesMeches } from './bombes.js';
import { estCache, estVisible, codeDe, appliquer, NOMS_BONUS } from './bonus.js';

/** Causes de mort, telles qu'elles partent sur le reseau. */
export const PAR_FLAMME = 0;
export const PAR_ABSENCE = 1;
export const PAR_DEPART = 2;

/**
 * Portee reelle d'une branche de l'explosion.
 *
 * S'arrete au premier mur dur, detruit UNE brique et s'arrete la. Une flamme
 * qui traverserait deux briques rendrait tout abri illusoire.
 *
 * Un bonus pose au sol arrete la branche de la meme facon : il est detruit, et
 * rien ne passe au-dela. La difference avec la brique est que SA case brule,
 * elle : le bonus ne bouche pas le passage, on peut s'y tenir, donc on peut y
 * mourir.
 *
 * LA CASE DE LA BRIQUE N'EST PAS ENFLAMMEE, et c'est une regle de jeu, pas un
 * detail. La brique ABSORBE le souffle : elle tombe, et le feu ne prend pas sa
 * place. En l'enflammant, on obtenait une case a la fois VIDE et mortelle
 * pendant une demi-seconde — un joueur abrite derriere la brique qui avancait
 * vers l'explosion entrait dans le trou tout juste ouvert et mourait, alors
 * qu'il etait precisement du bon cote de l'abri. Atomic Bomberman ne punit pas
 * ca, et il a raison : c'est l'abri qui a joue son role.
 *
 * Ce que l'on voit sur cette case pendant qu'elle brule n'est donc pas une
 * flamme du moteur mais l'animation de la brique qui tombe, declenchee par
 * l'evenement `brick` — et chez Atomic Bomberman cette animation s'appelle
 * justement « flame brick ». Le feu y est dessine, il n'y est pas mortel.
 *
 * @param {import('./etat.js').Etat} etat
 * @returns {{ cases: number[][], brique: number[] | null, bombes: number[] }}
 */
export function rayon(etat, cx, cy, dir, portee) {
  const v = VECTEURS[dir];
  const cases = [];
  const bombes = [];
  let brique = null;

  for (let i = 1; i <= portee; i += 1) {
    const x = cx + v.dx * i;
    const y = cy + v.dy * i;
    const tuile = caseDe(etat, x, y);
    if (tuile === BRIQUE) {
      brique = [x, y];
      break;
    }
    if (!estLibre(tuile)) break;
    cases.push([x, y]);
    const bombe = bombeSur(etat, x, y);
    if (bombe !== null) bombes.push(bombe.id);
    // UN BONUS AU SOL ARRETE LE SOUFFLE, comme une brique. Il brule — sa case
    // est enflammee, elle, puisqu'elle reste praticable — mais la branche ne va
    // pas plus loin. Sans cela, un bonus au sol se faisait detruire sans rien
    // couvrir, et deux joueurs separes par un bonus etaient a decouvert l'un de
    // l'autre alors qu'un simple mur de briques les aurait abrites.
    if (estVisible(etat.objets[index(x, y)])) break;
  }

  return { cases, brique, bombes };
}

/**
 * Pose ou rallume une flamme sur une case.
 *
 * La flamme retient la PLACE du poseur. Elle ne sert a aucune regle — rien ne
 * depend de qui a allume quoi — mais Atomic Bomberman colorie l'explosion aux
 * couleurs du joueur, et c'est ainsi qu'on voit qui vient de vous tuer. Le rendu
 * ne pouvait pas le deviner : il ne voit que des cases qui brulent.
 *
 * Une case deja en feu garde son premier proprietaire. A l'instant ou deux
 * souffles se rejoignent, le choix est arbitraire ; le prendre stable evite au
 * moins que la case clignote entre deux couleurs.
 */
function allumer(etat, cx, cy, place, neuves) {
  const existante = etat.flammes.find((flamme) => flamme.cx === cx && flamme.cy === cy);
  if (existante) {
    existante.reste = FLAMME_PAS;
  } else {
    etat.flammes.push({ cx, cy, reste: FLAMME_PAS, place });
  }
  neuves.push([cx, cy]);
}

/**
 * Fait exploser une bombe : flammes, briques, et bombes a enchainer.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Bombe} bombe
 * @param {number[]} file identifiants de bombes a traiter ensuite
 * @param {number[][]} neuves cases nouvellement enflammees, pour les bonus
 * @param {number[][]} briques briques detruites, pour les reveler ensuite
 */
export function exploser(etat, bombe, file, neuves, briques) {
  const rang = etat.bombes.indexOf(bombe);
  if (rang >= 0) etat.bombes.splice(rang, 1);

  const proprietaire = etat.joueurs.find((joueur) => joueur.place === bombe.place);
  if (proprietaire) proprietaire.posees = Math.max(0, proprietaire.posees - 1);

  // La permission de traverser cette bombe meurt avec elle : son identifiant
  // sera reattribue, et elle vaudrait alors pour une bombe etrangere.
  for (const joueur of etat.joueurs) {
    if (joueur.surBombe === bombe.id) joueur.surBombe = null;
  }

  allumer(etat, bombe.cx, bombe.cy, bombe.place, neuves);

  const longueurs = [0, 0, 0, 0];
  for (let dir = 0; dir < 4; dir += 1) {
    const branche = rayon(etat, bombe.cx, bombe.cy, dir, bombe.portee);
    longueurs[dir] = branche.cases.length;
    for (const [x, y] of branche.cases) allumer(etat, x, y, bombe.place, neuves);
    if (branche.brique) abattre(etat, branche.brique[0], branche.brique[1]);
    for (const id of branche.bombes) file.push(id);
  }

  noter(etat, [
    'boom',
    bombe.id,
    bombe.cx,
    bombe.cy,
    longueurs[0],
    longueurs[1],
    longueurs[2],
    longueurs[3],
  ]);
}

/**
 * Met une brique a terre : elle tombe, mais bloque encore.
 *
 * LA CASE NE SE VIDE PAS MAINTENANT. Elle reste BRIQUE pendant toute la chute,
 * donc infranchissable, et c'est la correction d'une inexactitude : la brique
 * disparaissait a l'instant de l'explosion et l'animation n'etait qu'un decor
 * peint par-dessus du vide. On traversait une brique qu'on voyait encore
 * tomber, ce qu'Atomic Bomberman ne permet pas.
 *
 * Une brique deja a terre n'est pas abattue deux fois : un second souffle qui
 * l'atteint pendant sa chute s'y arrete — elle est toujours la — mais ne
 * relance ni son animation ni son decompte.
 */
function abattre(etat, cx, cy) {
  if (etat.ruines.some((ruine) => ruine.cx === cx && ruine.cy === cy)) return;
  etat.ruines.push({ cx, cy, reste: CHUTE_PAS });
  noter(etat, ['brick', cx, cy]);
}

/**
 * Fait tomber les briques d'un pas, et vide celles qui ont fini.
 *
 * C'est ICI que la case s'ouvre, et que le bonus cache dessous se montre. Le
 * reveler plus tot l'aurait fait apparaitre sous une brique encore debout.
 *
 * L'ecriture de la case est la SEULE du cycle de vie d'une brique, donc le
 * compteur de version n'avance que d'un cran par brique — ce que le client sait
 * reproduire sans demander la grille entiere.
 *
 * @param {import('./etat.js').Etat} etat
 */
export function vieillirRuines(etat) {
  for (let i = etat.ruines.length - 1; i >= 0; i -= 1) {
    const ruine = etat.ruines[i];
    ruine.reste -= 1;
    if (ruine.reste > 0) continue;
    etat.ruines.splice(i, 1);
    poserCase(etat, ruine.cx, ruine.cy, VIDE);
    noter(etat, ['brickgone', ruine.cx, ruine.cy]);
    revelerBonus(etat, [[ruine.cx, ruine.cy]]);
  }
}

/**
 * Resout une chaine d'explosions jusqu'a epuisement.
 *
 * Le jeu de bombes deja traitees est indispensable : deux bombes qui se touchent
 * se mettent mutuellement dans la file, et sans lui la boucle ne s'arreterait
 * jamais.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Bombe[]} initiales
 * @returns {{ neuves: number[][], briques: number[][] }}
 */
export function resoudreChaine(etat, initiales) {
  const neuves = [];
  const briques = [];
  const vues = new Set();
  const file = initiales.map((bombe) => bombe.id);

  while (file.length > 0) {
    const id = file.shift();
    if (vues.has(id)) continue;
    vues.add(id);
    const bombe = etat.bombes.find((candidate) => candidate.id === id);
    if (!bombe) continue;
    exploser(etat, bombe, file, neuves, briques);
  }

  return { neuves, briques };
}

/**
 * Detruit les bonus visibles atteints par une flamme neuve.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {number[][]} neuves
 */
export function brulerObjets(etat, neuves) {
  for (const [cx, cy] of neuves) {
    const i = index(cx, cy);
    if (!estVisible(etat.objets[i])) continue;
    etat.objets[i] = 0;
    noter(etat, ['itemgone', cx, cy]);
  }
}

/**
 * Revele les bonus caches sous les briques qui viennent de tomber.
 *
 * Appele APRES `brulerObjets` : c'est cet ordre, et lui seul, qui fait qu'un
 * bonus survit a l'explosion qui le decouvre.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {number[][]} briques
 */
export function revelerBonus(etat, briques) {
  for (const [cx, cy] of briques) {
    const i = index(cx, cy);
    if (!estCache(etat.objets[i])) continue;
    const code = codeDe(etat.objets[i]);
    etat.objets[i] = code;
    noter(etat, ['item', cx, cy, NOMS_BONUS[code]]);
  }
}

/**
 * Tue tous les bombers que touche une flamme.
 *
 * Balayage complet, et non « le premier trouve » : on marque tous les morts du
 * pas avant d'en tirer la moindre conclusion. Sans cela, « le dernier mort
 * gagne » dependrait de l'ordre du tableau des joueurs — bug classique et
 * invisible des clones de Bomberman.
 *
 * @param {import('./etat.js').Etat} etat
 */
export function brulerJoueurs(etat) {
  for (const joueur of etat.joueurs) {
    if (!joueur.vivant) continue;
    for (const flamme of etat.flammes) {
      // La boite MORTELLE, plus petite que celle de collision : on meurt en
      // entrant dans le feu, pas en s en approchant.
      if (!boiteSurCase(joueur.x, joueur.y, flamme.cx, flamme.cy, DEMI_MORTEL)) continue;
      tuer(etat, joueur, PAR_FLAMME);
      break;
    }
  }
}

/**
 * Tue un bomber, quelle qu'en soit la cause.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Joueur} joueur
 * @param {number} cause
 */
export function tuer(etat, joueur, cause) {
  if (!joueur.vivant) return;
  joueur.vivant = false;
  joueur.marche = false;
  joueur.mortAu = etat.pas;
  joueur.surBombe = null;

  // Ses bombes a detonateur n'attendent plus personne : on leur rend une meche.
  rendreLesMeches(etat, joueur.place);

  noter(etat, ['death', joueur.place, cause]);
}

/**
 * Ramassage des bonus.
 *
 * Appele APRES les morts : on ne ramasse pas en mourant. Un dernier survivant
 * qui prend un bonus posthume est visible a l'ecran, et absurde.
 *
 * @param {import('./etat.js').Etat} etat
 */
export function ramasserBonus(etat) {
  for (const joueur of etat.joueurs) {
    if (!joueur.vivant) continue;
    const cx = caseAxe(joueur.x);
    const cy = caseAxe(joueur.y);
    const i = index(cx, cy);
    const valeur = etat.objets[i];
    if (!estVisible(valeur)) continue;
    etat.objets[i] = 0;
    noter(etat, ['pick', cx, cy, joueur.place, NOMS_BONUS[valeur]]);
    appliquer(joueur, valeur);
  }
}

/**
 * Fait vieillir les flammes d'un pas et retire celles qui s'eteignent.
 *
 * @param {import('./etat.js').Etat} etat
 */
export function vieillirFlammes(etat) {
  for (let i = etat.flammes.length - 1; i >= 0; i -= 1) {
    etat.flammes[i].reste -= 1;
    if (etat.flammes[i].reste <= 0) etat.flammes.splice(i, 1);
  }
}
