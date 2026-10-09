/**
 * Tests de la lecture des couleurs de joueur.
 *
 * Les tables du jeu ne sont pas dans le depot — elles appartiennent a Interplay
 * — donc rien ici ne lit le disque. Chaque test fabrique un COLOR.PAL et des
 * .RMP en memoire, ce qui a l'avantage de rendre explicite ce que le module
 * exige vraiment du format : une palette en SIX bits, un en-tete de trois
 * octets avant les entrees du .RMP, et une rampe verte reconnaissable.
 *
 * Ce que ces tests verrouillent n'est pas le format mais le RAISONNEMENT : le
 * module ne retient des tables que la teinte, et c'est cette prudence-la qui
 * doit survivre aux relectures. Voir l'en-tete de couleurs.js pour pourquoi
 * appliquer les tables telles quelles donne un sprite tachete.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { couleursJoueurs, COULEURS } from '../src/extraction/couleurs.js';

/** Longueurs imposees par le format, reprises ici pour ne pas les deviner. */
const PALETTE = 768;
const INVERSE = 32768;
const ENTETE_RMP = 3;

/** La rampe verte du jeu, et les rampes de remplacement, dans notre palette. */
const VERT = { debut: 1, longueur: 16 };
const ROUGE = { debut: 17, longueur: 16 };
const BLEU = { debut: 33, longueur: 16 };

/**
 * Fabrique un COLOR.PAL : trois rampes, puis la table inverse.
 *
 * Les composantes sont en six bits, comme dans le fichier du jeu. On monte de
 * quatre en quatre pour que la rampe couvre toute la hauteur sans jamais
 * toucher ni le noir ni le blanc pur, ou la teinte n'existe plus.
 */
function palette() {
  const octets = Buffer.alloc(PALETTE + INVERSE);
  const poser = ({ debut, longueur }, composante) => {
    for (let k = 0; k < longueur; k += 1) {
      octets[(debut + k) * 3 + composante] = (k + 1) * 4 - 1;
    }
  };
  poser(VERT, 1);
  poser(ROUGE, 0);
  poser(BLEU, 2);
  return octets;
}

/** Un .RMP qui ne remappe rien : chaque index pointe sur lui-meme. */
function identite() {
  const octets = Buffer.alloc(ENTETE_RMP + 256);
  for (let i = 0; i < 256; i += 1) octets[ENTETE_RMP + i] = i;
  return octets;
}

/** Un .RMP qui envoie la rampe verte sur une autre rampe, pas a pas. */
function vers(cible) {
  const octets = identite();
  for (let k = 0; k < VERT.longueur; k += 1) {
    octets[ENTETE_RMP + VERT.debut + k] = cible.debut + k;
  }
  return octets;
}

/** Les dix tables, dont celles qu'on veut observer aux places demandees. */
function tables(remplacements = {}) {
  return Array.from({ length: COULEURS }, (_, n) => remplacements[n] ?? identite());
}

test('la teinte de chaque joueur vient de la rampe sur laquelle sa table renvoie', () => {
  const couleurs = couleursJoueurs(palette(), tables({ 0: vers(ROUGE), 1: vers(BLEU) }));

  assert.equal(couleurs.length, COULEURS);
  assert.equal(couleurs[0].teinte, 0);
  assert.equal(couleurs[1].teinte, 240);
});

test('une table qui ne remappe rien laisse le vert tel quel', () => {
  const couleurs = couleursJoueurs(palette(), tables({ 0: vers(ROUGE) }));

  // La place 9 est une identite : sa cible est sa source, donc la rampe verte.
  assert.equal(couleurs[9].teinte, 120);
});

test('une rampe pleinement saturee ressort saturee', () => {
  const couleurs = couleursJoueurs(palette(), tables({ 0: vers(ROUGE) }));

  assert.equal(couleurs[0].saturation, 1);
});

test('une cible aussi claire que sa source ne corrige pas la clarte', () => {
  // Les trois rampes montent de la meme facon : seule la composante change.
  // La difference de luminosite entre source et cible est donc nulle.
  const couleurs = couleursJoueurs(palette(), tables({ 0: vers(ROUGE) }));

  assert.equal(couleurs[0].clarte, 0);
});

test('seules les sources vert pur sont interrogees', () => {
  // On fait pointer la rampe ROUGE — qui n'est pas verte — vers le bleu. Le
  // module ne doit pas la lire : seule la rampe verte est echangeable, et c'est
  // toute la prudence du module que de s'y tenir.
  const table = identite();
  for (let k = 0; k < ROUGE.longueur; k += 1) {
    table[ENTETE_RMP + ROUGE.debut + k] = BLEU.debut + k;
  }

  const couleurs = couleursJoueurs(palette(), tables({ 0: vers(ROUGE), 1: table }));

  // La place 1 ne remappe aucun vert : elle reste sur la rampe verte.
  assert.equal(couleurs[1].teinte, 120);
});

test('une entree qui tombe sur zero fait ecarter la source', () => {
  // Zero est l'index mort de la palette. Une source que l'une des tables y
  // envoie ne dit rien de fiable, et doit sortir de l'echantillon partout.
  const morte = vers(ROUGE);
  morte[ENTETE_RMP + VERT.debut] = 0;

  const couleurs = couleursJoueurs(palette(), tables({ 0: morte, 1: vers(BLEU) }));

  assert.equal(couleurs[0].teinte, 0);
  assert.equal(couleurs[1].teinte, 240);
});

test('une palette de la mauvaise taille est refusee, plutot que lue de travers', () => {
  assert.throws(
    () => couleursJoueurs(Buffer.alloc(PALETTE), tables()),
    /COLOR\.PAL fait 768 octets/,
  );
});

test('il faut les dix tables, pas neuf', () => {
  assert.throws(
    () => couleursJoueurs(palette(), tables().slice(0, 9)),
    /9 fichiers \.RMP/,
  );
});
