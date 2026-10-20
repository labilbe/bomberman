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
  JOIN: 'join', // { type, room, name, places, format, terrain?, colours?, colour?, host?, resume? }
  BEGIN: 'begin', // { type } — the host starts without waiting for the room to fill
  BOT: 'bot', // { type, seat? } — seat an artificial opponent, there or anywhere
  INPUT: 'input', // { type, seat, seq, dir, bomb, det, hold } — intent
  RESYNC: 'resync', // { type, v } — my arena no longer matches, send it again
  LEAVE: 'leave', // { type } — voluntary surrender
  // A frame for nothing, to keep the line open.
  //
  // THE WAITING ROOM IS SILENT: no beat, no intent, not a byte in either
  // direction while the host waits for their friends. An idle WebSocket does
  // not survive that long in front of a proxy — it is closed after a minute or
  // two — and the page, which has no reason to suspect it, went on showing a
  // waiting room whose "Démarrer" went nowhere. The relay has nothing to do
  // with this message; receiving it is the whole point.
  PING: 'ping', // { type }
};

/** Messages from the relay to the client. */
export const SERVER = {
  WAITING: 'waiting', // { type, room, myId, places, min, max, names, colours, host, hosted }
  START: 'start', // { type, room, myId, mine, places, format, terrain, names, colours }
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
 * None of them is an artificial opponent's name (BOT_NAMES, below): in a
 * four-way scrum, a human must be tellable from an AI at a glance. The two lists
 * being disjoint is checked by test/protocol.test.js.
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
 * Names of the artificial opponents.
 *
 * Names rather than "Bot 1": the banner names whoever has just won, and a name
 * is recognised at a glance where a number has to be deciphered. These are
 * handles, chosen by the author, and they are kept spelled as they were given —
 * lower case included, which is how a handle is written.
 */
export const BOT_NAMES = [
  'hicks', 'sharak', 'cyberpsycho', 'penetrator', 'littlepsylo', 'psycho',
  'chacal', 'genghis', 'sybaris', 'zuul', 'igrec', 'kakaruto',
  'roots', 'toto', 'dbz', 'angus',
];

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
 * It takes at least two bombers to make a game, and the arena only has ten
 * starts: unlike Tetris, there is a maximum here. Ten is the original game's
 * own, and the same number as the colours a place can wear.
 */
export const MIN_PLACES = 2;
export const MAX_PLACES = 10;

/**
 * How many boards Atomic Bomberman has: eleven, numbered 0 to 10.
 *
 * It is a fact about the original game — TILES0 to TILES10 — and not about our
 * assets, which is why the number lives here rather than in the renderer: the
 * relay settles the board of a room, and it has no sprites at all. A page whose
 * extraction is short of a board simply falls back on the one it has.
 */
export const TERRAINS = 11;

/**
 * A board index, or null for "whichever one chance picks".
 *
 * Null is a real answer and not a failure: it is the new-game screen's default,
 * the "Random Each Game" of the original game's own options.
 */
export function cleanTerrain(raw) {
  const terrain = Number(raw);
  return Number.isInteger(terrain) && terrain >= 0 && terrain < TERRAINS ? terrain : null;
}

/**
 * A board drawn at random.
 *
 * Drawn ONCE PER GAME and never per round: a match whose scenery changed between
 * manche 2 and manche 3 would be two matches. The relay draws it for everybody,
 * since a board chosen by each screen would have two players looking at
 * different walls.
 *
 * @param {() => number} random source of randomness, injectable for the tests
 */
export function randomTerrain(random = Math.random) {
  return Math.min(TERRAINS - 1, Math.max(0, Math.floor(random() * TERRAINS)));
}

/**
 * A colour index, or null when it is anything else.
 *
 * STRICTLY A NUMBER, and that is the whole point of the function: `Number(null)`
 * is zero, so a missing colour read as a formal claim to white — the first of
 * the list — instead of falling back on a free one. A remembered row with no
 * colour and a client sending `null` both went through that door.
 */
function asColour(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_PLACES
    ? value
    : null;
}

/**
 * The colours of a room, cleaned up: one colour index per place.
 *
 * Whoever lays the table chooses them, and that choice travels over the wire —
 * so it comes from a stranger. A list of ten `-1`, one colour named twice, a
 * length that does not match the number of places: each of those would hand two
 * bombers the same skin, and two identical bombers in a scrum is not a game.
 *
 * So we keep whatever is a real colour nobody else has, and fill the rest with
 * the ones left over, in their own order. With nothing at all to go on it gives
 * back exactly `[0, 1, 2…]` — the place gives the colour, which is how a room
 * worked before anybody could choose.
 *
 * It lives here and not in the page because BOTH SIDES need it: the page offers
 * the choice, the relay is the one that must not take its word for it.
 *
 * @param {unknown} raw the colours asked for, or nothing
 * @param {number} places how many bombers the arena seats
 * @returns {number[]} one colour index per place, all different
 */
export function cleanColours(raw, places) {
  const wanted = Array.isArray(raw) ? raw : [];
  const taken = new Set();
  const table = Array.from({ length: places }, (_, place) => {
    const colour = asColour(wanted[place]);
    if (colour === null || taken.has(colour)) return null;
    taken.add(colour);
    return colour;
  });

  // The places left without a colour take those nobody asked for, in order.
  let spare = 0;
  for (let place = 0; place < places; place += 1) {
    if (table[place] !== null) continue;
    while (taken.has(spare)) spare += 1;
    table[place] = spare;
    taken.add(spare);
  }
  return table;
}

/**
 * Gives a place the colour its player prefers, when it can be had.
 *
 * A COLOUR IS A HABIT. Someone who always plays red looks for red in the scrum,
 * and the options let them say so once instead of setting it before every game.
 * But a room has one list of colours for everybody — that is what keeps two
 * screens showing the same arena — so a preference is a REQUEST, granted or
 * not, and never a private setting.
 *
 * It is granted by EXCHANGE: the two places swap, so the list stays without a
 * duplicate and without a hole. And it is refused flat when a human already
 * wears the colour: they were there first, they have their own habits, and
 * taking it from them would move the bearings of somebody who is already
 * playing. A bot holding it, on the other hand, gives way without a word — it
 * does not look for itself on the board.
 *
 * Pure, and shared with the relay, which is the only one entitled to apply it:
 * what a client prefers it asks for, it does not decide.
 *
 * @param {number[]} colours the room's colours, one per place
 * @param {number} place the place that is asking
 * @param {unknown} wanted the colour index asked for, straight off the wire
 * @param {(place: number) => boolean} human says whether a place is held by a
 *   player — a bot, or nobody yet, gives way
 * @returns {number[]} the colours after the exchange, or the very same list
 */
export function preferColour(colours, place, wanted, human) {
  const colour = asColour(wanted);
  if (colour === null) return colours;
  if (!Number.isInteger(place) || place < 0 || place >= colours.length) return colours;
  if (colours[place] === colour) return colours;

  const holder = colours.indexOf(colour);
  const next = colours.slice();
  // Nobody in this room wears it — a room of four does not show the ten
  // colours — so there is nothing to exchange: the place simply changes colour.
  if (holder === -1) {
    next[place] = colour;
    return next;
  }
  if (human(holder)) return colours;
  next[holder] = colours[place];
  next[place] = colour;
  return next;
}

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
