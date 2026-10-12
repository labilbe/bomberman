/**
 * Un salon : l'arene partagee, ses joueurs, et les regles de leur va-et-vient.
 *
 * CE MODULE NE CONNAIT PAS LES WEBSOCKETS. Il recoit des messages deja decodes
 * et rend des ENVOIS — « ce message, a celui-la » — que l'appelant distribue.
 * C'est le meme parti pris que pour le clavier, qui recoit sa cible, et pour les
 * manettes, qui recoivent leur sonde : la logique se teste dans Node, sans
 * plateforme, et c'est ce qui permet de verifier des situations qu'une partie
 * reelle ne produit qu'une fois sur cent — deux joueurs qui se deconnectent au
 * meme pas, un retour a la derniere seconde, un salon qui se vide en pleine
 * manche.
 *
 * LE RELAIS FAIT AUTORITE. Les clients n'envoient que des intentions ; c'est ici
 * que `pasPartie` tourne, et l'etat diffuse est le seul vrai. Un client qui
 * mentirait sur sa position ne serait pas cru, puisqu'on ne lui demande pas sa
 * position. C'est aussi pour ca que le moteur est pur et sans DOM depuis le
 * debut : il tourne ici tel quel, sans adaptation.
 *
 * Ce que le salon NE fait pas : garder une partie en memoire apres le depart du
 * dernier joueur. Un salon vide se ferme, et son code redevient libre.
 */

import { creerPartie, pasPartie, figee } from '../src/engine/partie.js';
import { creerHorloge, avancer } from '../src/engine/horloge.js';
import { creerPilote } from '../src/ai/pilote.js';
import { randomSeed } from '../src/engine/rng.js';
import { ENTREE_VIDE, normaliser } from '../src/engine/entrees.js';
import { tuer, PAR_DEPART, PAR_ABSENCE } from '../src/engine/explosion.js';
import { FORMATS } from '../src/engine/manche.js';
import { TICK_HZ, PAS_HZ } from '../src/engine/constantes.js';
import {
  SERVER,
  CLIENT,
  MIN_PLACES,
  MAX_PLACES,
  REPRISE_MS,
  cleanName,
  nomsDeBots,
} from '../src/net/protocole.js';

/** Un instantane sur deux pas : 30 Hz, comme l'annonce le protocole. */
const PAS_PAR_TICK = Math.round(PAS_HZ / TICK_HZ);

/** Niveaux des adversaires artificiels, dans l'ordre ou on les ajoute. */
const NIVEAUX = ['tranquille', 'normal', 'teigneux'];

/**
 * Compacte une vue de l'arene pour le fil.
 *
 * Les noms sont courts a dessein : cet objet part trente fois par seconde et par
 * joueur. `j` pour joueurs, `b` pour bombes, `f` pour flammes — c'est ecrit dans
 * le protocole, et c'est la seule endroit du projet ou l'on abrege.
 *
 * La GRILLE n'y est pas. Elle ne change qu'a la destruction d'une brique, donc
 * l'envoyer trente fois par seconde serait du gaspillage pur : le client la
 * recoit entiere a chaque manche, la met a jour sur les evenements, et demande
 * un renvoi si sa version ne colle plus.
 */
function instantane(etat) {
  return {
    t: etat.pas,
    v: etat.version,
    j: etat.joueurs.map((joueur) => ({
      p: joueur.place,
      x: joueur.x,
      y: joueur.y,
      d: joueur.dir,
      m: joueur.marche ? 1 : 0,
      e: joueur.vivant ? 1 : 0,
      b: joueur.bombes,
      f: joueur.portee,
      s: joueur.vitesse,
      k: joueur.kick ? 1 : 0,
      g: joueur.detonateur,
    })),
    b: etat.bombes.map((bombe) => ({
      i: bombe.id,
      x: bombe.cx,
      y: bombe.cy,
      m: bombe.meche,
      p: bombe.place,
      g: bombe.glisse ? { d: bombe.glisse.dir, x: bombe.glisse.x, y: bombe.glisse.y } : null,
    })),
    f: etat.flammes.map((flamme) => ({
      x: flamme.cx,
      y: flamme.cy,
      r: flamme.reste,
      p: flamme.place,
    })),
  };
}

/** La grille complete, pour un debut de manche ou une resynchronisation. */
const grilleDe = (etat) => ({
  v: etat.version,
  tuiles: Array.from(etat.tuiles),
  objets: Array.from(etat.objets),
});

/**
 * Cree un salon vide.
 *
 * @param {{ code: string, maintenant: number, graine?: number }} options
 */
export function creerSalon({ code, maintenant, graine = randomSeed() }) {
  /** @type {Map<string, { id: string, nom: string, place: number|null, present: boolean, partiA: number|null }>} */
  const membres = new Map();
  /** Pilotes des places tenues par un bot, indexes par place. */
  const pilotes = {};
  /** Derniere intention connue de chaque place, consommee a chaque pas. */
  const intentions = [];
  /** Numero du dernier message d'intention accepte, par place : l'ordre compte. */
  const sequences = [];

  let partie = null;
  let horloge = null;
  let places = MIN_PLACES;
  let format = FORMATS[0];
  let compteur = 0;

  const envois = [];
  const aTous = (message) => envois.push({ pour: null, message });
  const aLui = (id, message) => envois.push({ pour: id, message });
  const vider = () => envois.splice(0, envois.length);

  /** Les humains presents, dans l'ordre de leur place. */
  const humains = () => [...membres.values()].filter((m) => m.place !== null);

  /** Prenoms donnes aux bots, par place. */
  const nomsDeBot = {};

  /**
   * Les noms affiches, par place : humains et bots confondus.
   *
   * Une place encore libre vaut `null`, et non « Place 3 ». La salle d'attente
   * a besoin de distinguer les deux pour montrer qui manque ; un libelle de
   * remplissage l'aurait affichee comme un joueur deja assis.
   */
  function noms() {
    const liste = Array.from({ length: places }, () => null);
    for (const membre of humains()) liste[membre.place] = membre.nom;
    for (const [place, nom] of Object.entries(nomsDeBot)) liste[place] = nom;
    return liste;
  }

  /**
   * Installe un bot sur une place libre, avec un prenom qu'aucun autre n'a.
   *
   * Deux bots homonymes rendraient le tableau des scores illisible, et le
   * decalage par le compteur de manches evite que deux parties de suite
   * alignent exactement les memes adversaires.
   */
  function ajouterBot() {
    const place = placeLibre();
    if (place === null) return false;
    const rang = Object.keys(pilotes).length;
    pilotes[place] = creerPilote({ niveau: NIVEAUX[rang % NIVEAUX.length] });
    nomsDeBot[place] = nomsDeBots(rang + 1, compteur)[rang];
    return true;
  }

  /** La premiere place libre, ou null si le salon est plein. */
  function placeLibre() {
    const prises = new Set([...humains().map((m) => m.place), ...Object.keys(pilotes).map(Number)]);
    for (let place = 0; place < places; place += 1) if (!prises.has(place)) return place;
    return null;
  }

  const complet = () => placeLibre() === null;

  function annoncerAttente() {
    aTous({
      type: SERVER.WAITING,
      room: code,
      places: humains().length + Object.keys(pilotes).length,
      min: MIN_PLACES,
      max: places,
      noms: noms(),
    });
  }

  /**
   * Lance la partie.
   *
   * Les places vides sont comblees par des bots : une arene a moitie peuplee se
   * joue mal, et personne n'a envie d'attendre qu'un quatrieme arrive.
   */
  function demarrer(maintenantMs) {
    while (ajouterBot());

    partie = creerPartie({ graine, places, format });
    horloge = creerHorloge(maintenantMs);
    intentions.length = 0;
    sequences.length = 0;
    for (let place = 0; place < places; place += 1) {
      intentions[place] = { ...ENTREE_VIDE };
      sequences[place] = -1;
    }

    for (const membre of humains()) {
      aLui(membre.id, {
        type: SERVER.START,
        room: code,
        moiId: membre.id,
        miens: [membre.place],
        places,
        format: partie.format,
        noms: noms(),
      });
    }
    aTous({ type: SERVER.ROUND, manche: partie.manche, graine: partie.etat.graine, attente: partie.depart, ...grilleDe(partie.etat) });
  }

  /** Les entrees du pas : humains tels quels, bots calcules a l'instant. */
  function entreesDuPas() {
    const entrees = [];
    for (let place = 0; place < places; place += 1) {
      const pilote = pilotes[place];
      if (pilote) {
        entrees[place] = pilote(partie.etat, place);
        continue;
      }
      const voulue = intentions[place] ?? ENTREE_VIDE;
      entrees[place] = { ...voulue };
      voulue.poser = false;
      voulue.declencher = false;
    }
    return entrees;
  }

  /**
   * Elimine un joueur absent depuis trop longtemps.
   *
   * On ne l'elimine pas a la coupure : un Wi-Fi hoquette, un telephone change
   * d'antenne. Mais on ne laisse pas non plus les autres attendre sans fin — la
   * partie continue pendant son absence, et son bomber reste simplement immobile.
   */
  function verifierAbsents(maintenantMs) {
    for (const membre of membres.values()) {
      if (membre.present || membre.partiA === null || membre.place === null) continue;
      if (maintenantMs - membre.partiA < REPRISE_MS) continue;
      if (partie && !partie.fini) {
        const joueur = partie.etat.joueurs.find((j) => j.place === membre.place);
        if (joueur) tuer(partie.etat, joueur, PAR_ABSENCE);
      }
      aTous({ type: SERVER.LEFT, place: membre.place });
      membres.delete(membre.id);
    }
  }

  return {
    get code() {
      return code;
    },

    /** Y a-t-il encore quelqu'un ? Un salon vide se ferme. */
    get vivant() {
      return membres.size > 0;
    },

    /** La partie a-t-elle commence ? */
    get lancee() {
      return partie !== null;
    },

    /**
     * Un client se presente.
     *
     * @returns {{ pour: string|null, message: object }[]}
     */
    rejoindre(id, message, maintenantMs = maintenant) {
      vider();

      // Une reprise : le joueur revient sur sa place, la partie n'a pas bouge.
      const repris = message.reprise ? membres.get(String(message.reprise)) : null;
      if (repris && !repris.present) {
        repris.present = true;
        repris.partiA = null;
        membres.delete(repris.id);
        repris.id = id;
        membres.set(id, repris);
        aTous({ type: SERVER.BACK, place: repris.place });
        if (partie) {
          aLui(id, {
            type: SERVER.START,
            room: code,
            moiId: id,
            miens: [repris.place],
            places,
            format: partie.format,
            noms: noms(),
          });
          aLui(id, {
            type: SERVER.ROUND,
            manche: partie.manche,
            graine: partie.etat.graine,
            attente: 0,
            ...grilleDe(partie.etat),
          });
        }
        return envois.slice();
      }

      if (partie) {
        aLui(id, { type: SERVER.ERROR, message: 'La partie a deja commence dans ce salon.' });
        return envois.slice();
      }

      // Le premier arrive fixe le format du salon : les suivants le rejoignent
      // tel quel, plutot que de le voir changer sous leurs yeux.
      if (membres.size === 0) {
        places = Math.min(MAX_PLACES, Math.max(MIN_PLACES, Number(message.places) || MIN_PLACES));
        format = FORMATS.includes(Number(message.format)) ? Number(message.format) : FORMATS[0];
      }

      const place = placeLibre();
      if (place === null) {
        aLui(id, { type: SERVER.ERROR, message: 'Ce salon est complet.' });
        return envois.slice();
      }

      membres.set(id, {
        id,
        nom: cleanName(message.name),
        place,
        present: true,
        partiA: null,
      });

      annoncerAttente();
      // Salon plein : on part, sans attendre que quelqu'un appuie.
      if (complet()) demarrer(maintenantMs);
      return envois.slice();
    },

    /** Un message quelconque d'un client deja connu. */
    message(id, message, maintenantMs = maintenant) {
      vider();
      const membre = membres.get(id);
      if (!membre) return envois.slice();

      if (message.type === CLIENT.BEGIN) {
        if (partie) return envois.slice();
        if (humains().length < 1) return envois.slice();
        demarrer(maintenantMs);
        return envois.slice();
      }

      if (message.type === CLIENT.BOT) {
        if (partie) return envois.slice();
        if (!ajouterBot()) return envois.slice();
        annoncerAttente();
        if (complet()) demarrer(maintenantMs);
        return envois.slice();
      }

      if (message.type === CLIENT.INPUT) {
        if (!partie || membre.place === null) return envois.slice();
        // Les intentions peuvent se doubler sur le fil : on ignore celles qui
        // arrivent en retard plutot que de revenir en arriere.
        const seq = Number(message.seq);
        if (!Number.isFinite(seq) || seq <= sequences[membre.place]) return envois.slice();
        sequences[membre.place] = seq;
        const entree = normaliser({ dir: message.dir, poser: message.bomb, declencher: message.det });
        const voulue = intentions[membre.place];
        intentions[membre.place] = {
          dir: entree.dir,
          // Une impulsion en attente ne se perd pas si deux messages arrivent
          // entre deux pas de simulation.
          poser: voulue.poser || entree.poser,
          declencher: voulue.declencher || entree.declencher,
        };
        return envois.slice();
      }

      if (message.type === CLIENT.RESYNC) {
        if (partie) aLui(id, { type: SERVER.ARENA, ...grilleDe(partie.etat) });
        return envois.slice();
      }

      if (message.type === CLIENT.LEAVE) {
        return this.partir(id, maintenantMs, { volontaire: true });
      }

      return envois.slice();
    },

    /**
     * Un client s'en va, ou sa connexion tombe.
     *
     * La nuance compte : un depart volontaire elimine tout de suite, une
     * coupure laisse trente secondes pour revenir.
     */
    partir(id, maintenantMs = maintenant, { volontaire = false } = {}) {
      vider();
      const membre = membres.get(id);
      if (!membre) return envois.slice();

      if (!partie) {
        membres.delete(id);
        if (membres.size > 0) annoncerAttente();
        return envois.slice();
      }

      if (volontaire) {
        const joueur = partie.etat.joueurs.find((j) => j.place === membre.place);
        if (joueur && !partie.fini) tuer(partie.etat, joueur, PAR_DEPART);
        aTous({ type: SERVER.LEFT, place: membre.place });
        membres.delete(id);
        return envois.slice();
      }

      membre.present = false;
      membre.partiA = maintenantMs;
      aTous({
        type: SERVER.AWAY,
        place: membre.place,
        secondes: Math.round(REPRISE_MS / 1000),
      });
      return envois.slice();
    },

    /**
     * Fait avancer le temps, et rend ce qu'il faut diffuser.
     *
     * C'est ici que tourne `pasPartie`, exactement comme dans la page en solo :
     * meme moteur, meme enchainement de manches, meme regles de fin de match.
     */
    battre(maintenantMs) {
      vider();
      verifierAbsents(maintenantMs);
      if (!partie || partie.fini) return envois.slice();

      const avance = avancer(horloge, maintenantMs);
      horloge = avance.horloge;

      const evenements = [];
      for (let i = 0; i < avance.pas; i += 1) {
        const resultat = pasPartie(partie, entreesDuPas());
        if (resultat.evenements.length > 0) {
          for (const evenement of resultat.evenements) evenements.push(evenement);
        }
        if (resultat.transition) {
          const transition = resultat.transition;
          if (transition.type === 'round') {
            compteur += 1;
            aTous({ type: SERVER.ROUND, ...transition, ...grilleDe(partie.etat) });
          } else if (transition.type === 'score') {
            aTous({ type: SERVER.SCORE, ...transition });
          } else if (transition.type === 'finished') {
            aTous({ type: SERVER.FINISHED, ...transition });
          }
        }
      }

      if (evenements.length > 0) {
        aTous({ type: SERVER.EVENTS, t: partie.etat.pas, e: evenements });
      }

      // L'instantane ne part qu'un pas sur deux, et jamais pendant que l'arene
      // est figee : rien n'y bouge, il n'y a rien a dire.
      if (avance.pas > 0 && !figee(partie) && partie.etat.pas % PAS_PAR_TICK === 0) {
        aTous({ type: SERVER.STATE, ...instantane(partie.etat) });
      }

      return envois.slice();
    },

    /** Reserve aux tests : l'etat vivant du relais. */
    get partie() {
      return partie;
    },
  };
}
