/**
 * Le relais, cote Cloudflare : la plomberie, et rien d'autre.
 *
 * Tout ce qui est une REGLE vit dans `salon.js`, qui ne connait ni WebSocket ni
 * Durable Object et se teste donc dans Node. Ce fichier-ci ne fait que trois
 * choses : router une connexion vers le salon de son code, transformer des
 * trames en messages, et battre la mesure. Si une partie se comporte mal, ce
 * n'est presque jamais ici qu'il faut regarder.
 *
 * UN SALON = UN DURABLE OBJECT. C'est ce qui rend l'arene partagee possible :
 * les Workers ordinaires sont sans memoire et repartis sur toute la planete,
 * deux joueurs du meme salon tomberaient sur deux instances differentes et
 * joueraient chacun dans son coin. Un Durable Object, lui, est unique pour un
 * nom donne — le code du salon — et tient la partie en memoire.
 *
 * Le code du salon est NORMALISE avant de nommer l'objet, par la meme fonction
 * que la page utilise : sans quoi « essai » et « ESSAI » seraient deux parties
 * differentes, et deux amis qui se recopient un code a l'oral ne se
 * retrouveraient jamais.
 */

import { creerSalon } from './salon.js';
import { PAS_HZ } from '../src/engine/constantes.js';
import { encode, decode, CLIENT, cleanRoom } from '../src/net/protocole.js';

/** Periode du battement, en millisecondes. Le salon rattrape les retards. */
const BATTEMENT_MS = Math.round(1000 / PAS_HZ);

/**
 * Un salon vivant, avec ses connexions.
 *
 * Le nom de la classe est en francais comme le reste du code ; seul le
 * protocole est en anglais, parce que lui voyage sur le fil.
 */
export class SalonDurable {
  constructor(state) {
    this.state = state;
    this.salon = null;
    /** @type {Map<string, WebSocket>} */
    this.fils = new Map();
    this.battement = null;
  }

  /** Distribue des envois : `pour: null` veut dire « a tout le monde ». */
  diffuser(envois) {
    for (const { pour, message } of envois) {
      const trame = encode(message);
      if (pour === null) {
        for (const fil of this.fils.values()) this.envoyer(fil, trame);
        continue;
      }
      const fil = this.fils.get(pour);
      if (fil) this.envoyer(fil, trame);
    }
  }

  /**
   * Envoie, en avalant l'echec.
   *
   * Un socket peut mourir entre le moment ou l'on decide d'ecrire et celui ou
   * l'on ecrit. Laisser l'exception remonter couperait la diffusion aux autres
   * joueurs, pour une raison qui ne les concerne pas.
   */
  envoyer(fil, trame) {
    try {
      fil.send(trame);
    } catch {
      // Le `close` qui suivra fera le menage.
    }
  }

  /**
   * Demarre le battement, s'il ne bat pas deja.
   *
   * Il ne tourne QUE quand quelqu'un est connecte. Un salon vide qui continue
   * de simuler consommerait sans fin, et le Durable Object ne s'endormirait
   * jamais.
   */
  battre() {
    if (this.battement !== null) return;
    this.battement = setInterval(() => {
      if (!this.salon) return;
      this.diffuser(this.salon.battre(Date.now()));
      if (!this.salon.vivant) this.arreter();
    }, BATTEMENT_MS);
  }

  arreter() {
    if (this.battement === null) return;
    clearInterval(this.battement);
    this.battement = null;
    this.salon = null;
  }

  async fetch(requete) {
    if (requete.headers.get('Upgrade') !== 'websocket') {
      return new Response('Ce point d entree attend une WebSocket.', { status: 426 });
    }

    const url = new URL(requete.url);
    const code = cleanRoom(url.searchParams.get('salon') ?? '');
    if (!code) return new Response('Code de salon manquant.', { status: 400 });

    if (!this.salon) this.salon = creerSalon({ code, maintenant: Date.now() });

    const paire = new WebSocketPair();
    const [client, serveur] = Object.values(paire);
    serveur.accept();

    const id = crypto.randomUUID();
    this.fils.set(id, serveur);

    serveur.addEventListener('message', (evenement) => {
      const message = decode(evenement.data);
      if (!message || !this.salon) return;
      const envois = message.type === CLIENT.JOIN
        ? this.salon.rejoindre(id, message, Date.now())
        : this.salon.message(id, message, Date.now());
      this.diffuser(envois);
      if (this.salon.lancee) this.battre();
    });

    const fermer = () => {
      this.fils.delete(id);
      if (!this.salon) return;
      this.diffuser(this.salon.partir(id, Date.now()));
      // Plus personne : on coupe le battement sans attendre qu'il s'en
      // apercoive, pour que l'objet puisse s'endormir.
      if (this.fils.size === 0) this.arreter();
    };
    serveur.addEventListener('close', fermer);
    serveur.addEventListener('error', fermer);

    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  /**
   * Route une connexion vers le salon de son code.
   *
   * `idFromName` est la cle de voute : deux connexions portant le meme code
   * tombent sur le MEME objet, ou qu'elles soient dans le monde.
   */
  async fetch(requete, env) {
    const url = new URL(requete.url);

    if (url.pathname === '/sante') {
      return new Response('ok', { headers: { 'Content-Type': 'text/plain' } });
    }

    if (url.pathname !== '/salon') {
      return new Response('Relais Bomberman. Le jeu se connecte sur /salon?salon=CODE.', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const code = cleanRoom(url.searchParams.get('salon') ?? '');
    if (!code) return new Response('Code de salon manquant.', { status: 400 });

    const identifiant = env.SALONS.idFromName(code);
    return env.SALONS.get(identifiant).fetch(requete);
  },
};
