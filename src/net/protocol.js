/**
 * The network protocol, shared by the page and the relay.
 *
 * This file is the ONLY definition of that vocabulary. In the Tetris project it
 * is what keeps the two sides from diverging: the Worker imports exactly the
 * same module as the browser, and a misspelt message name breaks both at once,
 * hence straight away, instead of producing silence at run time.
 *
 * A difference in background from Tetris: there, each player simulates their own
 * board and the relay only arbitrates room membership. Here the arena is SHARED,
 * so the relay simulates it and broadcasts its state. Clients only send intents,
 * and decide nothing.
 */

/** Messages from the client to the relay. */
export const CLIENT = {
  JOIN: 'join', // { type, room, name, places, format, host?, resume? }
  BEGIN: 'begin', // { type } — the host starts without waiting for the room to fill
  BOT: 'bot', // { type, seat? } — seat an artificial opponent, there or anywhere
  INPUT: 'input', // { type, seat, seq, dir, bomb, det, hold } — intent
  RESYNC: 'resync', // { type, v } — my arena no longer matches, send it again
  LEAVE: 'leave', // { type } — voluntary surrender
};

/** Messages from the relay to the client. */
export const SERVER = {
  WAITING: 'waiting', // { type, room, places, min, max, names, host, hosted }
  START: 'start', // { type, room, myId, mine, places, format }
  ROUND: 'round', // { type, round, seed, tiles, items, v }
  STATE: 'state', // { type, t, v, j, b, f }
  ARENA: 'arena', // { type, v, tiles, items } — answer to RESYNC
  EVENTS: 'events', // { type, t, e }
  SCORE: 'score', // { type, verdict, scores, wait }
  FINISHED: 'finished', // { type, winner, scores }
  FROZEN: 'frozen', // { type, awaited: [{ place, seconds }] }
  AWAY: 'away', // { type, place, seconds }
  BACK: 'back', // { type, place }
  LEFT: 'left', // { type, place }
  ERROR: 'error', // { type, message }
};

/** Maximum length of a nickname: enough to be recognised, not to show off. */
export const NAME_MAX = 16;

/**
 * Cleans up a nickname received. It comes from a stranger and will end up shown
 * to the other players: we bring it back to short, unsurprising text, and never
 * let an empty string through.
 */
export function cleanName(raw, fallback = 'Joueur') {
  if (typeof raw !== 'string') return fallback;
  // Control characters have no business in a nickname, and multiple spaces serve
  // mostly to make oneself an invisible name.
  const clean = raw
    .replace(/\s+/g, ' ')
    .replace(/[\p{C}]/gu, '')
    .trim()
    .slice(0, NAME_MAX);
  return clean || fallback;
}

/**
 * Names offered to whoever has none.
 *
 * Towns and mountains of Japan, a nod to Hudson Soft, where Bomberman was born.
 * None of them is an artificial opponent's first name (BOT_NAMES, below): in a
 * four-way scrum, a human must be tellable from an AI at a glance. The two lists
 * being disjoint is checked by test/protocole.test.js.
 */
export const HUMAN_NAMES = [
  'Fuji', 'Sapporo', 'Hakone', 'Otaru', 'Nagano', 'Aso',
  'Kobe', 'Nara', 'Hakodate', 'Noto', 'Iwate', 'Tottori',
  'Ome', 'Beppu', 'Kurama', 'Zao', 'Shikoku', 'Izu',
];

/**
 * A nickname drawn at random, for the player who arrives unnamed.
 *
 * An empty field is worth nothing: everybody would be called "Joueur", numbered
 * one after the other, and the banner would announce "Joueur 3" without anybody
 * recognising themselves. Any distinct name makes the game legible, and the
 * player replaces it if they want.
 *
 * @param {() => number} random source of randomness, injectable for the tests
 */
export function randomName(random = Math.random) {
  const index = Math.min(HUMAN_NAMES.length - 1, Math.max(0, Math.floor(random() * HUMAN_NAMES.length)));
  return HUMAN_NAMES[index];
}

/**
 * First names of the artificial opponents.
 *
 * First names rather than "Bot 1": the banner names whoever has just won, and a
 * name is recognised at a glance where a number has to be deciphered.
 */
export const BOT_NAMES = ['Aki', 'Haru', 'Kenji', 'Mika', 'Riku', 'Sora', 'Yuki', 'Taro'];

/**
 * An artificial opponent's first name, drawn at random.
 *
 * @param {() => number} random source of randomness, injectable for the tests
 */
export function randomBotName(random = Math.random) {
  const index = Math.min(BOT_NAMES.length - 1, Math.max(0, Math.floor(random() * BOT_NAMES.length)));
  return BOT_NAMES[index];
}

/**
 * Bot first names all different from each other, with no draw.
 *
 * Two bots with the same name in one game would make the scoreboard illegible,
 * and a blind draw produces that one time in eight.
 *
 * @param {number} count
 * @param {number} offset so that two games in a row do not look alike
 */
export function botNames(count, offset = 0) {
  const names = [];
  for (let i = 0; i < count; i += 1) {
    names.push(BOT_NAMES[(offset + i) % BOT_NAMES.length]);
  }
  return names;
}

/**
 * It takes at least two bombers to make a game, and the arena only has four
 * corners: unlike Tetris, there is a maximum here.
 */
export const MIN_PLACES = 2;
export const MAX_PLACES = 4;

/**
 * Alphabet of the room codes.
 *
 * No O nor 0, no I nor 1: a code is read aloud and copied by hand from a
 * friend's screen. Ambiguous pairs cost more in missed rooms than they earn in
 * combinations.
 */
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Accepted lengths for a room code. */
export const ROOM_MIN = 4;
export const ROOM_MAX = 8;

/**
 * Cleans up a room code.
 *
 * The code travels in a URL and is typed by hand: we ignore case, throw away
 * anything that is not a letter or a digit — spaces and dashes added while
 * copying — and truncate. Returns '' when nothing usable is left: it is up to
 * the caller to decide to draw one at random.
 *
 * The page AND the relay call this function before naming the room, so that
 * "essai" and "ESSAI" lead to the same place.
 */
export function cleanRoom(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_MAX);
}

/**
 * A room code drawn at random, for whoever arrives without a link.
 *
 * @param {() => number} random source of randomness, injectable for the tests
 */
export function randomRoom(random = Math.random) {
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    const index = Math.min(
      ROOM_ALPHABET.length - 1,
      Math.max(0, Math.floor(random() * ROOM_ALPHABET.length)),
    );
    code += ROOM_ALPHABET[index];
  }
  return code;
}

/**
 * Grace period given to a disconnected player to come back.
 *
 * A connection going down is not a surrender: Wi-Fi hiccups, a relay restarts, a
 * phone changes cell. Eliminating on the spot punished an accident; waiting
 * indefinitely would block the others. Thirty seconds leave time to come back
 * without keeping the room waiting.
 */
export const RESUME_MS = 30000;

export function encode(message) {
  return JSON.stringify(message);
}

/**
 * Parses a message received. Returns null rather than throwing: a client can
 * always send anything at all, and that must not kill the others' game.
 */
export function decode(raw) {
  try {
    const message = JSON.parse(raw);
    return message && typeof message.type === 'string' ? message : null;
  } catch {
    return null;
  }
}
