/**
 * Bruitages : ceux d'Atomic Bomberman s'ils ont ete extraits, sinon synthetises.
 *
 * La synthese reste le chemin par defaut, et ce n'est pas un pis-aller : un
 * depot fraichement clone n'a aucun asset, et le jeu doit sonner quand meme.
 * Tout sort alors d'oscillateurs et de bruit blanc.
 *
 * Quand la banque est la, elle ne remplace QUE les roles pour lesquels le jeu
 * d'origine a un son. Casser une brique, reveler un bonus ou annoncer une
 * manche n'en ont pas — Atomic Bomberman les couvre par l'explosion — et ils
 * restent donc synthetises.
 *
 * Le contexte audio est cree au PREMIER GESTE de l'utilisateur, jamais au
 * chargement : les navigateurs refusent de demarrer un son sans interaction, et
 * un contexte cree trop tot reste bloque en « suspended » pour toute la partie,
 * sans la moindre erreur pour le dire.
 *
 * Les sons sont pilotes par les EVENEMENTS du moteur, pas par le rendu. C'est ce
 * qui fait qu'ils sonnent pareil en solo et en ligne : le relais envoie les memes
 * evenements que la partie locale produit.
 */

/** Volume general. Bas : une explosion par seconde a quatre joueurs, cela suffit. */
const VOLUME = 0.22;

import { chargerBanque } from './banque.js';

export function creerSons() {
  // Le telechargement part tout de suite ; le decodage attendra le contexte.
  const promesseBanque = chargerBanque().catch(() => null);
  /** @type {Awaited<ReturnType<typeof chargerBanque>>} */
  let banque = null;
  /** @type {AudioContext | null} */
  let ctx = null;
  let maitre = null;
  let actif = true;
  /** Bruit blanc pre-calcule : le regenerer a chaque explosion couterait cher. */
  let bruit = null;

  function demarrer() {
    if (ctx || !actif) return;
    const Audio = window.AudioContext ?? window.webkitAudioContext;
    if (!Audio) return;
    ctx = new Audio();
    maitre = ctx.createGain();
    maitre.gain.value = VOLUME;
    maitre.connect(ctx.destination);

    // Le decodage ne peut pas commencer avant d'avoir un contexte : c'est ici,
    // et pas au telechargement, que la banque devient jouable.
    promesseBanque.then((chargee) => {
      banque = chargee;
      return chargee?.preparer(ctx);
    }).catch(() => {
      banque = null;
    });

    const duree = 1;
    bruit = ctx.createBuffer(1, ctx.sampleRate * duree, ctx.sampleRate);
    const donnees = bruit.getChannelData(0);
    for (let i = 0; i < donnees.length; i += 1) donnees[i] = Math.random() * 2 - 1;
  }

  function pret() {
    if (!actif) return false;
    if (!ctx) demarrer();
    if (!ctx) return false;
    // Un onglet revenu d'arriere-plan retrouve un contexte suspendu.
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  /** Une note simple : forme d'onde, hauteur, duree, enveloppe. */
  function note(forme, debut, fin, duree, gain = 1, retard = 0) {
    if (!pret()) return;
    const t = ctx.currentTime + retard;
    const osc = ctx.createOscillator();
    const volume = ctx.createGain();
    osc.type = forme;
    osc.frequency.setValueAtTime(debut, t);
    if (fin !== debut) osc.frequency.exponentialRampToValueAtTime(Math.max(1, fin), t + duree);
    volume.gain.setValueAtTime(0.0001, t);
    volume.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    volume.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    osc.connect(volume);
    volume.connect(maitre);
    osc.start(t);
    osc.stop(t + duree + 0.02);
  }

  /** Une bouffee de bruit filtre : tout ce qui casse ou explose. */
  function souffle(duree, coupureDebut, coupureFin, gain = 1, retard = 0) {
    if (!pret()) return;
    const t = ctx.currentTime + retard;
    const source = ctx.createBufferSource();
    source.buffer = bruit;
    const filtre = ctx.createBiquadFilter();
    filtre.type = 'lowpass';
    filtre.frequency.setValueAtTime(coupureDebut, t);
    filtre.frequency.exponentialRampToValueAtTime(Math.max(40, coupureFin), t + duree);
    const volume = ctx.createGain();
    volume.gain.setValueAtTime(gain, t);
    volume.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    source.connect(filtre);
    filtre.connect(volume);
    volume.connect(maitre);
    source.start(t);
    source.stop(t + duree);
  }

  const sons = {
    bomb: () => note('square', 420, 180, 0.09, 0.5),
    boom: () => {
      souffle(0.42, 1800, 120, 0.9);
      note('sine', 90, 36, 0.3, 0.8);
    },
    brick: () => souffle(0.12, 2600, 700, 0.35),
    item: () => {
      note('triangle', 700, 700, 0.07, 0.4);
      note('triangle', 1050, 1050, 0.09, 0.4, 0.07);
    },
    pick: () => {
      note('square', 620, 620, 0.06, 0.45);
      note('square', 880, 880, 0.06, 0.45, 0.06);
      note('square', 1240, 1240, 0.1, 0.45, 0.12);
    },
    itemgone: () => note('sine', 300, 120, 0.12, 0.3),
    kick: () => note('sawtooth', 240, 520, 0.12, 0.35),
    death: () => {
      note('sawtooth', 420, 60, 0.5, 0.5);
      souffle(0.3, 900, 100, 0.4);
    },
    round: () => {
      note('square', 523, 523, 0.12, 0.4);
      note('square', 659, 659, 0.12, 0.4, 0.12);
      note('square', 784, 784, 0.22, 0.4, 0.24);
    },
    fin: () => {
      const notes = [523, 659, 784, 1046];
      notes.forEach((hauteur, i) => note('square', hauteur, hauteur, 0.18, 0.45, i * 0.11));
    },
  };

  return {
    /** A appeler sur le premier clic : c'est la seule occasion d'ouvrir l'audio. */
    eveiller: demarrer,

    /** Coupe ou remet le son. */
    basculer() {
      actif = !actif;
      if (maitre) maitre.gain.value = actif ? VOLUME : 0;
      return actif;
    },

    get actif() {
      return actif;
    },

    /**
     * Joue ce que raconte un pas de simulation.
     *
     * Les explosions simultanees sont fondues en une seule : une chaine de six
     * bombes jouerait six fois le meme souffle au meme instant, ce qui sature et
     * sonne comme une erreur plutot que comme une grosse explosion.
     *
     * @param {unknown[][]} evenements
     */
    reagir(evenements) {
      if (!actif || evenements.length === 0) return;
      const vus = new Set();
      for (const evenement of evenements) {
        const nom = evenement[0];
        if (nom === 'boom' || nom === 'brick' || nom === 'itemgone') {
          if (vus.has(nom)) continue;
          vus.add(nom);
        }
        if (banque?.jouer(nom, maitre)) continue;
        sons[nom]?.();
      }
    },

    /**
     * Annonce de manche, et musique de fin.
     *
     * Atomic Bomberman n'a pas de jingle de DEBUT de manche : on garde donc le
     * notre, synthetise. Pour la fin, il a trois musiques — gagne, perdu, nul —
     * et ce sont elles qu'on joue.
     *
     * @param {{ type: string, verdict?: { nulle: boolean } }} transition
     */
    transition(transition) {
      const type = typeof transition === 'string' ? transition : transition.type;
      if (type === 'round') {
        banque?.arreterMusique();
        sons.round();
        return;
      }
      if (type === 'score') {
        if (!banque?.musique(transition.verdict?.nulle ? 'nulle' : 'victoire', maitre)) sons.fin();
        return;
      }
      if (type === 'finished') {
        if (!banque?.musique('victoire', maitre)) sons.fin();
      }
    },

    /** Musique du menu, en boucle. Silencieuse si la banque n'est pas la. */
    musiqueDeMenu() {
      banque?.musique('menu', maitre, { boucle: true });
    },

    /** Coupe toute musique en cours. */
    silence() {
      banque?.arreterMusique();
    },
  };
}
