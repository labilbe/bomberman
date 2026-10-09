/**
 * Le seul module qui connaisse a la fois le DOM, l'horloge et le moteur.
 *
 * Tout le reste est pur ou specialise : le moteur ignore le navigateur, le rendu
 * ne decide rien, le clavier n'emet rien, le transport ne dessine rien. Cette
 * page est l'endroit ou ces quatre mondes se rencontrent, et c'est volontaire :
 * quand quelque chose ne marche pas, il n'y a qu'un fichier ou le chercher.
 */

import { creerScene } from './render/scene.js';
import { chargerVectoriels } from './render/vectoriels.js';
import { depuisDessins, depuisVectoriels } from './render/jeuDeSprites.js';
import { creerClavier, TOUCHES } from './input/clavier.js';
import { creerHud, creerBanniere } from './view/hud.js';
import { creerTransportLocal } from './net/transport.js';
import { creerSons } from './audio/sons.js';
import { creerPilote } from './ai/pilote.js';
import { randomSeed } from './engine/rng.js';
import { MAX_JOUEURS, PAS_MS } from './engine/constantes.js';
import { couleurDePlace } from './render/palette.js';
import { randomRoom, cleanRoom, cleanName, randomName, nomsDeBots } from './net/protocole.js';

const menu = document.querySelector('#menu');
const jeu = document.querySelector('#jeu');
const toile = document.querySelector('#toile');
const arene = document.querySelector('#arene');
const pseudoInput = document.querySelector('#pseudo');
const salonInput = document.querySelector('#salon');
const siegesSelect = document.querySelector('#sieges');
const formatSelect = document.querySelector('#format');
const botsSelect = document.querySelector('#bots');
const boutonLocal = document.querySelector('#jouer-local');
const boutonMulti = document.querySelector('#jouer-multi');
const boutonQuitter = document.querySelector('#quitter');
const etatReseau = document.querySelector('#etat-reseau');

const PREF_PSEUDO = 'bomberman.pseudo';
const PREF_SALON = 'bomberman.salon';
const PREF_SIEGES = 'bomberman.sieges';
const PREF_FORMAT = 'bomberman.format';
const PREF_BOTS = 'bomberman.bots';

/** Lecture tolerante du stockage : un navigateur en navigation privee le refuse. */
function lirePref(cle, defaut) {
  try {
    return localStorage.getItem(cle) ?? defaut;
  } catch {
    return defaut;
  }
}

function ecrirePref(cle, valeur) {
  try {
    localStorage.setItem(cle, valeur);
  } catch {
    // Tant pis : la preference ne survivra pas a la fermeture de l'onglet.
  }
}

/**
 * Les sprites d'Atomic Bomberman s'ils ont ete extraits, sinon ceux peints au
 * code.
 *
 * L'attente est en tete de module, avant toute construction : la taille des
 * cases depend du jeu de sprites, donc la scene ne peut pas naitre avant de
 * savoir lequel elle aura. Un depot fraichement clone n'a pas d'assets et part
 * directement sur les sprites dessines — c'est le cas normal, pas une panne.
 */
const vectoriels = await chargerVectoriels().catch((erreur) => {
  // On retombe sur les sprites dessines, mais sans se taire : un repli
  // silencieux donne un jeu qui marche et une extraction qu'on croit branchee.
  console.warn('sprites vectoriels indisponibles, repli sur le dessin au code', erreur);
  return null;
});
const scene = creerScene(toile, vectoriels ? depuisVectoriels(vectoriels) : depuisDessins());
const hud = creerHud(document.querySelector('#hud'));
const banniere = creerBanniere(document.querySelector('#banniere'));
const clavier = creerClavier({ nombre: TOUCHES.length });
const sons = creerSons();
const boutonSon = document.querySelector('#son');

/** La partie en cours, ou null quand on est au menu. */
let session = null;

/**
 * Met l'arene a l'echelle de la place disponible.
 *
 * Un facteur ENTIER serait l'ideal — des pixels tous de la meme largeur — mais
 * il est hors d'atteinte en pratique : l'arene fait 416 pixels de haut, donc le
 * facteur 2 demande 832 pixels rien que pour elle, ce qu'un ecran d'ordinateur
 * portable n'a pas une fois l'entete et le tableau de bord poses. Le jeu
 * resterait minuscule au milieu d'un ecran vide.
 *
 * On prend donc le facteur exact qui remplit la place, et on le fige a l'entier
 * quand on en est tres proche. Le rendu reste franc : `image-rendering:
 * pixelated` n'interpole jamais, il duplique — un pixel peut etre voisin d'un
 * pixel d'une rangee de plus, mais aucun n'est flou. Et sur un ecran a facteur
 * d'affichage 1,25 ou 1,5, comme la plupart des ecrans Windows, un facteur
 * entier en CSS n'etait de toute facon pas entier en pixels reels.
 */
const ECHELLE_MAX = 3;

function ajusterEchelle() {
  // La largeur se mesure sur le PARENT, jamais sur le cadre de l'arene : celui-ci
  // se dimensionne sur le canvas qu'il contient, et se mesurer sur lui revenait a
  // demander au canvas de quelle taille il voulait etre — il ne grandissait
  // jamais.
  const dispoLargeur = Math.max(240, (arene.parentElement?.clientWidth ?? 0) - 40);
  const dispoHauteur = Math.max(200, window.innerHeight - arene.getBoundingClientRect().top - 96);
  const brut = Math.min(dispoLargeur / scene.largeur, dispoHauteur / scene.hauteur, ECHELLE_MAX);
  const proche = Math.round(brut);
  const facteur = Math.max(1, Math.abs(brut - proche) < 0.08 ? proche : brut);
  toile.style.width = `${Math.round(scene.largeur * facteur)}px`;
  toile.style.height = `${Math.round(scene.hauteur * facteur)}px`;
}

window.addEventListener('resize', () => {
  if (session) ajusterEchelle();
});

function montrerMenu() {
  menu.hidden = false;
  jeu.hidden = true;
  banniere.cacher();
  etatReseau.textContent = '';
}

function arreterSession() {
  if (!session) return;
  cancelAnimationFrame(session.image);
  session.transport.fermer();
  session = null;
  clavier.oubli();
  // La musique du menu ne demarre qu'ICI, au retour : au chargement de la page
  // le contexte audio n'existe pas encore, et le navigateur refuserait de la
  // lancer sans un geste. Quelqu'un qui clique « Jouer » tout de suite ne la
  // telecharge donc jamais.
  sons.musiqueDeMenu();
  montrerMenu();
}

/** Libelle d'une place, pour le HUD et les bannieres. */
function nommer(place, humains, noms) {
  if (noms?.[place]) return noms[place];
  if (place < humains) return `${couleurDePlace(place).nom} — vous`;
  return couleurDePlace(place).nom;
}

/**
 * Lance une partie locale : un ou deux joueurs au clavier, le reste en bots.
 */
function jouerEnLocal() {
  arreterSession();

  const humains = Math.max(1, Math.min(TOUCHES.length, Number(siegesSelect.value) || 1));
  const bots = Math.max(0, Math.min(MAX_JOUEURS - humains, Number(botsSelect.value) || 0));
  const places = Math.min(MAX_JOUEURS, humains + bots);
  const format = Number(formatSelect.value) || 3;

  ecrirePref(PREF_SIEGES, String(humains));
  ecrirePref(PREF_BOTS, String(bots));
  ecrirePref(PREF_FORMAT, String(format));
  ecrirePref(PREF_PSEUDO, cleanName(pseudoInput.value, pseudoInput.value));

  // Les niveaux montent avec le numero de place : le premier bot laisse
  // respirer, le dernier chasse. A quatre, la partie a une pente.
  const niveaux = ['tranquille', 'normal', 'teigneux'];
  const pilotes = {};
  const noms = [];
  // Des prenoms tous differents, et pas les memes d'une partie a l'autre.
  const prenoms = nomsDeBots(bots, Math.floor(Math.random() * 8));
  for (let place = 0; place < places; place += 1) {
    if (place < humains) {
      noms[place] = humains === 1 ? cleanName(pseudoInput.value) : `Joueur ${place + 1}`;
      continue;
    }
    pilotes[place] = creerPilote({ niveau: niveaux[(place - humains) % niveaux.length] });
    noms[place] = prenoms[place - humains];
  }

  const transport = creerTransportLocal({
    graine: randomSeed(),
    places,
    humains,
    format,
    pilotes,
  });

  demarrer(transport, { humains, places, noms });
}

/**
 * Branche un transport sur l'ecran, le clavier et la boucle de rendu. Le meme
 * code servira au jeu en ligne : seul le transport change.
 */
async function demarrer(transport, { humains, places, noms }) {
  const depart = await transport.demarrer();
  const nombre = depart.places ?? places;
  const etiquettes = Array.from({ length: nombre }, (_, place) =>
    nommer(place, humains, depart.noms ?? noms),
  );

  hud.construire(nombre, etiquettes);
  menu.hidden = true;
  jeu.hidden = false;
  ajusterEchelle();

  let vue = null;
  let match = null;

  transport.surVue((etat, matchCourant) => {
    vue = etat;
    match = matchCourant;
  });

  transport.surEvenements((liste) => {
    scene.evenements(liste, performance.now());
    sons.reagir(liste);
  });

  transport.surTransition((transition) => {
    sons.transition(transition);
    if (transition.type === 'round') {
      // La duree vient du moteur : c'est exactement le temps pendant lequel il
      // tient l'arene figee. Un reglage a part ici, et l'annonce disparaitrait
      // avant que la manche demarre, ou resterait apres.
      banniere.montrer({ titre: `Manche ${transition.manche}`, duree: transition.attente * PAS_MS });
      return;
    }
    if (transition.type === 'score') {
      const titre = transition.verdict.nulle
        ? 'Manche nulle'
        : `${etiquettes[transition.verdict.gagnante] ?? 'Personne'} gagne la manche`;
      banniere.montrer({
        titre,
        detail: transition.scores.map((score, place) => `${etiquettes[place]} : ${score}`).join('  ·  '),
      });
      return;
    }
    if (transition.type === 'finished') {
      banniere.montrer({
        titre:
          transition.vainqueur === null
            ? 'Match nul'
            : `${etiquettes[transition.vainqueur]} remporte le match`,
        detail: transition.scores.map((score, place) => `${etiquettes[place]} : ${score}`).join('  ·  '),
        boutons: [{ texte: 'Retour au menu', action: arreterSession }],
      });
    }
  });

  transport.surEtatReseau((etat) => {
    etatReseau.textContent = etat?.message ?? '';
  });

  const miens = depart.miens ?? [];

  function image(maintenant) {
    if (!session) return;
    for (let siege = 0; siege < miens.length; siege += 1) {
      transport.intention(miens[siege], clavier.lire(siege));
    }
    transport.battre(maintenant);
    if (vue) {
      scene.dessiner(vue, maintenant);
      hud.rafraichir(vue, match);
    }
    session.image = requestAnimationFrame(image);
  }

  session = { transport, image: requestAnimationFrame(image) };
}

/**
 * Le premier geste de la page, quel qu'il soit : audio et musique du menu.
 *
 * On ne peut pas lancer la musique au chargement — les navigateurs refusent
 * tout son tant que l'utilisateur n'a rien fait, et un contexte ouvert trop tot
 * reste bloque en « suspended » pour toute la session. Le premier clic ou la
 * premiere touche sont donc le plus tot possible, et ca vaut pour n'importe ou
 * dans la page, pas seulement sur le bouton « Jouer ».
 *
 * La petite attente evite un telechargement pour rien : la musique du menu pese
 * deux megaoctets et demi, et quelqu'un dont le tout premier geste est de
 * cliquer « Jouer » ne l'entendrait pas une seconde.
 */
function premierGeste() {
  document.removeEventListener('pointerdown', premierGeste);
  document.removeEventListener('keydown', premierGeste);
  sons.eveiller();
  setTimeout(() => {
    if (!session) sons.musiqueDeMenu();
  }, 300);
}
document.addEventListener('pointerdown', premierGeste);
document.addEventListener('keydown', premierGeste);

boutonLocal.addEventListener('click', () => {
  sons.eveiller();
  jouerEnLocal();
});
boutonQuitter.addEventListener('click', arreterSession);

function basculerSon() {
  const actif = sons.basculer();
  boutonSon.textContent = actif ? 'Son : actif' : 'Son : coupe';
  boutonSon.setAttribute('aria-pressed', String(actif));
}

boutonSon.addEventListener('click', basculerSon);
clavier.raccourci('KeyN', basculerSon);
clavier.raccourci('Escape', () => {
  if (session) arreterSession();
});

boutonMulti.addEventListener('click', () => {
  // Le relais arrive a l'etape suivante. On le dit plutot que de laisser un
  // bouton qui ne repond pas.
  etatReseau.textContent = '';
  banniere.cacher();
  boutonMulti.textContent = 'Le jeu en ligne arrive bientot';
  boutonMulti.disabled = true;
});

/** Etat initial des champs : le lien l'emporte sur la preference locale. */
function initialiser() {
  const invite = cleanRoom(new URLSearchParams(location.search).get('salon') ?? '');
  salonInput.value = invite || cleanRoom(lirePref(PREF_SALON, '')) || randomRoom();
  pseudoInput.value = cleanName(lirePref(PREF_PSEUDO, ''), randomName());
  siegesSelect.value = lirePref(PREF_SIEGES, '1');
  formatSelect.value = lirePref(PREF_FORMAT, '3');
  botsSelect.value = lirePref(PREF_BOTS, '3');
  salonInput.addEventListener('change', () => {
    salonInput.value = cleanRoom(salonInput.value);
    ecrirePref(PREF_SALON, salonInput.value);
  });
  montrerMenu();
}

initialiser();
