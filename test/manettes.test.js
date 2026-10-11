/**
 * Les manettes sont testees sans navigateur : `creerManettes` recoit sa sonde,
 * au lieu d'appeler `navigator.getGamepads` elle-meme. C'est tout l'interet de
 * ne pas avoir code l'API en dur dans le module — et ici ca compte double, car
 * un navigateur ne rend une manette qu'apres qu'un humain a presse un bouton
 * dessus, ce qu'aucun test automatique ne peut faire.
 *
 * Beaucoup de tests commencent par une lecture au repos. Ce n'est pas une
 * formalite : la premiere lecture d'une manette ne fait qu'enregistrer l'etat de
 * ses boutons, sans en tirer d'impulsion. C'est ce qui evite qu'arriver sur la
 * page une gachette enfoncee pose une bombe que personne n'a demandee.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { creerManettes, CROIX, BOUTONS, ZONE_MORTE } from '../src/input/manettes.js';
import { HAUT, BAS, GAUCHE, DROITE } from '../src/engine/constantes.js';

/** Une manette au repos, que l'on inclinera case par case. */
function manette({ croix = [], boutons = [], axes = [0, 0] } = {}) {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  for (const role of croix) buttons[CROIX[role]] = { pressed: true, value: 1 };
  for (const role of boutons) buttons[BOUTONS[role]] = { pressed: true, value: 1 };
  return { connected: true, buttons, axes };
}

/** Un banc ou l'on rebranche ce qu'on veut entre deux lectures. */
function banc(initiales = [manette()]) {
  let branchees = initiales;
  const manettes = creerManettes({ sonde: () => branchees, nombre: 2 });
  return {
    manettes,
    poser: (liste) => { branchees = liste; },
    lire: (siege = 0) => manettes.lire(siege),
  };
}

test('la croix directionnelle pilote le bomber', () => {
  const b = banc([manette({ croix: ['droite'] })]);
  assert.equal(b.lire().dir, DROITE);
});

test('la direction suit la derniere direction encore tenue', () => {
  const b = banc([manette({ croix: ['gauche'] })]);
  assert.equal(b.lire().dir, GAUCHE);

  // Le joueur anticipe son virage : il pousse le haut sans relacher la gauche.
  b.poser([manette({ croix: ['gauche', 'haut'] })]);
  assert.equal(b.lire().dir, HAUT);

  // Il relache enfin la gauche : la direction ne doit pas changer pour autant.
  b.poser([manette({ croix: ['haut'] })]);
  assert.equal(b.lire().dir, HAUT);
});

test('le stick prend le relais quand la croix se tait', () => {
  const b = banc([manette({ axes: [0, -1] })]);
  assert.equal(b.lire().dir, HAUT);
});

test('un stick au repos ne fait pas avancer le bomber', () => {
  // Une manette usee ne rend jamais exactement zero au repos.
  const b = banc([manette({ axes: [0.2, -0.3] })]);
  assert.equal(b.lire().dir, -1);
});

test('en diagonale, l axe le plus incline gagne', () => {
  const b = banc([manette({ axes: [0.9, 0.6] })]);
  assert.equal(b.lire().dir, DROITE);

  b.poser([manette({ axes: [0.6, 0.9] })]);
  assert.equal(b.lire().dir, BAS);
});

test('juste sous le seuil, le stick ne compte pas ; juste au-dessus, si', () => {
  const b = banc([manette({ axes: [ZONE_MORTE - 0.01, 0] })]);
  assert.equal(b.lire().dir, -1);

  b.poser([manette({ axes: [ZONE_MORTE, 0] })]);
  assert.equal(b.lire().dir, DROITE);
});

test('la croix l emporte sur le stick', () => {
  const b = banc([manette({ croix: ['haut'], axes: [1, 0] })]);
  assert.equal(b.lire().dir, HAUT);
});

test('la bombe est une impulsion : lue une fois, elle retombe', () => {
  const b = banc();
  b.lire();

  b.poser([manette({ boutons: ['bombe'] })]);
  assert.equal(b.lire().poser, true);
  // Le bouton est toujours enfonce, mais le front est passe.
  assert.equal(b.lire().poser, false);
});

test('relacher puis reappuyer repose une bombe', () => {
  const b = banc();
  b.lire();

  b.poser([manette({ boutons: ['bombe'] })]);
  assert.equal(b.lire().poser, true);

  b.poser([manette()]);
  assert.equal(b.lire().poser, false);

  b.poser([manette({ boutons: ['bombe'] })]);
  assert.equal(b.lire().poser, true);
});

test('le detonateur est une impulsion lui aussi', () => {
  const b = banc();
  b.lire();

  b.poser([manette({ boutons: ['detonateur'] })]);
  const premiere = b.lire();
  assert.equal(premiere.declencher, true);
  assert.equal(premiere.poser, false);
  assert.equal(b.lire().declencher, false);
});

test('un bouton deja tenu a l arrivee ne pose pas de bombe', () => {
  // On decouvre la manette gachette enfoncee : c'est un etat, pas un front.
  const b = banc([manette({ boutons: ['bombe'] })]);
  assert.equal(b.lire().poser, false);
  assert.equal(b.lire().poser, false);

  // Il faut vraiment relacher et reappuyer pour que ca compte.
  b.poser([manette()]);
  b.lire();
  b.poser([manette({ boutons: ['bombe'] })]);
  assert.equal(b.lire().poser, true);
});

test('deux manettes pilotent deux sieges distincts', () => {
  const b = banc([manette(), manette()]);
  b.lire(0);
  b.lire(1);

  b.poser([
    manette({ croix: ['haut'] }),
    manette({ croix: ['bas'], boutons: ['bombe'] }),
  ]);

  assert.equal(b.lire(0).dir, HAUT);
  const second = b.lire(1);
  assert.equal(second.dir, BAS);
  assert.equal(second.poser, true);
});

test('un emplacement vide ne decale pas les sieges', () => {
  // Le navigateur laisse un trou quand on debranche : sans filtrage, le joueur
  // restant perdrait sa manette alors qu'elle est toujours branchee.
  const b = banc([null, manette({ croix: ['droite'] })]);
  assert.equal(b.lire(0).dir, DROITE);
});

test('une manette annoncee deconnectee est ignoree', () => {
  const debranchee = manette({ croix: ['droite'] });
  debranchee.connected = false;
  const b = banc([debranchee]);
  assert.equal(b.lire(0).dir, -1);
});

test('debrancher en pleine course relache la direction', () => {
  const b = banc([manette({ croix: ['droite'] })]);
  assert.equal(b.lire().dir, DROITE);

  b.poser([]);
  assert.equal(b.lire().dir, -1);

  // Et au retour, la direction ne revient pas toute seule.
  b.poser([manette()]);
  assert.equal(b.lire().dir, -1);
});

test('rebrancher avec le bouton deja enfonce ne pose pas de bombe', () => {
  const b = banc();
  b.lire();

  b.poser([manette({ boutons: ['bombe'] })]);
  assert.equal(b.lire().poser, true);

  b.poser([]);
  b.lire();

  // Meme bouton, toujours tenu, manette retrouvee : rien ne doit partir.
  b.poser([manette({ boutons: ['bombe'] })]);
  assert.equal(b.lire().poser, false);
});

test('oubli relache tout, et ne fait pas partir de bombe au retour', () => {
  const b = banc([manette({ croix: ['haut'], boutons: ['bombe'] })]);
  b.lire();

  b.manettes.oubli();
  assert.equal(b.lire().dir, HAUT);
  assert.equal(b.lire().poser, false);

  b.poser([manette()]);
  assert.equal(b.lire().dir, -1);
});

test('combien compte les manettes reellement branchees', () => {
  const b = banc([manette(), null, manette()]);
  assert.equal(b.manettes.combien(), 2);

  b.poser([]);
  assert.equal(b.manettes.combien(), 0);
});

test('sans manette, l intention est vide plutot que levee', () => {
  const b = banc([]);
  assert.deepEqual(b.lire(0), { dir: -1, poser: false, declencher: false });
});

test('un siege inconnu rend une intention vide', () => {
  const b = banc([manette({ croix: ['haut'] })]);
  assert.deepEqual(b.lire(7), { dir: -1, poser: false, declencher: false });
});

test('une gachette analogique compte comme enfoncee passe la moitie', () => {
  const b = banc();
  b.lire();

  const m = manette();
  m.buttons[BOUTONS.bombe] = { pressed: false, value: 0.8 };
  b.poser([m]);
  assert.equal(b.lire().poser, true);
});
