/**
 * Epreuve de bout en bout du relais, contre un vrai Worker.
 *
 *   npm run relais        # dans un terminal
 *   npm run test:relais   # dans un autre
 *
 * Les tests de `test/salon.test.js` verifient les REGLES du salon dans Node, ou
 * tout est instantane et ou le temps est un parametre. Ils ne disent rien de la
 * plomberie : le routage par code, l'unicite du Durable Object, la serialisation
 * des trames, le battement reel. C'est ce que ce script eprouve, et il ne peut
 * pas etre un test `node --test` ordinaire — il lui faut un relais qui tourne.
 *
 * Deux clients s'y connectent, comme deux joueurs, et l'on verifie qu'ils
 * tombent dans la MEME partie et recoivent la meme arene.
 */

import { CLIENT, SERVER, encode, decode } from '../src/net/protocole.js';

const BASE = process.env.RELAIS ?? 'ws://127.0.0.1:8787/salon';
const SALON = `E2E${Math.floor(Math.random() * 900 + 100)}`;

let echecs = 0;

function verifier(condition, propos) {
  if (condition) {
    console.log(`  ok   ${propos}`);
    return;
  }
  echecs += 1;
  console.error(`  ECHEC ${propos}`);
}

/** Un client de test : il garde tout ce qu'il recoit, par type. */
function client(nom) {
  const recus = [];
  const fil = new WebSocket(`${BASE}?salon=${SALON}`);
  fil.addEventListener('message', (evenement) => {
    const message = decode(evenement.data);
    if (message) recus.push(message);
  });

  return {
    nom,
    fil,
    recus,
    ouvert: new Promise((resoudre, rejeter) => {
      fil.addEventListener('open', resoudre);
      fil.addEventListener('error', () => rejeter(new Error(`${nom} n a pas pu se connecter`)));
    }),
    envoyer: (message) => fil.send(encode(message)),
    du: (type) => recus.filter((m) => m.type === type),
    /** Attend un message d'un type donne, ou abandonne. */
    attendre(type, msMax = 5000) {
      return new Promise((resoudre, rejeter) => {
        const debut = Date.now();
        const voir = () => {
          const trouve = this.du(type)[0];
          if (trouve) return resoudre(trouve);
          if (Date.now() - debut > msMax) {
            return rejeter(new Error(`${nom} n a jamais recu « ${type} »`));
          }
          return setTimeout(voir, 25);
        };
        voir();
      });
    },
  };
}

const attendre = (ms) => new Promise((resoudre) => { setTimeout(resoudre, ms); });

try {
  console.log(`relais : ${BASE}`);
  console.log(`salon  : ${SALON}\n`);

  const alice = client('Alice');
  const bob = client('Bob');
  await Promise.all([alice.ouvert, bob.ouvert]);
  console.log('deux clients connectes');

  alice.envoyer({ type: CLIENT.JOIN, room: SALON, name: 'Alice', places: 2, format: 3 });
  const attente = await alice.attendre(SERVER.WAITING);
  verifier(attente.places === 1, 'le premier arrive est seul en attente');

  bob.envoyer({ type: CLIENT.JOIN, room: SALON, name: 'Bob', places: 2, format: 3 });

  const departAlice = await alice.attendre(SERVER.START);
  const departBob = await bob.attendre(SERVER.START);
  verifier(departAlice.places === 2, 'la partie demarre a deux');
  verifier(
    JSON.stringify(departAlice.miens) !== JSON.stringify(departBob.miens),
    'chacun recoit une place differente',
  );
  verifier(
    departAlice.noms.includes('Alice') && departAlice.noms.includes('Bob'),
    'chacun voit le nom de l autre',
  );

  const mancheAlice = await alice.attendre(SERVER.ROUND);
  const mancheBob = await bob.attendre(SERVER.ROUND);
  verifier(mancheAlice.tuiles.length === 195, 'la grille complete arrive');
  verifier(
    JSON.stringify(mancheAlice.tuiles) === JSON.stringify(mancheBob.tuiles),
    'les deux recoivent EXACTEMENT la meme arene',
  );

  // Le debut de manche fige l arene une seconde et demie : on laisse passer.
  console.log('on laisse la manche demarrer…');
  await attendre(2500);

  const etats = alice.du(SERVER.STATE);
  verifier(etats.length > 10, `les instantanes arrivent (${etats.length} recus)`);
  verifier(etats[etats.length - 1].j.length === 2, 'avec les deux bombers');

  // Alice marche vers la droite : sa position doit changer chez BOB aussi,
  // puisque c est le relais qui fait autorite.
  const avant = bob.du(SERVER.STATE).at(-1).j.find((j) => j.p === departAlice.miens[0]);
  for (let i = 0; i < 30; i += 1) {
    alice.envoyer({ type: CLIENT.INPUT, siege: departAlice.miens[0], seq: i + 1, dir: 1, bomb: false, det: false });
    await attendre(16);
  }
  await attendre(300);
  const apres = bob.du(SERVER.STATE).at(-1).j.find((j) => j.p === departAlice.miens[0]);
  verifier(apres.x > avant.x, 'ce qu Alice fait se voit chez Bob');

  // Une resynchronisation rend la grille a qui la demande.
  bob.envoyer({ type: CLIENT.RESYNC, v: 0 });
  const arene = await bob.attendre(SERVER.ARENA);
  verifier(arene.tuiles.length === 195, 'la resynchronisation renvoie la grille');

  // Un depart volontaire est annonce aux autres.
  bob.envoyer({ type: CLIENT.LEAVE });
  const parti = await alice.attendre(SERVER.LEFT);
  verifier(typeof parti.place === 'number', 'le depart de Bob est annonce a Alice');

  alice.fil.close();
  bob.fil.close();
} catch (erreur) {
  echecs += 1;
  console.error(`\nECHEC : ${erreur.message}`);
}

console.log(echecs === 0 ? '\nTout est passe.' : `\n${echecs} echec(s).`);
process.exit(echecs === 0 ? 0 : 1);
