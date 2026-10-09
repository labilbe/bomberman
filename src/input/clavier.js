/**
 * Clavier : deux jeux de touches sur la meme machine.
 *
 * Les touches sont lues par `event.code`, jamais par `event.key`. Un `KeyW`
 * physique est un Z sur un clavier AZERTY : en lisant `key`, le second joueur
 * devrait appuyer sur des touches eparpillees, et le jeu aurait l'air casse pour
 * la moitie des gens qui l'essaient.
 *
 * Ce module n'emet aucun message et ne connait ni le moteur ni le reseau. Il
 * tient une intention par place locale, et c'est l'appelant qui vient la lire a
 * chaque image. `poser` et `declencher` sont des impulsions : on les relit une
 * fois, puis elles retombent — sans quoi tenir la barre d'espace poserait une
 * bombe a chaque pas de simulation.
 *
 * La direction suit la DERNIERE touche enfoncee encore tenue. C'est ce qui rend
 * les virages nets : en gardant la premiere, un joueur qui anticipe en appuyant
 * sur la suivante avant de relacher la precedente continuerait tout droit.
 */

import { HAUT, DROITE, BAS, GAUCHE } from '../engine/constantes.js';

/** Les deux jeux de touches, dans l'ordre des places locales. */
export const TOUCHES = [
  {
    nom: 'Fleches',
    haut: 'ArrowUp',
    bas: 'ArrowDown',
    gauche: 'ArrowLeft',
    droite: 'ArrowRight',
    bombe: 'Space',
    detonateur: 'Enter',
    libelle: { bombe: 'Espace', detonateur: 'Entree' },
  },
  {
    nom: 'ZQSD',
    haut: 'KeyW',
    bas: 'KeyS',
    gauche: 'KeyA',
    droite: 'KeyD',
    bombe: 'ShiftLeft',
    detonateur: 'ControlLeft',
    libelle: { bombe: 'Maj gauche', detonateur: 'Ctrl gauche' },
  },
];

const DIRECTIONS = { haut: HAUT, bas: BAS, gauche: GAUCHE, droite: DROITE };

/**
 * @param {{ cible?: EventTarget, nombre?: number }} options
 */
export function creerClavier({ cible = window, nombre = 2 } = {}) {
  const sieges = Array.from({ length: nombre }, () => ({
    tenues: [],
    poser: false,
    declencher: false,
  }));

  /** Code -> { siege, role }. Construit une fois : la recherche est en O(1). */
  const plan = new Map();
  for (let siege = 0; siege < nombre; siege += 1) {
    const jeu = TOUCHES[siege % TOUCHES.length];
    for (const role of ['haut', 'bas', 'gauche', 'droite', 'bombe', 'detonateur']) {
      plan.set(jeu[role], { siege, role });
    }
  }

  const raccourcis = new Map();

  function enfoncee(evenement) {
    // Sans ce garde, taper un pseudo dans le champ de salon poserait des bombes.
    const cibleEvenement = evenement.target;
    if (cibleEvenement && /^(INPUT|TEXTAREA|SELECT)$/.test(cibleEvenement.tagName ?? '')) return;

    const raccourci = raccourcis.get(evenement.code);
    if (raccourci) {
      evenement.preventDefault();
      raccourci();
      return;
    }

    const trouve = plan.get(evenement.code);
    if (!trouve) return;
    evenement.preventDefault();
    const siege = sieges[trouve.siege];
    if (trouve.role === 'bombe') {
      if (!evenement.repeat) siege.poser = true;
      return;
    }
    if (trouve.role === 'detonateur') {
      if (!evenement.repeat) siege.declencher = true;
      return;
    }
    if (!siege.tenues.includes(trouve.role)) siege.tenues.push(trouve.role);
  }

  function relachee(evenement) {
    const trouve = plan.get(evenement.code);
    if (!trouve) return;
    const siege = sieges[trouve.siege];
    siege.tenues = siege.tenues.filter((role) => role !== trouve.role);
  }

  /**
   * Un onglet qui perd le focus garde ses touches « enfoncees » : le bomber
   * partirait tout seul dans un mur jusqu'au retour.
   */
  function oubli() {
    for (const siege of sieges) siege.tenues = [];
  }

  cible.addEventListener('keydown', enfoncee);
  cible.addEventListener('keyup', relachee);
  cible.addEventListener('blur', oubli);

  return {
    /**
     * L'intention d'une place locale. Les impulsions sont consommees.
     *
     * @param {number} siege
     * @returns {import('../engine/entrees.js').Entree}
     */
    lire(siege) {
      const etat = sieges[siege];
      if (!etat) return { dir: -1, poser: false, declencher: false };
      const derniere = etat.tenues[etat.tenues.length - 1];
      const entree = {
        dir: derniere === undefined ? -1 : DIRECTIONS[derniere],
        poser: etat.poser,
        declencher: etat.declencher,
      };
      etat.poser = false;
      etat.declencher = false;
      return entree;
    },

    /** Ajoute une touche d'interface, jamais envoyee au moteur. */
    raccourci(code, action) {
      raccourcis.set(code, action);
    },

    oubli,

    detacher() {
      cible.removeEventListener('keydown', enfoncee);
      cible.removeEventListener('keyup', relachee);
      cible.removeEventListener('blur', oubli);
    },
  };
}
