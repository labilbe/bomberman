/**
 * A room: the shared arena, its players, and the rules of their coming and
 * going.
 *
 * THIS MODULE KNOWS NOTHING OF WEBSOCKETS. It receives messages already decoded
 * and returns OUTGOING messages — "this message, to that one" — which the caller
 * hands out. It is the same stance as for the keyboard, which is given its
 * target, and for the gamepads, which are given their probe: the logic is tested
 * in Node, with no platform, and that is what lets us check situations a real
 * game only produces one time in a hundred — two players disconnecting on the
 * same step, a return in the last second, a room emptying mid-round.
 *
 * THE RELAY IS AUTHORITATIVE. Clients only send intents; it is here that
 * `stepGame` runs, and the state broadcast is the only true one. A client lying
 * about its position would not be believed, since it is not asked for its
 * position. That is also why the engine has been pure and DOM-free from the
 * start: it runs here as it is, with no adaptation.
 *
 * What the room does NOT do: keep a game in memory after the last player
 * leaves. An empty room closes, and its code becomes free again.
 */

import { createGame, stepGame, frozen } from '../src/engine/game.js';
import { createClock, advance } from '../src/engine/clock.js';
import { createPilot } from '../src/ai/pilot.js';
import { randomSeed } from '../src/engine/rng.js';
import { EMPTY_INPUT, normalise } from '../src/engine/inputs.js';
import { kill, BY_START, BY_LEAVING } from '../src/engine/explosion.js';
import { FORMATS } from '../src/engine/round.js';
import { TICK_HZ, STEP_HZ } from '../src/engine/constants.js';
import {
  SERVER,
  CLIENT,
  MIN_PLACES,
  MAX_PLACES,
  RESUME_MS,
  cleanName,
  botNames,
} from '../src/net/protocol.js';

/** One snapshot per tick: the engine's rate, so every frame has its position. */
const STEPS_PER_TICK = Math.round(STEP_HZ / TICK_HZ);

/** Levels of the artificial opponents, in the order they are added. */
const LEVELS = ['quiet', 'normal', 'nasty'];

/**
 * Packs a view of the arena for the wire.
 *
 * The names are short on purpose: this object goes out sixty times a second and
 * per player. `j` for players, `b` for bombs, `f` for flames — it is written in
 * the protocol, and it is the only place in the project where we abbreviate.
 *
 * The GRID is not in it. It only changes when a brick is destroyed, so sending
 * it on every step would be pure waste: the client receives it whole at every
 * round, updates it from the events, and asks for it again if its version no
 * longer matches.
 */
function snapshot(state, away) {
  return {
    t: state.step,
    v: state.version,
    j: state.players.map((player) => ({
      p: player.place,
      x: player.x,
      y: player.y,
      d: player.dir,
      m: player.walking ? 1 : 0,
      e: player.alive ? 1 : 0,
      // The STEP of the death, and not a plain "it is dead": the renderer plays
      // the fall frame by frame from that date. Without it, the client stayed on
      // the first frame — arms up — for ever.
      o: player.diedAt,
      // Disconnected, but not eliminated yet: the scene greys it out, otherwise
      // the others take it for a motionless bomber lying in wait for them.
      a: away.has(player.place) ? 1 : 0,
      b: player.bombs,
      f: player.range,
      s: player.speed,
      k: player.kick ? 1 : 0,
      g: player.triggers,
      // The glove. Without it, the client did not know it had picked it up: the
      // HUD did not show it, and the intent sent to the room was that of
      // somebody who does not have the bonus.
      n: player.glove ? 1 : 0,
      // The jelly: it changes nothing in the drawing, but the HUD shows it, and
      // without it the player does not know why their bombs set off again.
      l: player.jelly ? 1 : 0,
      // The blue glove, for the HUD — what it carries is read off the bomb.
      r: player.grab ? 1 : 0,
      // And the STEP of its last punch, as for the death: the renderer plays the
      // gesture from that date.
      u: player.punchedAt,
    })),
    b: state.bombs.map((bomb) => ({
      i: bomb.id,
      x: bomb.cx,
      y: bomb.cy,
      m: bomb.fuse,
      p: bomb.place,
      g: bomb.slide ? { d: bomb.slide.dir, x: bomb.slide.x, y: bomb.slide.y } : null,
      // Who is carrying it, or null. The scene draws it above their head instead
      // of on the ground, and that is the only way it can tell: its coordinates
      // are the carrier's own square.
      c: bomb.held,
      // The glove's flight: where it sets off from, and where it stands. Without
      // it, the punched bomb would teleport from one end of its trajectory to
      // the other.
      w: bomb.flight
        // The DIRECTION is in it, and not only the start: a bomb that leaves the
        // screen comes back from the opposite edge, and the renderer can no
        // longer deduce it from the start-to-arrival segment.
        ? { x: bomb.flight.fromX, y: bomb.flight.fromY, r: bomb.flight.left, d: bomb.flight.duration, s: bomb.flight.dir }
        : null,
    })),
    f: state.flames.map((flame) => ({
      x: flame.cx,
      y: flame.cy,
      r: flame.left,
      p: flame.place,
    })),
  };
}

/** The whole grid, for the start of a round or a resynchronisation. */
const gridOf = (state) => ({
  v: state.version,
  tiles: Array.from(state.tiles),
  items: Array.from(state.items),
});

/**
 * Creates an empty room.
 *
 * @param {{ code: string, now: number, seed?: number }} options
 */
export function createRoom({ code, now, seed = randomSeed() }) {
  /** @type {Map<string, { id: string, name: string, place: number|null, present: boolean, leftAt: number|null }>} */
  const members = new Map();
  /** Pilots of the places held by a bot, indexed by place. */
  const pilots = {};
  /** Last known intent of each place, consumed on every step. */
  const intents = [];
  /** Number of the last intent message accepted, per place: order counts. */
  const sequences = [];

  let game = null;
  let clock = null;
  let places = MIN_PLACES;
  let format = FORMATS[0];
  let counter = 0;
  /**
   * Who lays the table: the first to arrive, and they alone give the signal.
   *
   * THE ROOM BELONGS TO WHOEVER OPENED IT. They are the one who knows who is
   * still coming, and starting as soon as the last seat is filled took that
   * decision away from them — a friend arriving set the game off in their face.
   *
   * It is passed on rather than held: if the host leaves, the oldest of those
   * left takes over, failing which a room would survive its creator with nobody
   * able to start it.
   */
  let hostId = null;

  const outgoing = [];
  const toAll = (message) => outgoing.push({ to: null, message });
  const toOne = (id, message) => outgoing.push({ to: id, message });
  const clear = () => outgoing.splice(0, outgoing.length);

  /** The places whose player is disconnected but not eliminated yet. */
  function awayPlaces() {
    const away = new Set();
    for (const member of members.values()) {
      if (!member.present && member.place !== null) away.add(member.place);
    }
    return away;
  }

  /** The humans present, in the order of their place. */
  const humans = () => [...members.values()].filter((m) => m.place !== null);

  /** First names given to the bots, per place. */
  const botNameByPlace = {};

  /**
   * The names shown, per place: humans and bots alike.
   *
   * A place still free is `null`, and not "Place 3". The waiting room needs to
   * tell the two apart to show who is missing; a filler label would have shown
   * it as a player already seated.
   */
  function names() {
    const list = Array.from({ length: places }, () => null);
    for (const member of humans()) list[member.place] = member.name;
    for (const [place, name] of Object.entries(botNameByPlace)) list[place] = name;
    return list;
  }

  /**
   * Seats a bot, with a first name no other one has.
   *
   * Two bots with the same name would make the scoreboard illegible, and the
   * offset by the round counter keeps two games in a row from lining up exactly
   * the same opponents.
   *
   * The ASKED-FOR PLACE is honoured when it is free: whoever creates the room
   * says which seats are bots and which await a human, and a place is a corner
   * and a colour — seating the bot elsewhere would show a board that is not the
   * one they laid out. Anything else — a taken place, a number out of range, the
   * room filling itself at the start — falls back on the first free place.
   */
  function addBot(wanted = null) {
    const free = freePlace();
    const place = Number.isInteger(wanted) && wanted >= 0 && wanted < places && !taken().has(wanted)
      ? wanted
      : free;
    if (place === null) return false;
    const rank = Object.keys(pilots).length;
    pilots[place] = createPilot({ level: LEVELS[rank % LEVELS.length] });
    botNameByPlace[place] = botNames(rank + 1, counter)[rank];
    return true;
  }

  /** The places already held, by a human or by a bot. */
  function taken() {
    return new Set([...humans().map((m) => m.place), ...Object.keys(pilots).map(Number)]);
  }

  /** The first free place, or null when the room is full. */
  function freePlace() {
    const held = taken();
    for (let place = 0; place < places; place += 1) if (!held.has(place)) return place;
    return null;
  }

  const full = () => freePlace() === null;

  /** Keeps the host if they are still there, otherwise the oldest member. */
  function passHost() {
    if (hostId !== null && members.has(hostId)) return;
    hostId = members.keys().next().value ?? null;
  }

  /**
   * One waiting message PER MEMBER, where the room broadcasts everything else:
   * each one has to be told whether it is up to them to start, and in the
   * waiting room a client does not know its own id yet — it only learns it with
   * the start.
   */
  function announceWaiting() {
    passHost();
    const seated = humans().length + Object.keys(pilots).length;
    for (const member of members.values()) {
      toOne(member.id, {
        type: SERVER.WAITING,
        room: code,
        places: seated,
        min: MIN_PLACES,
        max: places,
        names: names(),
        host: member.id === hostId,
      });
    }
  }

  /**
   * Starts the game.
   *
   * Empty places are filled by bots: a half-populated arena plays badly, and
   * nobody wants to wait for a fourth to arrive.
   */
  function start(nowMs) {
    while (addBot());

    game = createGame({ seed, places, format });
    clock = createClock(nowMs);
    intents.length = 0;
    sequences.length = 0;
    for (let place = 0; place < places; place += 1) {
      intents[place] = { ...EMPTY_INPUT };
      sequences[place] = -1;
    }

    for (const member of humans()) {
      toOne(member.id, {
        type: SERVER.START,
        room: code,
        myId: member.id,
        mine: [member.place],
        places,
        format: game.format,
        names: names(),
      });
    }
    toAll({ type: SERVER.ROUND, round: game.round, seed: game.state.seed, wait: game.start, ...gridOf(game.state) });
  }

  /**
   * Puts the room back in the waiting room, the match over.
   *
   * The humans keep their seat; the bots leave, since the next start will count
   * them again according to who is there. The room becomes what it was before
   * the first game, and its code serves again.
   */
  function reopen() {
    game = null;
    clock = null;
    for (const place of Object.keys(pilots)) {
      delete pilots[place];
      delete botNameByPlace[place];
    }
    intents.length = 0;
    sequences.length = 0;
  }

  /** The step's inputs: humans as they are, bots computed on the spot. */
  function stepInputs() {
    const inputs = [];
    for (let place = 0; place < places; place += 1) {
      const pilot = pilots[place];
      if (pilot) {
        inputs[place] = pilot(game.state, place);
        continue;
      }
      const wanted = intents[place] ?? EMPTY_INPUT;
      inputs[place] = { ...wanted };
      wanted.drop = false;
      wanted.detonate = false;
    }
    return inputs;
  }

  /**
   * Eliminates a player who has been away for too long.
   *
   * We do not eliminate on the cut: Wi-Fi hiccups, a phone changes cell. But
   * neither do we let the others wait for ever — the game goes on during the
   * absence, and their bomber simply stays motionless.
   */
  function checkAway(nowMs) {
    for (const member of members.values()) {
      if (member.present || member.leftAt === null || member.place === null) continue;
      if (nowMs - member.leftAt < RESUME_MS) continue;
      if (game && !game.over) {
        const player = game.state.players.find((j) => j.place === member.place);
        if (player) kill(game.state, player, BY_LEAVING);
      }
      toAll({ type: SERVER.LEFT, place: member.place });
      members.delete(member.id);
    }
  }

  return {
    get code() {
      return code;
    },

    /** Is anybody still here? An empty room closes. */
    get alive() {
      return members.size > 0;
    },

    /** Has the game started? */
    get started() {
      return game !== null;
    },

    /**
     * A client turns up.
     *
     * @returns {{ to: string|null, message: object }[]}
     */
    join(id, message, nowMs = now) {
      clear();

      // A resume: the player comes back to their place, the game has not moved.
      const resumed = message.resume ? members.get(String(message.resume)) : null;
      if (resumed && !resumed.present) {
        resumed.present = true;
        resumed.leftAt = null;
        members.delete(resumed.id);
        resumed.id = id;
        members.set(id, resumed);
        toAll({ type: SERVER.BACK, place: resumed.place });
        if (game) {
          toOne(id, {
            type: SERVER.START,
            room: code,
            myId: id,
            mine: [resumed.place],
            places,
            format: game.format,
            names: names(),
          });
          toOne(id, {
            type: SERVER.ROUND,
            round: game.round,
            seed: game.state.seed,
            wait: 0,
            ...gridOf(game.state),
          });
        }
        return outgoing.slice();
      }

      // A FINISHED match no longer holds the room: we reopen it, and the code
      // stays usable. Without that, playing once in a room condemned it — and
      // since the page keeps the last code, there was no starting again.
      if (game && game.over) reopen();

      if (game) {
        toOne(id, { type: SERVER.ERROR, message: 'Une partie est en cours dans ce salon.' });
        return outgoing.slice();
      }

      // The first to arrive sets the room's format: the others join it as it is,
      // rather than see it change before their eyes.
      if (members.size === 0) {
        places = Math.min(MAX_PLACES, Math.max(MIN_PLACES, Number(message.places) || MIN_PLACES));
        format = FORMATS.includes(Number(message.format)) ? Number(message.format) : FORMATS[0];
      }

      const place = freePlace();
      if (place === null) {
        toOne(id, { type: SERVER.ERROR, message: 'Ce salon est full.' });
        return outgoing.slice();
      }

      members.set(id, {
        id,
        name: cleanName(message.name),
        place,
        present: true,
        leftAt: null,
      });

      // NOT A WORD ABOUT STARTING, even when the last seat has just been taken:
      // it is the host who gives the signal, and an arrival is not a signal.
      announceWaiting();
      return outgoing.slice();
    },

    /** Any message from a client already known. */
    message(id, message, nowMs = now) {
      clear();
      const member = members.get(id);
      if (!member) return outgoing.slice();

      if (message.type === CLIENT.BEGIN) {
        if (game) return outgoing.slice();
        if (humans().length < 1) return outgoing.slice();
        // The signal belongs to the host. A guest's click is ignored in silence
        // rather than refused: their screen does not even offer the button, so
        // such a message is a stale page, not a mistake to report.
        passHost();
        if (id !== hostId) return outgoing.slice();
        start(nowMs);
        return outgoing.slice();
      }

      if (message.type === CLIENT.BOT) {
        if (game) return outgoing.slice();
        // Seating the bots is laying the table, and the table is the host's: a
        // guest cannot fill a seat somebody is on their way to.
        passHost();
        if (id !== hostId) return outgoing.slice();
        const wanted = Number(message.seat);
        if (!addBot(Number.isInteger(wanted) ? wanted : null)) return outgoing.slice();
        announceWaiting();
        if (full()) start(nowMs);
        return outgoing.slice();
      }

      if (message.type === CLIENT.INPUT) {
        if (!game || member.place === null) return outgoing.slice();
        // Intents can overtake each other on the wire: we ignore those that
        // arrive late rather than go backwards.
        const seq = Number(message.seq);
        if (!Number.isFinite(seq) || seq <= sequences[member.place]) return outgoing.slice();
        sequences[member.place] = seq;
        const input = normalise({
          dir: message.dir,
          drop: message.bomb,
          detonate: message.det,
          hold: message.hold,
        });
        const wanted = intents[member.place];
        intents[member.place] = {
          dir: input.dir,
          // A waiting pulse is not lost if two messages arrive between two
          // simulation steps.
          drop: wanted.drop || input.drop,
          detonate: wanted.detonate || input.detonate,
          // The held key, on the other hand, REPLACES what was known: it is a
          // state, and keeping the old one would hold a bomb the player has let
          // go of.
          hold: input.hold,
        };
        return outgoing.slice();
      }

      if (message.type === CLIENT.RESYNC) {
        if (game) toOne(id, { type: SERVER.ARENA, ...gridOf(game.state) });
        return outgoing.slice();
      }

      if (message.type === CLIENT.LEAVE) {
        return this.leave(id, nowMs, { voluntary: true });
      }

      return outgoing.slice();
    },

    /**
     * A client leaves, or their connection drops.
     *
     * The nuance counts: a voluntary departure eliminates at once, a cut leaves
     * thirty seconds to come back.
     */
    leave(id, nowMs = now, { voluntary = false } = {}) {
      clear();
      const member = members.get(id);
      if (!member) return outgoing.slice();

      if (!game) {
        members.delete(id);
        if (members.size > 0) announceWaiting();
        return outgoing.slice();
      }

      if (voluntary) {
        const player = game.state.players.find((j) => j.place === member.place);
        if (player && !game.over) kill(game.state, player, BY_START);
        toAll({ type: SERVER.LEFT, place: member.place });
        members.delete(id);
        return outgoing.slice();
      }

      member.present = false;
      member.leftAt = nowMs;
      toAll({
        type: SERVER.AWAY,
        place: member.place,
        seconds: Math.round(RESUME_MS / 1000),
      });
      return outgoing.slice();
    },

    /**
     * Advances time, and returns what needs broadcasting.
     *
     * This is where `stepGame` runs, exactly as in the page in solo play: same
     * engine, same chaining of rounds, same end-of-match rules.
     */
    beat(nowMs) {
      clear();
      checkAway(nowMs);
      if (!game || game.over) return outgoing.slice();

      const tick = advance(clock, nowMs);
      clock = tick.clock;

      const events = [];
      for (let i = 0; i < tick.steps; i += 1) {
        const result = stepGame(game, stepInputs());
        if (result.events.length > 0) {
          for (const event of result.events) events.push(event);
        }
        if (result.transition) {
          const transition = result.transition;
          if (transition.type === 'round') {
            counter += 1;
            toAll({ type: SERVER.ROUND, ...transition, ...gridOf(game.state) });
          } else if (transition.type === 'score') {
            toAll({ type: SERVER.SCORE, ...transition });
          } else if (transition.type === 'finished') {
            toAll({ type: SERVER.FINISHED, ...transition });
          }
        }
      }

      if (events.length > 0) {
        toAll({ type: SERVER.EVENTS, t: game.state.step, e: events });
      }

      // The snapshot only goes out every other step, and never while the arena
      // is frozen: nothing moves in it, there is nothing to say.
      if (tick.steps > 0 && !frozen(game) && game.state.step % STEPS_PER_TICK === 0) {
        toAll({ type: SERVER.STATE, ...snapshot(game.state, awayPlaces()) });
      }

      return outgoing.slice();
    },

    /** Reserved for the tests: the relay's live state. */
    get game() {
      return game;
    },
  };
}
