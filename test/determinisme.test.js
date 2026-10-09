/**
 * Le test central du projet.
 *
 * Toute l'architecture repose sur une seule promesse : meme graine + meme suite
 * d'entrees = meme suite d'etats, sur n'importe quelle machine. C'est elle qui
 * autorise le relais a simuler l'arene, le navigateur a predire son propre
 * bomber, et le journal a rejouer une partie. Si ce fichier casse, ce n'est pas
 * un detail de regle qui est en jeu, c'est le reseau entier.
 *
 * Le second test relit le dossier du moteur a la recherche des trois sources
 * d'indeterminisme qu'on reintroduit sans y penser. Relire le dossier vaut mieux
 * que faire confiance : la revue oublie, le test non.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { creerEtat, cloner } from '../src/engine/etat.js';
import { pas } from '../src/engine/pas.js';
import { createRng, nextRandom } from '../src/engine/rng.js';
import { MAX_JOUEURS } from '../src/engine/constantes.js';

/**
 * Un journal d'entrees pseudo-aleatoire mais reproductible : on ne tire pas les
 * entrees au hasard reel, sinon un echec ne se rejouerait pas.
 */
function journal(graine, pasTotal, places) {
  let rng = createRng(graine);
  const tire = (borne) => {
    const t = nextRandom(rng);
    rng = t.rng;
    return Math.floor(t.value * borne);
  };
  const suite = [];
  for (let i = 0; i < pasTotal; i += 1) {
    const entrees = [];
    for (let place = 0; place < places; place += 1) {
      entrees[place] = {
        dir: tire(5) - 1,
        poser: tire(16) === 0,
        declencher: tire(64) === 0,
      };
    }
    suite.push(entrees);
  }
  return suite;
}

/** Condense un etat en une chaine comparable. */
function empreinte(etat) {
  return JSON.stringify({
    pas: etat.pas,
    phase: etat.phase,
    version: etat.version,
    graine: etat.rng.seed,
    tuiles: [...etat.tuiles],
    objets: [...etat.objets],
    joueurs: etat.joueurs,
    bombes: etat.bombes,
    flammes: etat.flammes,
    verdict: etat.verdict,
  });
}

function rejouer(graine, places, suite) {
  const etat = creerEtat({ graine, places });
  for (const entrees of suite) pas(etat, entrees);
  return etat;
}

test('deux parties identiques donnent le meme etat final', () => {
  const suite = journal(777, 2000, MAX_JOUEURS);
  const un = rejouer(555, MAX_JOUEURS, suite);
  const deux = rejouer(555, MAX_JOUEURS, suite);
  assert.equal(empreinte(un), empreinte(deux));
  assert.ok(un.pas > 0);
});

test('une partie rejouee depuis un clone suit le meme chemin', () => {
  const suite = journal(31, 600, 3);
  const depart = creerEtat({ graine: 99, places: 3 });
  const copie = cloner(depart);
  assert.equal(empreinte(depart), empreinte(copie), 'le clone part identique');

  for (const entrees of suite) pas(depart, entrees);
  for (const entrees of suite) pas(copie, entrees);
  assert.equal(empreinte(depart), empreinte(copie));
});

test('un clone ne partage rien avec son original', () => {
  const etat = creerEtat({ graine: 5, places: 2 });
  const copie = cloner(etat);
  copie.tuiles[0] = 9;
  copie.objets[0] = 9;
  copie.joueurs[0].x = -1;
  copie.rng.seed = 1234;
  assert.notEqual(etat.tuiles[0], 9);
  assert.notEqual(etat.objets[0], 9);
  assert.notEqual(etat.joueurs[0].x, -1);
  assert.notEqual(etat.rng.seed, 1234);
});

test('toutes les positions restent entieres', () => {
  // Un flottant qui s accumule sur dix mille pas finit par differer d une
  // machine a l autre, et un joueur se retrouve mort d un cote et vivant de
  // l autre.
  const suite = journal(2, 1500, MAX_JOUEURS);
  const etat = creerEtat({ graine: 8, places: MAX_JOUEURS });
  for (const entrees of suite) {
    pas(etat, entrees);
    for (const joueur of etat.joueurs) {
      assert.equal(Number.isInteger(joueur.x), true, `x non entier : ${joueur.x}`);
      assert.equal(Number.isInteger(joueur.y), true, `y non entier : ${joueur.y}`);
    }
    for (const bombe of etat.bombes) {
      assert.equal(Number.isInteger(bombe.cx), true);
      assert.equal(Number.isInteger(bombe.cy), true);
      if (bombe.glisse) {
        assert.equal(Number.isInteger(bombe.glisse.x), true);
        assert.equal(Number.isInteger(bombe.glisse.y), true);
      }
    }
  }
});

test('le moteur ne contient aucune source de hasard ni d horloge', () => {
  const dossier = fileURLToPath(new URL('../src/engine/', import.meta.url));
  const interdits = [
    ['Math.random', /Math\s*\.\s*random/],
    ['Date.now', /Date\s*\.\s*now/],
    ['new Date', /new\s+Date\s*\(/],
    ['performance.now', /performance\s*\.\s*now/],
  ];
  const fichiers = readdirSync(dossier).filter((nom) => nom.endsWith('.js'));
  assert.ok(fichiers.length >= 8, 'le moteur doit etre la');

  for (const nom of fichiers) {
    // rng.js a droit a randomSeed() : c'est la frontiere ou le hasard entre,
    // une fois, pour une partie en solo.
    const source = readFileSync(new URL(`../src/engine/${nom}`, import.meta.url), 'utf8');
    for (const [etiquette, motif] of interdits) {
      if (nom === 'rng.js' && etiquette === 'Math.random') continue;
      assert.equal(motif.test(source), false, `${nom} ne doit pas utiliser ${etiquette}`);
    }
  }
});
