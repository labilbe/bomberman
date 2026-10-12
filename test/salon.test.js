/**
 * Tests du salon, sans Cloudflare ni WebSocket.
 *
 * `creerSalon` ne connait que des messages decodes et rend des envois : tout se
 * joue donc dans Node, horloge comprise, puisque le temps lui est passe. C'est
 * ce qui permet d'eprouver ici ce qu'une partie reelle ne produit qu'une fois
 * sur cent — un joueur qui revient a la derniere seconde, deux departs au meme
 * pas, un salon qui se vide en pleine manche.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { creerSalon } from '../worker/salon.js';
import { CLIENT, SERVER, REPRISE_MS } from '../src/net/protocole.js';
import { PAS_MS } from '../src/engine/constantes.js';
import { DEPART_MANCHE_PAS } from '../src/engine/partie.js';

/** Les messages d'un type donne dans une liste d'envois. */
const du = (envois, type) => envois.filter((e) => e.message.type === type).map((e) => e.message);

/** A qui part le premier message d'un type donne. */
const pour = (envois, type) => envois.find((e) => e.message.type === type)?.pour;

/** Un salon ou deux joueurs se sont assis, et la partie a donc demarre. */
function salonLance(maintenant = 0) {
  const salon = creerSalon({ code: 'TEST', maintenant, graine: 7 });
  salon.rejoindre('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, format: 3 }, maintenant);
  const envois = salon.rejoindre('b', { type: CLIENT.JOIN, name: 'Bob' }, maintenant);
  return { salon, envois };
}

/** Fait avancer le salon de `ms`, par battements reguliers. */
function battre(salon, ms, depart = 0, pas = 16) {
  const recoltes = [];
  for (let t = depart + pas; t <= depart + ms; t += pas) {
    for (const envoi of salon.battre(t)) recoltes.push(envoi);
  }
  return recoltes;
}

test('le premier arrive est annonce en attente, pas en partie', () => {
  const salon = creerSalon({ code: 'TEST', maintenant: 0, graine: 1 });
  const envois = salon.rejoindre('a', { type: CLIENT.JOIN, name: 'Alice', places: 2 }, 0);

  const [attente] = du(envois, SERVER.WAITING);
  assert.ok(attente, 'un message d attente doit partir');
  assert.equal(attente.places, 1);
  assert.equal(attente.max, 2);
  assert.deepEqual(attente.noms[0], 'Alice');
  assert.equal(salon.lancee, false);
});

test('le salon plein demarre tout seul', () => {
  const { salon, envois } = salonLance();

  assert.equal(salon.lancee, true);
  const departs = du(envois, SERVER.START);
  assert.equal(departs.length, 2, 'un depart par humain, chacun avec sa place');
  assert.deepEqual(departs.map((d) => d.miens).flat().sort(), [0, 1]);

  const [manche] = du(envois, SERVER.ROUND);
  assert.ok(manche, 'la premiere manche est annoncee');
  assert.equal(manche.manche, 1);
  assert.equal(manche.tuiles.length, 15 * 13, 'la grille part en entier');
  assert.equal(typeof manche.v, 'number');
});

test('le depart n est envoye qu a son destinataire', () => {
  const { envois } = salonLance();
  for (const envoi of envois.filter((e) => e.message.type === SERVER.START)) {
    assert.notEqual(envoi.pour, null, 'un depart ne se diffuse pas a tous');
  }
});

test('on peut lancer sans attendre, les places vides passent aux bots', () => {
  const salon = creerSalon({ code: 'TEST', maintenant: 0, graine: 1 });
  salon.rejoindre('a', { type: CLIENT.JOIN, name: 'Alice', places: 4 }, 0);
  const envois = salon.message('a', { type: CLIENT.BEGIN }, 0);

  assert.equal(salon.lancee, true);
  const [depart] = du(envois, SERVER.START);
  assert.equal(depart.places, 4);
  assert.deepEqual(depart.miens, [0]);
  // Trois bots, tous nommes, et tous differents.
  const nomsBots = depart.noms.slice(1);
  assert.equal(nomsBots.length, 3);
  assert.equal(new Set(nomsBots).size, 3, 'deux bots homonymes rendraient les scores illisibles');
});

test('un bot peut etre ajoute avant le depart', () => {
  const salon = creerSalon({ code: 'TEST', maintenant: 0, graine: 1 });
  salon.rejoindre('a', { type: CLIENT.JOIN, name: 'Alice', places: 4 }, 0);
  const envois = salon.message('a', { type: CLIENT.BOT }, 0);

  const [attente] = du(envois, SERVER.WAITING);
  assert.equal(attente.places, 2, 'un humain et un bot');
  assert.equal(salon.lancee, false, 'il reste deux places');
});

test('ajouter des bots jusqu a remplir lance la partie', () => {
  const salon = creerSalon({ code: 'TEST', maintenant: 0, graine: 1 });
  salon.rejoindre('a', { type: CLIENT.JOIN, name: 'Alice', places: 2 }, 0);
  const envois = salon.message('a', { type: CLIENT.BOT }, 0);
  assert.equal(salon.lancee, true);
  assert.equal(du(envois, SERVER.START).length, 1);
});

test('un salon complet refuse le suivant', () => {
  const { salon } = salonLance();
  const envois = salon.rejoindre('c', { type: CLIENT.JOIN, name: 'Carol' }, 0);
  const [erreur] = du(envois, SERVER.ERROR);
  assert.ok(erreur);
  assert.match(erreur.message, /commence/);
});

test('le format du salon est fixe par le premier arrive', () => {
  const salon = creerSalon({ code: 'TEST', maintenant: 0, graine: 1 });
  salon.rejoindre('a', { type: CLIENT.JOIN, name: 'Alice', places: 2, format: 7 }, 0);
  const envois = salon.rejoindre('b', { type: CLIENT.JOIN, name: 'Bob', places: 4, format: 3 }, 0);

  const [depart] = du(envois, SERVER.START);
  assert.equal(depart.places, 2, 'le second ne redimensionne pas le salon');
  assert.equal(depart.format, 7, 'ni ne change le format');
});

test('la partie avance et diffuse des instantanes', () => {
  const { salon } = salonLance();
  // On passe le temps d arret du debut de manche, pendant lequel rien ne bouge.
  const envois = battre(salon, DEPART_MANCHE_PAS * PAS_MS + 500);

  const etats = du(envois, SERVER.STATE);
  assert.ok(etats.length > 0, 'des instantanes doivent partir');
  const dernier = etats[etats.length - 1];
  assert.equal(dernier.j.length, 2, 'deux bombers');
  assert.equal(typeof dernier.t, 'number');
  assert.equal(typeof dernier.v, 'number');
  assert.ok(Array.isArray(dernier.b));
  assert.ok(Array.isArray(dernier.f));
});

test('rien n est diffuse pendant que l arene est figee', () => {
  const { salon } = salonLance();
  // Le debut de manche fige l arene : aucun instantane n a de sens.
  const envois = battre(salon, (DEPART_MANCHE_PAS - 10) * PAS_MS);
  assert.equal(du(envois, SERVER.STATE).length, 0);
});

test('une intention en retard est ignoree', () => {
  const { salon } = salonLance();
  battre(salon, DEPART_MANCHE_PAS * PAS_MS);

  salon.message('a', { type: CLIENT.INPUT, seq: 5, dir: 1 }, 2000);
  salon.message('a', { type: CLIENT.INPUT, seq: 3, dir: 3 }, 2001);
  // La seconde est plus ancienne : elle ne doit pas revenir en arriere.
  battre(salon, 200, 2001);
  const joueur = salon.partie.etat.joueurs[0];
  assert.ok(joueur.x > 0);
});

test('une coupure laisse du temps pour revenir, et le dit', () => {
  const { salon } = salonLance();
  const envois = salon.partir('a', 1000);

  const [absence] = du(envois, SERVER.AWAY);
  assert.ok(absence);
  assert.equal(absence.place, 0);
  assert.equal(absence.secondes, Math.round(REPRISE_MS / 1000));
  assert.equal(du(envois, SERVER.LEFT).length, 0, 'pas d elimination immediate');
});

test('qui revient a temps retrouve sa place et son arene', () => {
  const { salon } = salonLance();
  salon.partir('a', 1000);
  const envois = salon.rejoindre('a2', { type: CLIENT.JOIN, name: 'Alice', reprise: 'a' }, 5000);

  assert.ok(du(envois, SERVER.BACK)[0], 'les autres sont prevenus du retour');
  const [depart] = du(envois, SERVER.START);
  assert.deepEqual(depart.miens, [0], 'il retrouve sa place');
  const [manche] = du(envois, SERVER.ROUND);
  assert.ok(manche.tuiles, 'et l arene telle qu elle est maintenant');
  assert.equal(manche.attente, 0, 'sans rejouer l annonce de debut de manche');
});

test('qui ne revient pas est elimine, une fois le delai passe', () => {
  const { salon } = salonLance();
  salon.partir('a', 1000);

  const avant = battre(salon, REPRISE_MS - 2000, 1000);
  assert.equal(du(avant, SERVER.LEFT).length, 0, 'pas avant l heure');

  const apres = salon.battre(1000 + REPRISE_MS + 1);
  const [parti] = du(apres, SERVER.LEFT);
  assert.ok(parti, 'puis il part');
  assert.equal(parti.place, 0);
  assert.equal(salon.partie.etat.joueurs[0].vivant, false);
});

test('un depart volontaire ne fait pas attendre les autres', () => {
  const { salon } = salonLance();
  const envois = salon.message('a', { type: CLIENT.LEAVE }, 1000);

  assert.equal(du(envois, SERVER.AWAY).length, 0, 'on n attend pas qui a claque la porte');
  const [parti] = du(envois, SERVER.LEFT);
  assert.ok(parti);
  assert.equal(salon.partie.etat.joueurs[0].vivant, false);
});

test('une resynchronisation renvoie la grille a celui qui la demande', () => {
  const { salon } = salonLance();
  const envois = salon.message('b', { type: CLIENT.RESYNC, v: 0 }, 100);

  const [arene] = du(envois, SERVER.ARENA);
  assert.ok(arene);
  assert.equal(arene.tuiles.length, 15 * 13);
  assert.equal(pour(envois, SERVER.ARENA), 'b', 'et a lui seul');
});

test('un salon se vide et se declare mort', () => {
  const salon = creerSalon({ code: 'TEST', maintenant: 0, graine: 1 });
  salon.rejoindre('a', { type: CLIENT.JOIN, name: 'Alice', places: 2 }, 0);
  assert.equal(salon.vivant, true);
  salon.partir('a', 100);
  assert.equal(salon.vivant, false, 'un salon vide se ferme');
});

test('un inconnu qui parle ne fait rien', () => {
  const { salon } = salonLance();
  assert.deepEqual(salon.message('zzz', { type: CLIENT.INPUT, seq: 1, dir: 0 }, 100), []);
  assert.deepEqual(salon.partir('zzz', 100), []);
});

test('une place libre vaut null, pas un libelle de remplissage', () => {
  // La salle d attente doit distinguer un siege vide d un joueur assis : un
  // « Place 3 » s y afficherait comme quelqu un qui attend deja.
  const salon = creerSalon({ code: 'TEST', maintenant: 0, graine: 1 });
  const envois = salon.rejoindre('a', { type: CLIENT.JOIN, name: 'Alice', places: 4 }, 0);

  const [attente] = du(envois, SERVER.WAITING);
  assert.equal(attente.noms[0], 'Alice');
  assert.deepEqual(attente.noms.slice(1), [null, null, null]);
});

test('au depart, plus aucune place n est libre', () => {
  const salon = creerSalon({ code: 'TEST', maintenant: 0, graine: 1 });
  salon.rejoindre('a', { type: CLIENT.JOIN, name: 'Alice', places: 4 }, 0);
  const envois = salon.message('a', { type: CLIENT.BEGIN }, 0);

  const [depart] = du(envois, SERVER.START);
  assert.equal(depart.noms.filter((n) => n === null).length, 0, 'les bots ont tous un prenom');
});
