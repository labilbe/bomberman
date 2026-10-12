/**
 * Bombes : pose, meche, kick, detonateur.
 *
 * Une bombe posee occupe TOUJOURS une case entiere, reperee par `cx, cy` en
 * tuiles. Une bombe kickee garde en plus `glisse.x / glisse.y` en sous-unites
 * pour l'affichage, mais son occupation logique reste la case `cx, cy` jusqu'a
 * ce qu'elle atteigne le centre de la suivante. C'est ce qui evite d'avoir a
 * gerer une bombe a cheval sur deux cases — et une bombe a cheval, c'est une
 * flamme dont on ne sait pas d'ou elle part.
 *
 * Les bombes sont rangees par ordre de pose, et leur identifiant croit. Cet
 * ordre EST le determinisme : les meches sont relevees par id croissant, et le
 * detonateur declenche la plus ancienne.
 */

import {
  MECHE_PAS,
  VECTEURS,
  VITESSE_BOMBE,
  UNITES,
  PORTEE_GANT,
  VOL_PAS_PAR_CASE,
} from './constantes.js';
import { caseDe, estLibre, caseAxe, centreAxe, boiteSurCase, dansArene } from './grille.js';
import { noter } from './etat.js';

/** La bombe posee sur cette case, ou null. */
export function bombeSur(etat, cx, cy) {
  for (const bombe of etat.bombes) {
    if (bombe.cx === cx && bombe.cy === cy) return bombe;
  }
  return null;
}

/**
 * La bombe POSEE sur cette case, en ignorant celles qui volent.
 *
 * Une bombe frappee appartient deja a sa case d'arrivee — c'est ce qui fait que
 * les flammes et la carte de danger la trouvent au bon endroit — mais elle est
 * en l'air, donc elle ne bloque encore personne. On peut traverser la case ou
 * elle va tomber tant qu'elle n'y est pas.
 */
export function bombePoseeSur(etat, cx, cy) {
  const bombe = bombeSur(etat, cx, cy);
  return bombe && !bombe.vol ? bombe : null;
}

/** La bombe portant cet identifiant, ou null. */
export function bombeDe(etat, id) {
  if (id === null || id === undefined) return null;
  for (const bombe of etat.bombes) {
    if (bombe.id === id) return bombe;
  }
  return null;
}

/**
 * Peut-on poser ici, maintenant ?
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Joueur} joueur
 */
export function peutPoser(etat, joueur) {
  if (!joueur.vivant) return false;
  if (joueur.posees >= joueur.bombes) return false;
  const cx = caseAxe(joueur.x);
  const cy = caseAxe(joueur.y);
  return bombeSur(etat, cx, cy) === null;
}

/**
 * Pose une bombe sous les pieds du bomber.
 *
 * `surBombe` est arme du meme geste : sans cela le bomber serait bloque par sa
 * propre bombe a l'instant ou il la pose, et le jeu entier — qui consiste a
 * poser puis fuir — deviendrait injouable.
 *
 * UNE BOMBE DE PORTEUR DU DETONATEUR N'A PAS DE MECHE. Sa `meche` vaut `null`,
 * et elle attend indefiniment : c'est le marche du bonus, et toute sa saveur.
 * Avec une meche, le detonateur ne serait qu'une facon d'aller plus vite ; sans
 * elle, il devient une arme de patience — on pose devant un couloir, on attend
 * que l'adversaire s'y engage. Atomic Bomberman la distingue d'ailleurs a
 * l'ecran, et le rendu fait de meme.
 *
 * Le nombre de bombes posables reste la limite : un porteur de detonateur ne
 * peut pas couvrir l'arene, il doit declencher pour reposer.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Joueur} joueur
 * @returns {import('./etat.js').Bombe | null}
 */
export function poser(etat, joueur) {
  if (!peutPoser(etat, joueur)) return null;
  const cx = caseAxe(joueur.x);
  const cy = caseAxe(joueur.y);
  const bombe = {
    id: etat.prochainId,
    cx,
    cy,
    place: joueur.place,
    portee: joueur.portee,
    meche: joueur.detonateur ? null : MECHE_PAS,
    glisse: null,
    /** Vol du gant de boxe : non nul tant que la bombe est en l air. */
    vol: null,
  };
  etat.prochainId += 1;
  etat.bombes.push(bombe);
  joueur.posees += 1;
  joueur.surBombe = bombe.id;
  noter(etat, ['bomb', cx, cy, joueur.place]);
  return bombe;
}

/**
 * Fait bruler les meches d'un pas et releve celles arrivees a terme.
 *
 * Releve par ordre d'identifiant : si deux meches finissent au meme pas, c'est
 * la plus ancienne qui part la premiere, et le resultat ne depend pas de l'ordre
 * du tableau.
 *
 * @param {import('./etat.js').Etat} etat
 * @returns {import('./etat.js').Bombe[]}
 */
export function avancerMeches(etat) {
  const terminees = [];
  for (const bombe of etat.bombes) {
    // `null` veut dire « pas de meche » : une bombe a detonateur, qui attend.
    // Elle ne vieillit pas, et c'est bien tout ce qui la distingue ici.
    if (bombe.meche === null) continue;
    bombe.meche -= 1;
    if (bombe.meche <= 0) terminees.push(bombe);
  }
  return terminees.sort((a, b) => a.id - b.id);
}

/** Une bombe peut-elle glisser sur cette case ? */
function caseOuvertePourBombe(etat, cx, cy) {
  if (!estLibre(caseDe(etat, cx, cy))) return false;
  if (bombeSur(etat, cx, cy)) return false;
  // Un bomber arrete la bombe : sinon elle le traverserait, et il mourrait d'une
  // bombe qu'il n'a jamais vue passer.
  for (const joueur of etat.joueurs) {
    if (joueur.vivant && boiteSurCase(joueur.x, joueur.y, cx, cy)) return false;
  }
  return true;
}

/**
 * Lance une bombe dans une direction, si la voie est libre.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Bombe} bombe
 * @param {number} dir
 * @returns {boolean} vrai si elle part
 */
export function pousser(etat, bombe, dir) {
  if (bombe.glisse) return false;
  const v = VECTEURS[dir];
  if (!caseOuvertePourBombe(etat, bombe.cx + v.dx, bombe.cy + v.dy)) return false;
  bombe.glisse = { dir, x: centreAxe(bombe.cx), y: centreAxe(bombe.cy) };
  noter(etat, ['kick', bombe.id, dir]);
  return true;
}

/**
 * Fait avancer les bombes kickees d'un pas.
 *
 * Appele AVANT les bombers : une bombe qui bougerait apres eux les traverserait
 * d'un pas, puisque chacun verrait l'autre a sa position d'avant.
 *
 * Le recalage sur le centre se fait par affectation, jamais par division : la
 * bombe retombe donc exactement sur une case, et une bombe decalee d'une
 * sous-unite ne fait pas partir sa flamme de travers.
 *
 * @param {import('./etat.js').Etat} etat
 */
export function avancerGlissements(etat) {
  for (const bombe of etat.bombes) {
    if (!bombe.glisse) continue;
    const v = VECTEURS[bombe.glisse.dir];
    const cibleX = centreAxe(bombe.cx + v.dx);
    const cibleY = centreAxe(bombe.cy + v.dy);
    const restantX = cibleX - bombe.glisse.x;
    const restantY = cibleY - bombe.glisse.y;
    const restant = Math.abs(restantX) + Math.abs(restantY);

    if (restant > VITESSE_BOMBE) {
      bombe.glisse.x += Math.sign(restantX) * VITESSE_BOMBE;
      bombe.glisse.y += Math.sign(restantY) * VITESSE_BOMBE;
      continue;
    }

    // Elle vient d'atteindre le centre de la case suivante : elle l'occupe.
    bombe.cx += v.dx;
    bombe.cy += v.dy;
    bombe.glisse.x = cibleX;
    bombe.glisse.y = cibleY;

    if (!caseOuvertePourBombe(etat, bombe.cx + v.dx, bombe.cy + v.dy)) {
      bombe.glisse = null;
    }
  }
}

/**
 * Frappe la bombe devant soi : elle part en l'air.
 *
 * C'EST LA DIFFERENCE AVEC LE COUP DE PIED, et toute l'utilite du bonus. Le
 * kick pousse au ras du sol et s'arrete au premier obstacle ; le gant fait
 * PASSER la bombe par-dessus murs, briques et joueurs, pour la poser derriere.
 * On peut donc renvoyer chez l'adversaire une bombe qu'on vient de recevoir,
 * meme s'il s'est abrite.
 *
 * Elle atterrit sur la case la plus LOINTAINE qui soit libre, dans la limite du
 * gant. Prendre la plus proche aurait fait retomber la bombe juste derriere le
 * mur ou l'on se cache, ce qui n'est une riposte pour personne ; et refuser des
 * qu'une case intermediaire est prise reviendrait a redonner au gant les
 * defauts du kick.
 *
 * Rien ne part si aucune case n'est libre : la bombe reste ou elle est, plutot
 * que de disparaitre ou de se poser sur un mur.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Joueur} joueur
 * @returns {import('./etat.js').Bombe | null} la bombe frappee, ou null
 */
export function frapper(etat, joueur) {
  if (!joueur.gant || !joueur.vivant) return null;

  const v = VECTEURS[joueur.dir];
  const depuisX = caseAxe(joueur.x) + v.dx;
  const depuisY = caseAxe(joueur.y) + v.dy;
  const bombe = bombeSur(etat, depuisX, depuisY);
  // Une bombe deja en l'air ne se refrappe pas : on ne rattrape pas au vol.
  if (!bombe || bombe.vol) return null;

  let versX = null;
  let versY = null;
  for (let i = 1; i <= PORTEE_GANT; i += 1) {
    const x = depuisX + v.dx * i;
    const y = depuisY + v.dy * i;
    if (!dansArene(x, y)) break;
    if (!estLibre(caseDe(etat, x, y))) continue;
    if (bombeSur(etat, x, y)) continue;
    versX = x;
    versY = y;
  }
  if (versX === null) return null;

  const cases = Math.abs(versX - depuisX) + Math.abs(versY - depuisY);
  bombe.cx = versX;
  bombe.cy = versY;
  bombe.glisse = null;
  // La bombe appartient DEJA a sa case d'arrivee : flammes, chaines et carte de
  // danger raisonnent donc sur l'endroit ou elle va tomber, et non sur celui
  // qu'elle a quitte. `vol` ne commande que son dessin et le fait qu'elle ne
  // bloque encore personne.
  bombe.vol = {
    dir: joueur.dir,
    depuisX,
    depuisY,
    reste: cases * VOL_PAS_PAR_CASE,
    duree: cases * VOL_PAS_PAR_CASE,
  };
  noter(etat, ['punch', bombe.id, depuisX, depuisY, versX, versY]);
  return bombe;
}

/** Fait avancer les bombes en vol d'un pas, et pose celles qui atterrissent. */
export function avancerVols(etat) {
  for (const bombe of etat.bombes) {
    if (!bombe.vol) continue;
    bombe.vol.reste -= 1;
    if (bombe.vol.reste <= 0) bombe.vol = null;
  }
}

/**
 * Declenche a distance la plus ancienne bombe du bomber.
 *
 * La plus ancienne, et non toutes : c'est le comportement d'Atomic Bomberman, et
 * c'est aussi le seul qui laisse jouer — tout faire sauter d'un coup prive le
 * detonateur de son interet, qui est de choisir l'instant de chaque bombe.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {import('./etat.js').Joueur} joueur
 * @returns {import('./etat.js').Bombe | null}
 */
export function declencher(etat, joueur) {
  if (!joueur.detonateur || !joueur.vivant) return null;
  let choisie = null;
  for (const bombe of etat.bombes) {
    if (bombe.place !== joueur.place) continue;
    if (choisie === null || bombe.id < choisie.id) choisie = bombe;
  }
  if (choisie === null) return null;

  // Une charge par bombe reellement declenchee, et pas par appui : appuyer dans
  // le vide ne doit pas gaspiller la reserve.
  joueur.detonateur -= 1;
  // La derniere charge partie, ce qui attendait encore n'attend plus personne.
  if (joueur.detonateur === 0) rendreLesMeches(etat, joueur.place, choisie.id);
  return choisie;
}

/**
 * Rend une meche ordinaire aux bombes d'une place qui n'en avaient pas.
 *
 * Une bombe a detonateur attend indefiniment, ce qui est son interet tant qu'un
 * doigt peut la declencher. Quand ce doigt disparait — reserve epuisee, ou
 * porteur mort — elle resterait posee jusqu'a la fin de la manche : un obstacle
 * definitif au milieu de l'arene, que plus personne ne peut lever.
 *
 * @param {import('./etat.js').Etat} etat
 * @param {number} place
 * @param {number | null} sauf identifiant a laisser tel quel
 */
export function rendreLesMeches(etat, place, sauf = null) {
  for (const bombe of etat.bombes) {
    if (bombe.place !== place || bombe.id === sauf) continue;
    if (bombe.meche === null) bombe.meche = MECHE_PAS;
  }
}

/** Distance restante avant que la bombe n'atteigne le centre de sa case suivante. */
export function avanceeGlissement(bombe) {
  if (!bombe.glisse) return 0;
  const v = VECTEURS[bombe.glisse.dir];
  const parcouru =
    Math.abs(bombe.glisse.x - centreAxe(bombe.cx)) + Math.abs(bombe.glisse.y - centreAxe(bombe.cy));
  return v.dx || v.dy ? parcouru / UNITES : 0;
}
