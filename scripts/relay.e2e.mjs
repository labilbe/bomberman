/**
 * End-to-end trial of the relay, against a real Worker.
 *
 *   npm run relay        # in one terminal
 *   npm run test:relay   # in another
 *
 * The tests in `test/room.test.js` check the room's RULES in Node, where
 * everything is a snapshot and time is a parameter. They say nothing about the
 * plumbing: routing by code, the uniqueness of the Durable Object, the
 * serialisation of frames, the real beat. That is what this script tries out,
 * and it cannot be an ordinary `node --test` test — it needs a running relay.
 *
 * Two clients connect to it, like two players, and we check that they land in
 * the SAME game and receive the same arena.
 */

import { CLIENT, SERVER, encode, decode } from '../src/net/protocol.js';

const BASE = process.env.RELAIS ?? 'ws://127.0.0.1:8787/room';
const ROOM = `E2E${Math.floor(Math.random() * 900 + 100)}`;

let failures = 0;

function check(condition, claim) {
  if (condition) {
    console.log(`  ok   ${claim}`);
    return;
  }
  failures += 1;
  console.error(`  ECHEC ${claim}`);
}

/** A test client: it keeps everything it receives, by type. */
function client(name) {
  const received = [];
  const socket = new WebSocket(`${BASE}?room=${ROOM}`);
  socket.addEventListener('message', (event) => {
    const message = decode(event.data);
    if (message) received.push(message);
  });

  return {
    name,
    socket,
    received,
    open: new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve);
      socket.addEventListener('error', () => reject(new Error(`${name} n a pas pu se connecter`)));
    }),
    send: (message) => socket.send(encode(message)),
    of: (type) => received.filter((m) => m.type === type),
    /** Waits for a message of a given type, or gives up. */
    await(type, msMax = 5000) {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const look = () => {
          const found = this.of(type)[0];
          if (found) return resolve(found);
          if (Date.now() - start > msMax) {
            return reject(new Error(`${name} n a jamais recu « ${type} »`));
          }
          return setTimeout(look, 25);
        };
        look();
      });
    },
  };
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

try {
  console.log(`relais : ${BASE}`);
  console.log(`salon  : ${ROOM}\n`);

  const alice = client('Alice');
  const bob = client('Bob');
  await Promise.all([alice.open, bob.open]);
  console.log('deux clients connectes');

  alice.send({ type: CLIENT.JOIN, room: ROOM, name: 'Alice', places: 2, format: 3 });
  const waiting = await alice.await(SERVER.WAITING);
  check(waiting.places === 1, 'le premier arrive est seul en attente');

  bob.send({ type: CLIENT.JOIN, room: ROOM, name: 'Bob', places: 2, format: 3 });

  const startAlice = await alice.await(SERVER.START);
  const startBob = await bob.await(SERVER.START);
  check(startAlice.places === 2, 'la partie demarre a deux');
  check(
    JSON.stringify(startAlice.mine) !== JSON.stringify(startBob.mine),
    'chacun recoit une place differente',
  );
  check(
    startAlice.names.includes('Alice') && startAlice.names.includes('Bob'),
    'chacun voit le nom de l autre',
  );

  const roundAlice = await alice.await(SERVER.ROUND);
  const roundBob = await bob.await(SERVER.ROUND);
  check(roundAlice.tiles.length === 195, 'la grille complete arrive');
  check(
    JSON.stringify(roundAlice.tiles) === JSON.stringify(roundBob.tiles),
    'les deux recoivent EXACTEMENT la meme arene',
  );

  // The start of a round freezes the arena for a second and a half: we let it
  // pass.
  console.log('on laisse la manche demarrer…');
  await wait(2500);

  const states = alice.of(SERVER.STATE);
  check(states.length > 10, `les instantanes arrivent (${states.length} recus)`);
  check(states[states.length - 1].j.length === 2, 'avec les deux bombers');

  // Alice walks to the right: her position has to change at BOB's end too, since
  // it is the relay that is authoritative.
  const before = bob.of(SERVER.STATE).at(-1).j.find((j) => j.p === startAlice.mine[0]);
  for (let i = 0; i < 30; i += 1) {
    alice.send({ type: CLIENT.INPUT, seat: startAlice.mine[0], seq: i + 1, dir: 1, bomb: false, det: false });
    await wait(16);
  }
  await wait(300);
  const after = bob.of(SERVER.STATE).at(-1).j.find((j) => j.p === startAlice.mine[0]);
  check(after.x > before.x, 'ce qu Alice fait se voit chez Bob');

  // A resynchronisation gives the grid back to whoever asks for it.
  bob.send({ type: CLIENT.RESYNC, v: 0 });
  const arena = await bob.await(SERVER.ARENA);
  check(arena.tiles.length === 195, 'la resynchronisation renvoie la grille');

  // A voluntary departure is announced to the others.
  bob.send({ type: CLIENT.LEAVE });
  const left = await alice.await(SERVER.LEFT);
  check(typeof left.place === 'number', 'le depart de Bob est annonce a Alice');

  alice.socket.close();
  bob.socket.close();
} catch (error) {
  failures += 1;
  console.error(`\nECHEC : ${error.message}`);
}

console.log(failures === 0 ? '\nTout est passe.' : `\n${failures} echec(s).`);
process.exit(failures === 0 ? 0 : 1);
