/**
 * Transport en ligne : les intentions partent, l'arene revient.
 *
 * Il rend exactement ce que rend `creerTransportLocal` — `demarrer`,
 * `intention`, `battre`, les abonnements — pour que `demarrer()` dans main.js
 * ne sache pas lequel des deux il branche. C'est tout l'interet d'avoir pose ce
 * contrat avant d'ecrire le reseau : le rendu, le clavier, les manettes, le son
 * et le tableau de bord n'ont pas une ligne a changer.
 *
 * `battre` NE FAIT RIEN ici, et c'est la seule difference visible entre les deux
 * mondes. En solo la page fait tourner le moteur ; en ligne c'est le relais, et
 * la page n'a plus qu'a recevoir. Elle ne simule rien, ne corrige rien, ne
 * predit rien : elle affiche le dernier etat recu.
 *
 * CE CHOIX A UN PRIX, et il faut le dire. Sans prediction locale, appuyer sur
 * une touche et voir le bomber bouger prend un aller-retour — vingt a quatre-
 * vingts millisecondes selon la distance au relais. Predire aurait demande de
 * rejouer l'etat local a chaque correction du serveur, donc de reconcilier deux
 * simulations qui divergent ; c'est un autre projet, et une autre classe de
 * bugs. Sur une grille ou l'on se deplace d'une case en dix pas, le retard se
 * sent sans gener : on le prefere a un bomber qui se teleporte en arriere.
 */

import { ENTREE_VIDE } from '../engine/entrees.js';
import { creerEtat } from '../engine/etat.js';
import { creerMatch } from '../engine/manche.js';
import { index, dansArene } from '../engine/grille.js';
import { VIDE } from '../engine/constantes.js';
import { NOMS_BONUS } from '../engine/bonus.js';
import { CLIENT, SERVER, encode, decode, REPRISE_MS } from './protocole.js';

/** Nom reseau d'un bonus vers son code, pour relire les evenements du relais. */
const CODE_PAR_NOM = Object.fromEntries(
  Object.entries(NOMS_BONUS).map(([code, nom]) => [nom, Number(code)]),
);

/** Au-dela, on cesse de se reconnecter : le relais ne reviendra pas. */
const RECONNEXIONS_MAX = 6;

/** Attente avant une nouvelle tentative, en millisecondes. */
const ATTENTES = [250, 500, 1000, 2000, 4000, 8000];

/**
 * Met une grille a jour d'apres les evenements du relais.
 *
 * C'est la moitie indispensable du choix de ne pas diffuser la grille trente
 * fois par seconde : le relais n'envoie que ce qui CHANGE, et le client doit
 * donc appliquer ces changements lui-meme.
 *
 * Sans elle, un bonus ramasse restait dessine au sol pour toujours. Le compteur
 * de version ne l'aurait pas rattrape : il ne compte que les ecritures de
 * TUILES, et ramasser un bonus ne touche que le tableau des objets. Une brique
 * detruite, elle, bougeait bien la version — c'est pourquoi les bonus
 * APPARAISSAIENT correctement tout en ne disparaissant jamais.
 *
 * Elle est pure et exportee pour cette raison : c'est une regle, pas de la
 * plomberie, et une regle se verifie sans ouvrir de WebSocket.
 *
 * @param {{ tuiles: Uint8Array, objets: Uint8Array }} etat
 * @param {unknown[][]} liste evenements du pas
 * @returns {number} nombre d'ecritures de TUILES, pour suivre la version du relais
 */
export function suivreGrille(etat, liste) {
  let tuilesEcrites = 0;
  for (const [nom, cx, cy, ...reste] of liste) {
    // `dansArene` et non une simple borne sur l'index : les evenements viennent
    // du reseau, et une abscisse negative tombe dans le tableau tout en
    // designant une AUTRE case — on ecrirait au hasard au lieu de refuser.
    if (!dansArene(cx, cy)) continue;
    const i = index(cx, cy);
    if (nom === 'brick') {
      etat.tuiles[i] = VIDE;
      tuilesEcrites += 1;
    } else if (nom === 'item') {
      etat.objets[i] = CODE_PAR_NOM[reste[0]] ?? 0;
    } else if (nom === 'itemgone' || nom === 'pick') {
      etat.objets[i] = 0;
    }
  }
  return tuilesEcrites;
}

/**
 * @param {{
 *   url: string, salon: string, pseudo: string,
 *   places?: number, format?: number
 * }} options
 */
export function creerTransportEnLigne({ url, salon, pseudo, places = 2, format = 3 }) {
  const vues = new Set();
  const evenements = new Set();
  const transitions = new Set();
  const reseaux = new Set();
  const salons = new Set();

  /** L'arene telle que la page la connait, reconstruite depuis le fil. */
  let etat = null;
  let match = null;
  let moiId = null;
  let miens = [];
  let fil = null;
  let ferme = false;
  let tentatives = 0;
  let sequence = 0;
  /** Derniere intention envoyee, pour ne pas repeter ce que le relais sait deja. */
  let derniere = null;
  /** Numero de version de la grille, pour reperer qu'elle a derive. */
  let version = -1;

  let resoudreDepart = null;
  let departRendu = false;
  const depart = new Promise((resoudre) => {
    resoudreDepart = resoudre;
  });

  const diffuser = (ensemble, ...args) => {
    for (const abonne of ensemble) abonne(...args);
  };
  const dire = (message) => diffuser(reseaux, message ? { message } : null);

  /** Envoie si le fil est ouvert ; sinon laisse tomber, le prochain dira tout. */
  function emettre(message) {
    if (!fil || fil.readyState !== WebSocket.OPEN) return;
    fil.send(encode(message));
  }

  /**
   * Reconstruit l'etat que la scene attend, a partir d'un instantane.
   *
   * On ne recree pas l'objet a chaque trame : la grille et les objets n'y sont
   * pas, et les recopier trente fois par seconde pour rien coûterait plus cher
   * que tout le reste du rendu. On ecrit DANS l'etat existant.
   */
  function appliquer(instant) {
    if (!etat) return;
    etat.pas = instant.t;

    for (const j of instant.j) {
      const joueur = etat.joueurs[j.p];
      if (!joueur) continue;
      joueur.x = j.x;
      joueur.y = j.y;
      joueur.dir = j.d;
      joueur.marche = j.m === 1;
      joueur.vivant = j.e === 1;
      joueur.bombes = j.b;
      joueur.portee = j.f;
      joueur.vitesse = j.s;
      joueur.kick = j.k === 1;
      joueur.detonateur = j.g;
    }

    etat.bombes = instant.b.map((b) => ({
      id: b.i,
      cx: b.x,
      cy: b.y,
      meche: b.m,
      place: b.p,
      portee: 0,
      glisse: b.g ? { dir: b.g.d, x: b.g.x, y: b.g.y } : null,
    }));

    etat.flammes = instant.f.map((f) => ({ cx: f.x, cy: f.y, reste: f.r, place: f.p }));

    // La grille a bouge sans qu'on l'apprenne : on demande qu'on nous la
    // renvoie, plutot que de dessiner une arene qui n'existe plus.
    if (instant.v !== version) {
      version = instant.v;
      emettre({ type: CLIENT.RESYNC, v: version });
    }

    diffuser(vues, etat, match);
  }

  /** Installe une grille complete, recue au debut d'une manche ou en reponse. */
  function poserGrille(message) {
    etat.tuiles = Uint8Array.from(message.tuiles);
    etat.objets = Uint8Array.from(message.objets);
    version = message.v;
    diffuser(vues, etat, match);
  }

  function recevoir(message) {
    if (message.type === SERVER.WAITING) {
      // La salle d'attente a besoin de la LISTE, pas d'une phrase : qui est
      // deja la, et combien de sieges restent vides.
      diffuser(salons, {
        code: message.room,
        assis: message.places,
        total: message.max,
        noms: message.noms ?? [],
      });
      return;
    }

    if (message.type === SERVER.START) {
      moiId = message.moiId;
      miens = message.miens ?? [];
      etat = creerEtat({ graine: 1, places: message.places });
      match = creerMatch({ places: message.places, total: message.format });
      dire('');
      if (!departRendu) {
        departRendu = true;
        resoudreDepart({
          places: message.places,
          format: message.format,
          miens,
          noms: message.noms ?? null,
        });
      }
      return;
    }

    if (message.type === SERVER.ROUND) {
      if (!etat) return;
      poserGrille(message);
      // Les bombes et les flammes d'avant n'ont plus lieu d'etre.
      etat.bombes = [];
      etat.flammes = [];
      if (message.attente > 0) {
        diffuser(transitions, {
          type: 'round',
          manche: message.manche,
          attente: message.attente,
        });
      }
      return;
    }

    if (message.type === SERVER.ARENA) {
      if (etat) poserGrille(message);
      return;
    }

    if (message.type === SERVER.STATE) {
      appliquer(message);
      return;
    }

    if (message.type === SERVER.EVENTS) {
      // Le relais compte une version par ecriture de tuile : on avance du meme
      // pas, sinon chaque brique cassee declencherait une resynchronisation —
      // la grille entiere sur le fil, pour une case qu'on vient d'apprendre.
      if (etat) version += suivreGrille(etat, message.e);
      diffuser(evenements, message.e, message.t);
      return;
    }

    if (message.type === SERVER.SCORE) {
      if (match) match.scores = message.scores.slice();
      diffuser(transitions, {
        type: 'score',
        verdict: message.verdict,
        scores: message.scores,
        manche: message.manche,
      });
      return;
    }

    if (message.type === SERVER.FINISHED) {
      if (match) match.scores = message.scores.slice();
      diffuser(transitions, {
        type: 'finished',
        vainqueur: message.vainqueur,
        scores: message.scores,
      });
      return;
    }

    if (message.type === SERVER.AWAY) {
      dire(`Un joueur s est deconnecte — ${message.secondes} s pour revenir`);
      return;
    }

    if (message.type === SERVER.BACK) {
      dire('');
      return;
    }

    if (message.type === SERVER.LEFT) {
      dire('Un joueur a quitte la partie');
      return;
    }

    if (message.type === SERVER.ERROR) {
      dire(message.message);
    }
  }

  /**
   * Ouvre le fil, et le rouvre s'il tombe.
   *
   * Une connexion qui lache n'est pas une partie perdue : le relais garde la
   * place trente secondes. On se represente donc avec `reprise`, qui demande a
   * reprendre le siege plutot qu'a en obtenir un nouveau.
   */
  function connecter() {
    if (ferme) return;
    const adresse = `${url}?salon=${encodeURIComponent(salon)}`;
    fil = new WebSocket(adresse);

    fil.addEventListener('open', () => {
      tentatives = 0;
      // Le relais ne sait plus ce qu'on voulait : la prochaine intention doit
      // partir meme si elle n'a pas change depuis la coupure.
      derniere = null;
      emettre({
        type: CLIENT.JOIN,
        room: salon,
        name: pseudo,
        places,
        format,
        reprise: moiId ?? undefined,
      });
    });

    fil.addEventListener('message', (evenement) => {
      const message = decode(evenement.data);
      if (message) recevoir(message);
    });

    fil.addEventListener('close', () => {
      if (ferme) return;
      if (tentatives >= RECONNEXIONS_MAX) {
        dire('Connexion au relais perdue.');
        return;
      }
      const attente = ATTENTES[Math.min(tentatives, ATTENTES.length - 1)];
      tentatives += 1;
      dire(`Reconnexion… (${tentatives})`);
      setTimeout(connecter, attente);
    });

    fil.addEventListener('error', () => {
      // `close` suit toujours : on ne traite la reconnexion qu'a un endroit.
    });
  }

  return {
    async demarrer() {
      connecter();
      return depart;
    },

    /**
     * Pousse une intention vers le relais.
     *
     * Le numero de sequence croit a chaque envoi : le relais ignore ce qui lui
     * arrive en retard, ce qui arrive des qu'un paquet double un autre.
     */
    intention(place, entree) {
      if (!miens.includes(place)) return;
      const utile = entree ?? ENTREE_VIDE;

      // ON N ENVOIE QUE CE QUI CHANGE. La boucle de rendu appelle ceci soixante
      // fois par seconde, et la direction reste la meme pendant des dizaines
      // d'images : repeter « je vais toujours a droite » occupe le fil et fait
      // travailler le relais pour rien. Une impulsion, elle, part toujours —
      // elle ne vaut qu'une fois, et la taire serait perdre une bombe.
      const impulsion = utile.poser || utile.declencher;
      if (!impulsion && derniere !== null && derniere.dir === utile.dir) return;
      derniere = { dir: utile.dir };

      sequence += 1;
      emettre({
        type: CLIENT.INPUT,
        siege: place,
        seq: sequence,
        dir: utile.dir,
        bomb: utile.poser,
        det: utile.declencher,
      });
    },

    /**
     * Lance la partie sans attendre que le salon soit plein.
     *
     * N'importe quel joueur assis peut le faire, et le relais comble les places
     * restees vides avec des bots. Attendre un quatrieme qui ne viendra jamais
     * est la facon la plus sure de ne pas jouer.
     */
    commencer() {
      emettre({ type: CLIENT.BEGIN });
    },

    /** Le temps est celui du relais : la page ne simule rien. */
    battre() {},

    surVue(f) {
      vues.add(f);
      return () => vues.delete(f);
    },

    surEvenements(f) {
      evenements.add(f);
      return () => evenements.delete(f);
    },

    surTransition(f) {
      transitions.add(f);
      return () => transitions.delete(f);
    },

    surEtatReseau(f) {
      reseaux.add(f);
      return () => reseaux.delete(f);
    },

    /** Qui attend dans le salon, et combien de places restent. */
    surSalon(f) {
      salons.add(f);
      return () => salons.delete(f);
    },

    fermer() {
      ferme = true;
      emettre({ type: CLIENT.LEAVE });
      if (fil) fil.close();
      vues.clear();
      evenements.clear();
      transitions.clear();
      reseaux.clear();
      salons.clear();
    },

    /** Reserve au debogage : combien de temps il reste pour revenir. */
    get repriseMs() {
      return REPRISE_MS;
    },
  };
}
