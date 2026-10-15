/**
 * Online transport: intents go out, the arena comes back.
 *
 * It returns exactly what `createLocalTransport` returns — `start`, `intent`,
 * `beat`, the subscriptions — so that `start()` in main.js does not know which
 * of the two it is plugging in. That is the whole point of having laid down that
 * contract before writing the network code: the renderer, the keyboard, the
 * gamepads, the sound and the dashboard do not have a line to change.
 *
 * `beat` DOES NOTHING here, and that is the only visible difference between the
 * two worlds. In solo play the page runs the engine; online it is the relay, and
 * the page only has to receive. It simulates nothing, corrects nothing, predicts
 * nothing: it displays the last state received.
 *
 * THAT CHOICE HAS A PRICE, and it has to be said. Without local prediction,
 * pressing a key and seeing the bomber move takes a round trip — twenty to
 * eighty milliseconds depending on the distance to the relay. Predicting would
 * have meant replaying the local state on every server correction, hence
 * reconciling two simulations that diverge; that is another project, and another
 * class of bug. On a grid where you move one cell in ten steps, the delay is
 * felt without getting in the way: we prefer it to a bomber teleporting
 * backwards.
 */

import { EMPTY_INPUT } from '../engine/inputs.js';
import { createState } from '../engine/state.js';
import { createMatch } from '../engine/round.js';
import { index, inArena } from '../engine/grid.js';
import { EMPTY } from '../engine/constants.js';
import { BONUS_NAMES } from '../engine/bonus.js';
import { CLIENT, SERVER, encode, decode, RESUME_MS } from './protocol.js';

/** Network name of a bonus to its code, to read the relay's events back. */
const CODE_BY_NAME = Object.fromEntries(
  Object.entries(BONUS_NAMES).map(([code, name]) => [name, Number(code)]),
);

/** Past this, we stop reconnecting: the relay is not coming back. */
const MAX_RECONNECTS = 6;

/** Wait before another attempt, in milliseconds. */
const WAITS = [250, 500, 1000, 2000, 4000, 8000];

/**
 * Updates a grid from the relay's events.
 *
 * It is the indispensable half of the choice not to broadcast the grid thirty
 * times a second: the relay only sends what CHANGES, and the client therefore
 * has to apply those changes itself.
 *
 * Without it, a bonus picked up stayed drawn on the ground for ever. The version
 * counter would not have caught it: it only counts writes to TILES, and picking
 * a bonus up only touches the item array. A destroyed brick, on the other hand,
 * did move the version — which is why bonuses APPEARED correctly while never
 * disappearing.
 *
 * It is pure and exported for that reason: it is a rule, not plumbing, and a
 * rule is checked without opening a WebSocket.
 *
 * @param {{ tiles: Uint8Array, items: Uint8Array }} state
 * @param {unknown[][]} list the step's events
 * @returns {number} number of TILE writes, to keep up with the relay's version
 */
export function followGrid(state, list) {
  let tilesWritten = 0;
  for (const [name, cx, cy, ...rest] of list) {
    // `inArena` and not a mere bound on the index: the events come off the
    // network, and a negative abscissa falls inside the array while naming
    // ANOTHER cell — we would write at random instead of refusing.
    if (!inArena(cx, cy)) continue;
    const i = index(cx, cy);
    // `brick` announces that a brick is FALLING: it still blocks, and only its
    // animation starts. It is `brickgone` that opens the cell, some twenty steps
    // later. Confusing the two made the way passable before the relay opened it,
    // and the bomber had its input refused by the server after having seen
    // itself walk in.
    if (name === 'brickgone') {
      state.tiles[i] = EMPTY;
      tilesWritten += 1;
    } else if (name === 'item') {
      state.items[i] = CODE_BY_NAME[rest[0]] ?? 0;
    } else if (name === 'itemgone' || name === 'pick') {
      state.items[i] = 0;
    }
  }
  return tilesWritten;
}

/**
 * @param {{
 *   url: string, room: string, nickname: string, places?: number, format?: number,
 *   bots?: number[], colours?: number[] | null, colour?: number | null, host?: boolean
 * }} options
 */
export function createOnlineTransport({
  url, room, nickname, places = 2, format = 3, bots = [], colours = null, colour = null,
  host = false,
}) {
  const views = new Set();
  const events = new Set();
  const transitions = new Set();
  const netStates = new Set();
  const rooms = new Set();

  /** The arena as the page knows it, rebuilt from the wire. */
  let state = null;
  let match = null;
  let myId = null;
  let mine = [];
  let socket = null;
  let closed = false;
  let attempts = 0;
  let sequence = 0;
  /** Last intent sent, so as not to repeat what the relay already knows. */
  let last = null;
  /** Version number of the grid, to spot that it has drifted. */
  let version = -1;
  /** True once the bots asked for at creation have been requested. */
  let botsSeated = false;

  let resolveStart = null;
  let started = false;
  const startPromise = new Promise((resolve) => {
    resolveStart = resolve;
  });

  const broadcast = (set, ...args) => {
    for (const subscriber of set) subscriber(...args);
  };
  const say = (message) => broadcast(netStates, message ? { message } : null);

  /** Sends if the socket is open; otherwise drops it, the next one says all. */
  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(encode(message));
  }

  /**
   * Rebuilds the state the scene expects, from a snapshot.
   *
   * We do not recreate the object on every frame: the grid and the items are not
   * in it, and copying them thirty times a second for nothing would cost more
   * than all the rest of the rendering. We write INTO the existing state.
   */
  function apply(snapshot) {
    if (!state) return;
    state.step = snapshot.t;

    for (const j of snapshot.j) {
      const player = state.players[j.p];
      if (!player) continue;
      player.x = j.x;
      player.y = j.y;
      player.dir = j.d;
      player.walking = j.m === 1;
      player.alive = j.e === 1;
      // The step of the death, which drives the whole falling animation. Without
      // it, the renderer stays on its first frame: a frozen corpse, arms up.
      player.diedAt = j.o ?? null;
      player.absent = j.a === 1;
      player.bombs = j.b;
      player.range = j.f;
      player.speed = j.s;
      player.kick = j.k === 1;
      player.triggers = j.g;
      player.glove = j.n === 1;
      player.jelly = j.l === 1;
      player.grab = j.r === 1;
      player.punchedAt = j.u ?? null;
    }

    state.bombs = snapshot.b.map((b) => ({
      id: b.i,
      cx: b.x,
      cy: b.y,
      fuse: b.m,
      place: b.p,
      range: 0,
      slide: b.g ? { dir: b.g.d, x: b.g.x, y: b.g.y } : null,
      held: b.c ?? null,
      flight: b.w ? { fromX: b.w.x, fromY: b.w.y, left: b.w.r, duration: b.w.d, dir: b.w.s } : null,
    }));

    state.flames = snapshot.f.map((f) => ({ cx: f.x, cy: f.y, left: f.r, place: f.p }));

    // The grid has moved without our hearing about it: we ask for it to be sent
    // again, rather than drawing an arena that no longer exists.
    if (snapshot.v !== version) {
      version = snapshot.v;
      send({ type: CLIENT.RESYNC, v: version });
    }

    broadcast(views, state, match);
  }

  /** Installs a whole grid, received at the start of a round or on request. */
  function setGrid(message) {
    state.tiles = Uint8Array.from(message.tiles);
    state.items = Uint8Array.from(message.items);
    version = message.v;
    broadcast(views, state, match);
  }

  function receive(message) {
    if (message.type === SERVER.WAITING) {
      // THE BOTS ARE SEATED HERE, and only on the first waiting message: it is
      // the relay's acknowledgement that our own seat is taken, and asking for a
      // bot before that would seat it in our place. Every later message —
      // somebody else arriving — must leave the room alone, hence the flag.
      if (!botsSeated) {
        botsSeated = true;
        for (const seat of bots) send({ type: CLIENT.BOT, seat });
      }
      // The waiting room needs the LIST, not a sentence: who is already here,
      // and how many seats are still empty.
      broadcast(rooms, {
        code: message.room,
        seated: message.places,
        total: message.max,
        names: message.names ?? [],
        // The colours of the room, as the relay settled them. The waiting room
        // shows them: whoever joins chose nothing, and they would otherwise
        // discover which bomber is theirs at the first round.
        colours: message.colours ?? null,
        // Only the host is offered the start: the relay says who it is, since it
        // is the only one that knows who opened the room.
        host: message.host === true,
        hosted: message.hosted === true,
      });
      return;
    }

    if (message.type === SERVER.START) {
      myId = message.myId;
      mine = message.mine ?? [];
      state = createState({ seed: 1, places: message.places });
      match = createMatch({ places: message.places, total: message.format });
      say('');
      if (!started) {
        started = true;
        resolveStart({
          places: message.places,
          format: message.format,
          mine,
          names: message.names ?? null,
          // THE RELAY'S COLOURS AND NOT OURS, even for the host who picked
          // them: it is the room that holds the table, it has cleaned up the
          // list, and a guest has nothing else to go on. One source, so all the
          // screens draw the same arena.
          colours: message.colours ?? null,
        });
      }
      return;
    }

    if (message.type === SERVER.ROUND) {
      if (!state) return;
      setGrid(message);
      // The bombs and flames from before have no reason to exist any more.
      state.bombs = [];
      state.flames = [];
      if (message.wait > 0) {
        broadcast(transitions, {
          type: 'round',
          round: message.round,
          wait: message.wait,
        });
      }
      return;
    }

    if (message.type === SERVER.ARENA) {
      if (state) setGrid(message);
      return;
    }

    if (message.type === SERVER.STATE) {
      apply(message);
      return;
    }

    if (message.type === SERVER.EVENTS) {
      // The relay counts one version per tile write: we advance by the same
      // step, otherwise every broken brick would trigger a resynchronisation —
      // the whole grid on the wire, for one cell we have just learnt about.
      if (state) version += followGrid(state, message.e);
      broadcast(events, message.e, message.t);
      return;
    }

    if (message.type === SERVER.SCORE) {
      if (match) match.scores = message.scores.slice();
      broadcast(transitions, {
        type: 'score',
        verdict: message.verdict,
        scores: message.scores,
        round: message.round,
      });
      return;
    }

    if (message.type === SERVER.FINISHED) {
      if (match) match.scores = message.scores.slice();
      broadcast(transitions, {
        type: 'finished',
        winner: message.winner,
        scores: message.scores,
      });
      return;
    }

    if (message.type === SERVER.AWAY) {
      say(`Un joueur s'est déconnecté — ${message.seconds} s to revenir`);
      return;
    }

    if (message.type === SERVER.BACK) {
      say('');
      return;
    }

    if (message.type === SERVER.LEFT) {
      say('Un joueur a quitté la partie');
      return;
    }

    if (message.type === SERVER.ERROR) {
      say(message.message);
      // It goes to the waiting room AS WELL. As long as the game has not
      // started, that is the only screen shown — and `onNetState` is only
      // subscribed to once the game is formed, which will never happen if the
      // relay refuses. Without that second path, the player stayed in front of a
      // silent waiting room, wondering what was going on.
      broadcast(rooms, { error: message.message });
    }
  }

  /**
   * Opens the socket, and reopens it should it drop.
   *
   * A connection giving way is not a lost game: the relay keeps the place for
   * thirty seconds. So we come back with `resume`, which asks to take the seat
   * again rather than to be given a new one.
   */
  function connect() {
    if (closed) return;
    const address = `${url}?room=${encodeURIComponent(room)}`;
    socket = new WebSocket(address);

    socket.addEventListener('open', () => {
      attempts = 0;
      // The relay no longer knows what we wanted: the next intent must go out
      // even if it has not changed since the cut.
      last = null;
      send({
        type: CLIENT.JOIN,
        room,
        name: nickname,
        places,
        format,
        // The colours are part of laying the table, so they travel with it. The
        // relay only listens to the first arrival, and ignores them from a guest
        // — who sends none anyway.
        colours: colours ?? undefined,
        // The colour one PREFERS, which is not the same thing as the list
        // above: a guest lays out nothing, they ask the room for a colour. The
        // relay grants it by exchange, or refuses it to leave another player
        // their bearings.
        colour: colour ?? undefined,
        // LAYING THE TABLE IS SAID ON ARRIVAL, and it is the only difference
        // between creating and joining as far as the relay is concerned: the
        // room then waits for this player's signal instead of setting off on
        // its own once full.
        host: host ? true : undefined,
        resume: myId ?? undefined,
      });
    });

    socket.addEventListener('message', (event) => {
      const message = decode(event.data);
      if (message) receive(message);
    });

    socket.addEventListener('close', () => {
      if (closed) return;
      if (attempts >= MAX_RECONNECTS) {
        say('Connexion au relais perdue.');
        return;
      }
      const wait = WAITS[Math.min(attempts, WAITS.length - 1)];
      attempts += 1;
      say(`Reconnexion… (${attempts})`);
      setTimeout(connect, wait);
    });

    socket.addEventListener('error', () => {
      // `close` always follows: reconnection is handled in one place only.
    });
  }

  return {
    async start() {
      connect();
      return startPromise;
    },

    /**
     * Pushes an intent towards the relay.
     *
     * The sequence number grows on every send: the relay ignores whatever
     * arrives late, which happens as soon as one packet overtakes another.
     */
    intent(place, input) {
      if (!mine.includes(place)) return;
      const useful = input ?? EMPTY_INPUT;

      // WE ONLY SEND WHAT CHANGES. The render loop calls this sixty times a
      // second, and the direction stays the same for dozens of frames:
      // repeating "I am still going right" takes up the wire and makes the relay
      // work for nothing. A pulse, on the other hand, always goes out — it is
      // only worth once, and keeping quiet about it would lose a bomb.
      // The bomb key being HELD is a state like the direction, so it travels the
      // same way: on change only. Missing a release would leave a bomb in the
      // hands for ever; sending it sixty times a second would say the same thing
      // sixty times.
      const pulse = useful.drop || useful.detonate;
      const held = useful.hold === true;
      if (!pulse && last !== null && last.dir === useful.dir && last.hold === held) return;
      last = { dir: useful.dir, hold: held };

      sequence += 1;
      send({
        type: CLIENT.INPUT,
        seat: place,
        seq: sequence,
        dir: useful.dir,
        bomb: useful.drop,
        det: useful.detonate,
        hold: held,
      });
    },

    /**
     * Starts the game without waiting for the room to fill.
     *
     * THE HOST ALONE, and the relay checks it: the room belongs to whoever
     * opened it. The places left empty go to bots, so a fourth who never comes
     * does not hold the game up.
     */
    begin() {
      send({ type: CLIENT.BEGIN });
    },

    /** Time belongs to the relay: the page simulates nothing. */
    beat() {},

    onView(f) {
      views.add(f);
      return () => views.delete(f);
    },

    onEvents(f) {
      events.add(f);
      return () => events.delete(f);
    },

    onTransition(f) {
      transitions.add(f);
      return () => transitions.delete(f);
    },

    onNetState(f) {
      netStates.add(f);
      return () => netStates.delete(f);
    },

    /** Who is waiting in the room, and how many places are left. */
    onRoom(f) {
      rooms.add(f);
      return () => rooms.delete(f);
    },

    close() {
      closed = true;
      send({ type: CLIENT.LEAVE });
      if (socket) socket.close();
      views.clear();
      events.clear();
      transitions.clear();
      netStates.clear();
      rooms.clear();
    },

    /** Reserved for debugging: how much time is left to come back. */
    get resumeMs() {
      return RESUME_MS;
    },
  };
}
