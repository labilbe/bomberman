/**
 * Tableau de bord : qui joue, avec quoi, et ou en est le match.
 *
 * En DOM et non dans le canvas. Le canvas est agrandi d'un facteur entier pour
 * garder des pixels nets ; du texte agrandi de la meme facon serait illisible.
 * Et le DOM donne gratuitement ce qu'il aurait fallu reecrire : le texte
 * selectionnable, les lecteurs d'ecran, et un reflow qui marche sur telephone.
 *
 * Le HUD ne lit jamais les regles : on lui passe l'etat et le match, il affiche.
 */

import { couleurDePlace } from '../render/palette.js';
import { BOMBES_MAX, FLAMME_MAX, VITESSE_BASE, VITESSE_PALIER } from '../engine/constantes.js';

/**
 * @param {HTMLElement} racine
 */
export function creerHud(racine) {
  /** @type {Map<number, { bloc: HTMLElement, manches: HTMLElement, pouvoirs: HTMLElement }>} */
  const lignes = new Map();

  function construire(places, noms) {
    racine.textContent = '';
    lignes.clear();
    for (let place = 0; place < places; place += 1) {
      const couleur = couleurDePlace(place);
      const bloc = document.createElement('div');
      bloc.className = 'joueur';
      bloc.style.setProperty('--couleur', couleur.vive);

      const ligneNom = document.createElement('div');
      ligneNom.className = 'nom';
      const nom = document.createElement('span');
      nom.textContent = noms?.[place] ?? `Joueur ${place + 1}`;
      const manches = document.createElement('span');
      manches.className = 'manches';
      ligneNom.append(nom, manches);

      const pouvoirs = document.createElement('div');
      pouvoirs.className = 'pouvoirs';

      bloc.append(ligneNom, pouvoirs);
      racine.append(bloc);
      lignes.set(place, { bloc, manches, pouvoirs });
    }
  }

  /** Les pouvoirs d'un bomber, en une ligne lisible d'un coup d'oeil. */
  function pouvoirsDe(joueur) {
    const vitesse = 1 + Math.round((joueur.vitesse - VITESSE_BASE) / VITESSE_PALIER);
    const morceaux = [
      `<span>Bombes <b>${joueur.bombes}${joueur.bombes >= BOMBES_MAX ? ' max' : ''}</b></span>`,
      `<span>Flamme <b>${joueur.portee}${joueur.portee >= FLAMME_MAX ? ' max' : ''}</b></span>`,
      `<span>Vitesse <b>${vitesse}</b></span>`,
    ];
    if (joueur.kick) morceaux.push('<span class="actif">Kick</span>');
    if (joueur.detonateur) morceaux.push('<span class="actif">Detonateur</span>');
    return morceaux.join('');
  }

  return {
    construire,

    /**
     * @param {import('../engine/etat.js').Etat} etat
     * @param {import('../engine/manche.js').Match} match
     */
    rafraichir(etat, match) {
      for (const joueur of etat.joueurs) {
        const ligne = lignes.get(joueur.place);
        if (!ligne) continue;
        ligne.bloc.classList.toggle('mort', !joueur.vivant);
        const gagnees = match?.scores?.[joueur.place] ?? 0;
        const aGagner = match?.aGagner ?? 0;
        ligne.manches.textContent =
          aGagner > 0 ? '★'.repeat(gagnees) + '·'.repeat(Math.max(0, aGagner - gagnees)) : '';
        ligne.pouvoirs.innerHTML = pouvoirsDe(joueur);
      }
    },
  };
}

/**
 * Banniere plein cadre : manche, score, fin de match.
 *
 * @param {HTMLElement} element
 */
export function creerBanniere(element) {
  let minuteur = null;

  function cacher() {
    element.hidden = true;
    element.textContent = '';
  }

  return {
    cacher,

    /**
     * @param {{ titre: string, detail?: string, duree?: number, boutons?: { texte: string, action: () => void }[] }} contenu
     */
    montrer({ titre, detail = '', duree = 0, boutons = [] }) {
      if (minuteur) clearTimeout(minuteur);
      element.textContent = '';
      const t = document.createElement('div');
      t.className = 'titre';
      t.textContent = titre;
      element.append(t);
      if (detail) {
        const d = document.createElement('div');
        d.className = 'detail';
        d.textContent = detail;
        element.append(d);
      }
      for (const bouton of boutons) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'primaire';
        b.textContent = bouton.texte;
        b.addEventListener('click', bouton.action);
        element.append(b);
      }
      element.hidden = false;
      if (duree > 0) minuteur = setTimeout(cacher, duree);
    },
  };
}
