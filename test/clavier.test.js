/**
 * Le clavier est teste sans navigateur : `creerClavier` accepte n'importe quelle
 * cible d'evenements, et Node en fournit une native. C'est tout l'interet de ne
 * pas avoir code `window` en dur dans le module.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { creerClavier, TOUCHES } from '../src/input/clavier.js';
import { HAUT, BAS, GAUCHE, DROITE } from '../src/engine/constantes.js';

/** Une cible d'evenements minimale, avec de quoi simuler des touches. */
function banc() {
  const cible = new EventTarget();
  const clavier = creerClavier({ cible, nombre: 2 });
  const enfoncer = (code, { target, ...extra } = {}) => {
    const evenement = new Event('keydown');
    Object.assign(evenement, { code, repeat: false, preventDefault() {}, ...extra });
    // `target` est un accesseur en lecture seule sur Event : Object.assign ne le
    // remplace pas, il faut le masquer par une propriete propre.
    if (target) Object.defineProperty(evenement, 'target', { value: target });
    cible.dispatchEvent(evenement);
  };
  const relacher = (code) => {
    const evenement = new Event('keyup');
    Object.assign(evenement, { code, preventDefault() {} });
    cible.dispatchEvent(evenement);
  };
  return { cible, clavier, enfoncer, relacher };
}

test('les deux jeux de touches pilotent deux sieges distincts', () => {
  const { clavier, enfoncer } = banc();
  enfoncer('ArrowRight');
  enfoncer('KeyW');
  assert.equal(clavier.lire(0).dir, DROITE);
  assert.equal(clavier.lire(1).dir, HAUT);
});

test('la direction suit la derniere touche encore tenue', () => {
  // Un joueur qui anticipe appuie sur la suivante avant de relacher la
  // precedente : garder la premiere le ferait continuer tout droit.
  const { clavier, enfoncer, relacher } = banc();
  enfoncer('ArrowLeft');
  assert.equal(clavier.lire(0).dir, GAUCHE);
  enfoncer('ArrowDown');
  assert.equal(clavier.lire(0).dir, BAS);
  relacher('ArrowDown');
  assert.equal(clavier.lire(0).dir, GAUCHE, 'on retombe sur la touche encore tenue');
  relacher('ArrowLeft');
  assert.equal(clavier.lire(0).dir, -1);
});

test('la bombe est une impulsion : lue une fois, elle retombe', () => {
  const { clavier, enfoncer } = banc();
  enfoncer('Space');
  assert.equal(clavier.lire(0).poser, true);
  assert.equal(clavier.lire(0).poser, false, 'tenir la touche ne pose pas une bombe par pas');
  enfoncer('Space');
  assert.equal(clavier.lire(0).poser, true);
});

test('la repetition automatique du clavier ne compte pas', () => {
  const { clavier, enfoncer } = banc();
  enfoncer('Space', { repeat: true });
  assert.equal(clavier.lire(0).poser, false);
});

test('le detonateur est une impulsion lui aussi', () => {
  const { clavier, enfoncer } = banc();
  enfoncer('Enter');
  assert.equal(clavier.lire(0).declencher, true);
  assert.equal(clavier.lire(0).declencher, false);
});

test('taper dans un champ de saisie ne pose pas de bombe', () => {
  const { clavier, enfoncer } = banc();
  enfoncer('Space', { target: { tagName: 'INPUT' } });
  assert.equal(clavier.lire(0).poser, false);
  enfoncer('ArrowUp', { target: { tagName: 'TEXTAREA' } });
  assert.equal(clavier.lire(0).dir, -1);
});

test('perdre le focus relache les touches tenues', () => {
  // Sinon le bomber part tout seul dans un mur jusqu'au retour sur l'onglet.
  const { clavier, enfoncer, cible } = banc();
  enfoncer('ArrowUp');
  assert.equal(clavier.lire(0).dir, HAUT);
  cible.dispatchEvent(new Event('blur'));
  assert.equal(clavier.lire(0).dir, -1);
});

test('les raccourcis d interface ne vont jamais au moteur', () => {
  const { clavier, enfoncer } = banc();
  let appels = 0;
  clavier.raccourci('KeyN', () => {
    appels += 1;
  });
  enfoncer('KeyN');
  assert.equal(appels, 1);
  assert.deepEqual(clavier.lire(0), { dir: -1, poser: false, declencher: false });
});

test('un siege inconnu rend une intention vide plutot que de lever', () => {
  const { clavier } = banc();
  assert.deepEqual(clavier.lire(9), { dir: -1, poser: false, declencher: false });
});

test('les deux jeux de touches ne se marchent pas dessus', () => {
  const codes = new Set();
  for (const jeu of TOUCHES) {
    for (const role of ['haut', 'bas', 'gauche', 'droite', 'bombe', 'detonateur']) {
      assert.equal(codes.has(jeu[role]), false, `${jeu[role]} est utilise deux fois`);
      codes.add(jeu[role]);
    }
  }
});
