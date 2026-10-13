/**
 * The relay, on the Cloudflare side: plumbing, and nothing else.
 *
 * Everything that is a RULE lives in `room.js`, which knows neither WebSocket
 * nor Durable Object and is therefore tested in Node. This file only does three
 * things: route a connection to the room of its code, turn frames into messages,
 * and beat time. If a game misbehaves, this is almost never where to look.
 *
 * ONE ROOM = ONE DURABLE OBJECT. That is what makes the shared arena possible:
 * ordinary Workers have no memory and are spread over the whole planet, two
 * players of the same room would land on two different instances and each play
 * on their own. A Durable Object, on the other hand, is unique for a given name
 * — the room's code — and holds the game in memory.
 *
 * The room code is NORMALISED before the object is named, by the same function
 * the page uses: failing which "essai" and "ESSAI" would be two different games,
 * and two friends reading a code out to each other would never meet.
 */

import { createRoom } from './room.js';
import { STEP_HZ } from '../src/engine/constants.js';
import { encode, decode, CLIENT, cleanRoom } from '../src/net/protocol.js';

/** Period of the beat, in milliseconds. The room catches up when it falls behind. */
const BEAT_MS = Math.round(1000 / STEP_HZ);

/** A live room, with its connections. */
export class RoomObject {
  constructor(state) {
    this.state = state;
    this.room = null;
    /** @type {Map<string, WebSocket>} */
    this.sockets = new Map();
    this.beat = null;
  }

  /** Hands out messages: `to: null` means "to everybody". */
  broadcast(outgoing) {
    for (const { to, message } of outgoing) {
      const frame = encode(message);
      if (to === null) {
        for (const socket of this.sockets.values()) this.send(socket, frame);
        continue;
      }
      const socket = this.sockets.get(to);
      if (socket) this.send(socket, frame);
    }
  }

  /**
   * Sends, swallowing the failure.
   *
   * A socket can die between the moment we decide to write and the moment we
   * write. Letting the exception through would cut the broadcast to the other
   * players, for a reason that does not concern them.
   */
  send(socket, frame) {
    try {
      socket.send(frame);
    } catch {
      // The `close` that follows will do the tidying up.
    }
  }

  /**
   * Starts the beat, if it is not already beating.
   *
   * It only runs while somebody is connected. An empty room that kept simulating
   * would consume without end, and the Durable Object would never fall asleep.
   */
  startBeat() {
    if (this.beat !== null) return;
    this.beat = setInterval(() => {
      if (!this.room) return;
      this.broadcast(this.room.beat(Date.now()));
      if (!this.room.alive) this.stopBeat();
    }, BEAT_MS);
  }

  stopBeat() {
    if (this.beat === null) return;
    clearInterval(this.beat);
    this.beat = null;
    this.room = null;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Ce point d entrée attend une WebSocket.', { status: 426 });
    }

    const url = new URL(request.url);
    const code = cleanRoom(url.searchParams.get('room') ?? '');
    if (!code) return new Response('Code de salon manquant.', { status: 400 });

    if (!this.room) this.room = createRoom({ code, now: Date.now() });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const id = crypto.randomUUID();
    this.sockets.set(id, server);

    server.addEventListener('message', (event) => {
      const message = decode(event.data);
      if (!message || !this.room) return;
      const outgoing = message.type === CLIENT.JOIN
        ? this.room.join(id, message, Date.now())
        : this.room.message(id, message, Date.now());
      this.broadcast(outgoing);
      if (this.room.started) this.startBeat();
    });

    const close = () => {
      this.sockets.delete(id);
      if (!this.room) return;
      this.broadcast(this.room.leave(id, Date.now()));
      // Nobody left: we cut the beat without waiting for it to notice, so that
      // the object can fall asleep.
      if (this.sockets.size === 0) this.stopBeat();
    };
    server.addEventListener('close', close);
    server.addEventListener('error', close);

    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  /**
   * Routes a connection to the room of its code.
   *
   * `idFromName` is the keystone: two connections carrying the same code land on
   * the SAME object, wherever in the world they are.
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'Content-Type': 'text/plain' } });
    }

    if (url.pathname !== '/room') {
      return new Response('Relais Bomberman. Le jeu se connecte sur /room?room=CODE.', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const code = cleanRoom(url.searchParams.get('room') ?? '');
    if (!code) return new Response('Code de salon manquant.', { status: 400 });

    const id = env.ROOMS.idFromName(code);
    return env.ROOMS.get(id).fetch(request);
  },
};
