/**
 * Protocole du jeu en reseau, partage par la page et le relais.
 *
 * Ce fichier est la SEULE definition de ce vocabulaire. Au Tetris, c'est ce qui
 * empeche les deux cotes de diverger : le Worker importe exactement le meme
 * module que le navigateur, et un nom de message mal orthographie casse les deux
 * a la fois, donc tout de suite, au lieu de produire un silence a l'execution.
 *
 * Le protocole est en ANGLAIS alors que le code est en francais. La frontiere
 * est volontaire et nette : ce qui voyage sur le fil ne change jamais, ce qui
 * vit dans le code se relit dans la langue de ceux qui l'ecrivent.
 *
 * Difference de fond avec le Tetris : la-bas, chaque joueur simule son propre
 * plateau et le relais n'arbitre que l'appartenance au salon. Ici l'arene est
 * PARTAGEE, donc le relais la simule et en diffuse l'etat. Les clients n'envoient
 * que des intentions, et ne decident de rien.
 */

/** Messages du client vers le relais. */
export const CLIENT = {
  JOIN: 'join', // { type, room, name, places, format, reprise? }
  BEGIN: 'begin', // { type } — lancer sans attendre que le salon soit plein
  BOT: 'bot', // { type } — completer le salon d'un adversaire artificiel
  INPUT: 'input', // { type, siege, seq, dir, bomb, det } — intention
  RESYNC: 'resync', // { type, v } — mon arene ne colle plus, renvoyez-la
  LEAVE: 'leave', // { type } — abandon volontaire
};

/** Messages du relais vers le client. */
export const SERVER = {
  WAITING: 'waiting', // { type, room, places, min, max, noms }
  START: 'start', // { type, room, moiId, miens, places, format }
  ROUND: 'round', // { type, manche, graine, tuiles, objets, v }
  STATE: 'state', // { type, t, v, j, b, f }
  ARENA: 'arena', // { type, v, tuiles, objets } — reponse a RESYNC
  EVENTS: 'events', // { type, t, e }
  SCORE: 'score', // { type, verdict, scores, attente }
  FINISHED: 'finished', // { type, vainqueur, scores }
  FROZEN: 'frozen', // { type, attendus: [{ place, secondes }] }
  AWAY: 'away', // { type, place, secondes }
  BACK: 'back', // { type, place }
  LEFT: 'left', // { type, place }
  ERROR: 'error', // { type, message }
};

/** Longueur maximale d'un pseudo : de quoi se reconnaitre, pas de quoi pavoiser. */
export const NAME_MAX = 16;

/**
 * Nettoie un pseudo recu. Il vient d'un inconnu et finira affiche chez les
 * autres joueurs : on le ramene a du texte court et sans surprise, et on ne
 * laisse jamais passer une chaine vide.
 */
export function cleanName(raw, fallback = 'Joueur') {
  if (typeof raw !== 'string') return fallback;
  // Les caracteres de controle n'ont rien a faire dans un pseudo, et les espaces
  // multiples servent surtout a se fabriquer un nom invisible.
  const propre = raw
    .replace(/\s+/g, ' ')
    .replace(/[\p{C}]/gu, '')
    .trim()
    .slice(0, NAME_MAX);
  return propre || fallback;
}

/**
 * Noms proposes a qui n'en a pas.
 *
 * Des villes et des montagnes du Japon, clin d'oeil a Hudson Soft, ou
 * Bomberman est ne. Aucun n'est un prenom d'adversaire artificiel (BOT_NAMES,
 * plus bas) : dans une melee a quatre, on doit pouvoir distinguer d'un coup
 * d'oeil un humain d'une IA. La disjonction des deux listes est verifiee par
 * test/protocole.test.js.
 */
export const HUMAN_NAMES = [
  'Fuji', 'Sapporo', 'Hakone', 'Otaru', 'Nagano', 'Aso',
  'Kobe', 'Nara', 'Hakodate', 'Noto', 'Iwate', 'Tottori',
  'Ome', 'Beppu', 'Kurama', 'Zao', 'Shikoku', 'Izu',
];

/**
 * Un pseudo tire au sort, pour le joueur qui arrive sans s'etre nomme.
 *
 * Un champ vide ne vaut rien : tout le monde s'appellerait « Joueur », numerote
 * les uns derriere les autres, et la banniere annoncerait « Joueur 3 » sans que
 * personne ne se reconnaisse. Un nom quelconque mais distinct rend la partie
 * lisible, et le joueur le remplace s'il veut.
 *
 * @param {() => number} alea source du hasard, injectable pour les tests
 */
export function randomName(alea = Math.random) {
  const rang = Math.min(HUMAN_NAMES.length - 1, Math.max(0, Math.floor(alea() * HUMAN_NAMES.length)));
  return HUMAN_NAMES[rang];
}

/**
 * Prenoms des adversaires artificiels.
 *
 * Des prenoms plutot que « Bot 1 » : la banniere nomme celui qui vient de
 * gagner, et un nom se reconnait d'un coup d'oeil la ou un numero se dechiffre.
 */
export const BOT_NAMES = ['Aki', 'Haru', 'Kenji', 'Mika', 'Riku', 'Sora', 'Yuki', 'Taro'];

/**
 * Un prenom d'adversaire artificiel, tire au sort.
 *
 * @param {() => number} alea source du hasard, injectable pour les tests
 */
export function randomBotName(alea = Math.random) {
  const rang = Math.min(BOT_NAMES.length - 1, Math.max(0, Math.floor(alea() * BOT_NAMES.length)));
  return BOT_NAMES[rang];
}

/**
 * Des prenoms de bots tous differents, sans tirage.
 *
 * Deux bots homonymes dans la meme partie rendraient le tableau des scores
 * illisible, et un tirage aveugle en produit une fois sur huit.
 *
 * @param {number} nombre
 * @param {number} decalage pour que deux parties de suite ne se ressemblent pas
 */
export function nomsDeBots(nombre, decalage = 0) {
  const noms = [];
  for (let i = 0; i < nombre; i += 1) {
    noms.push(BOT_NAMES[(decalage + i) % BOT_NAMES.length]);
  }
  return noms;
}

/**
 * Il faut au moins deux bombers pour une partie, et l'arene n'a que quatre
 * coins : contrairement au Tetris, il y a ici un maximum.
 */
export const MIN_PLACES = 2;
export const MAX_PLACES = 4;

/**
 * Alphabet des codes de salon.
 *
 * Ni O ni 0, ni I ni 1 : un code se lit a voix haute et se recopie a la main
 * depuis l'ecran d'un ami. Les paires ambigues coutent plus cher en salons
 * manques qu'elles ne rapportent en combinaisons.
 */
const ALPHABET_SALON = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Longueurs acceptees pour un code de salon. */
export const ROOM_MIN = 4;
export const ROOM_MAX = 8;

/**
 * Nettoie un code de salon.
 *
 * Le code voyage dans une URL et se tape a la main : on ignore la casse, on
 * jette tout ce qui n'est pas une lettre ou un chiffre — espaces et tirets que
 * l'on ajoute en recopiant — et on tronque. Renvoie '' si rien d'utilisable ne
 * reste : c'est a l'appelant de decider d'en tirer un au sort.
 *
 * La page ET le relais appellent cette fonction avant de nommer le salon, pour
 * que « essai » et « ESSAI » menent au meme endroit.
 */
export function cleanRoom(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_MAX);
}

/**
 * Un code de salon tire au sort, pour qui arrive sans lien.
 *
 * @param {() => number} alea source du hasard, injectable pour les tests
 */
export function randomRoom(alea = Math.random) {
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    const rang = Math.min(
      ALPHABET_SALON.length - 1,
      Math.max(0, Math.floor(alea() * ALPHABET_SALON.length)),
    );
    code += ALPHABET_SALON[rang];
  }
  return code;
}

/**
 * Delai laisse a un joueur coupe pour revenir.
 *
 * Une connexion qui tombe n'est pas un abandon : un Wi-Fi hoquette, un relais
 * redemarre, un telephone change d'antenne. Eliminer sur-le-champ punissait un
 * accident ; attendre indefiniment bloquerait les autres. Trente secondes
 * laissent le temps de revenir sans faire languir le salon.
 */
export const REPRISE_MS = 30000;

export function encode(message) {
  return JSON.stringify(message);
}

/**
 * Analyse un message recu. Renvoie null plutot que de lever : un client peut
 * toujours envoyer n'importe quoi, et cela ne doit pas tuer la partie des
 * autres.
 */
export function decode(raw) {
  try {
    const message = JSON.parse(raw);
    return message && typeof message.type === 'string' ? message : null;
  } catch {
    return null;
  }
}
