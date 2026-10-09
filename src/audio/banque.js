/**
 * Banque de sons extraits d'Atomic Bomberman.
 *
 * Deux temps, et c'est ce qui compte ici. Les fichiers sont TELECHARGES au
 * chargement de la page, mais DECODES seulement quand le contexte audio existe
 * — c'est-a-dire au premier geste de l'utilisateur. On ne peut pas faire
 * autrement : `decodeAudioData` a besoin d'un contexte, et un contexte cree sans
 * geste reste bloque en « suspended » pour toute la partie. Separer les deux
 * evite d'attendre le clic pour commencer a telecharger deux megaoctets.
 *
 * Les musiques, elles, ne sont pas telechargees d'avance : la seule qui dure est
 * celle du menu, et il serait absurde de la faire payer a quelqu'un qui clique
 * « Jouer » tout de suite.
 *
 * Chaque role porte PLUSIEURS variantes, parce que le jeu d'origine en a : vingt
 * explosions, treize sons de bonus. A quatre joueurs il part une explosion par
 * seconde, et un son unique deviendrait une scie en une manche.
 */

/** Ou le jeu attend les sons, relativement a la page. */
const DOSSIER = 'assets/sons';

/**
 * Telecharge la banque. Rend `null` si elle n'est pas la.
 *
 * Une absence n'est pas une erreur : un depot fraichement clone n'a pas
 * d'assets, et l'appelant retombe alors sur les sons synthetises.
 */
export async function chargerBanque({ dossier = DOSSIER } = {}) {
  let manifeste;
  try {
    const reponse = await fetch(`${dossier}/manifeste.json`);
    if (!reponse.ok) return null;
    manifeste = await reponse.json();
  } catch {
    return null;
  }

  /** Les octets bruts, par fichier : telecharges une fois, decodes plus tard. */
  const octets = new Map();
  const fichiers = [...new Set(Object.values(manifeste.roles).flat())];
  await Promise.all(fichiers.map(async (fichier) => {
    try {
      const reponse = await fetch(`${dossier}/${fichier}`);
      if (reponse.ok) octets.set(fichier, await reponse.arrayBuffer());
    } catch {
      // Un bruitage manquant se remplace tout seul : le role garde ses autres
      // variantes, et s'il n'en reste aucune l'appelant retombe sur la synthese.
    }
  }));

  /** @type {Map<string, AudioBuffer[]>} */
  const decodes = new Map();
  let contexte = null;

  /**
   * Decode tout ce qui a ete telecharge. A appeler une fois le contexte ouvert.
   *
   * `decodeAudioData` CONSOMME le tampon qu'on lui donne : on en passe donc une
   * copie, sinon un second appel — au rechargement d'une manche, par exemple —
   * trouverait un tampon vide et resterait muet sans rien signaler.
   */
  async function preparer(ctx) {
    if (contexte) return;
    contexte = ctx;
    await Promise.all(Object.entries(manifeste.roles).map(async ([role, liste]) => {
      const tampons = [];
      for (const fichier of liste) {
        const brut = octets.get(fichier);
        if (!brut) continue;
        try {
          tampons.push(await ctx.decodeAudioData(brut.slice(0)));
        } catch {
          // Format refuse par ce navigateur : on continue avec les autres.
        }
      }
      if (tampons.length) decodes.set(role, tampons);
    }));
  }

  let musiqueEnCours = null;

  return {
    preparer,

    /** Le role a-t-il au moins une variante utilisable ? */
    connait(role) {
      return decodes.has(role);
    },

    /**
     * Joue une variante au hasard.
     *
     * Le hasard est ici sans consequence : le son ne touche pas l'etat du jeu,
     * donc deux machines peuvent entendre deux explosions differentes sans que
     * la partie diverge d'un pouce.
     */
    jouer(role, sortie) {
      const tampons = decodes.get(role);
      if (!tampons || !contexte) return false;
      const source = contexte.createBufferSource();
      source.buffer = tampons[Math.floor(Math.random() * tampons.length)];
      source.connect(sortie);
      source.start();
      return true;
    },

    /**
     * Lance une musique, en la telechargeant au premier besoin.
     *
     * @param {string} nom menu, victoire, defaite, nulle
     * @param {{ boucle?: boolean }} options
     */
    async musique(nom, sortie, { boucle = false } = {}) {
      const piste = manifeste.musiques?.[nom];
      if (!piste || !contexte) return false;

      if (!decodes.has(`musique:${nom}`)) {
        try {
          const reponse = await fetch(`${dossier}/${piste.fichier}`);
          if (!reponse.ok) return false;
          decodes.set(`musique:${nom}`, [await contexte.decodeAudioData(await reponse.arrayBuffer())]);
        } catch {
          return false;
        }
      }

      this.arreterMusique();
      const source = contexte.createBufferSource();
      [source.buffer] = decodes.get(`musique:${nom}`);
      source.loop = boucle;
      source.connect(sortie);
      source.start();
      musiqueEnCours = source;
      return true;
    },

    arreterMusique() {
      if (!musiqueEnCours) return;
      try {
        musiqueEnCours.stop();
      } catch {
        // Deja terminee d'elle-meme : rien a arreter.
      }
      musiqueEnCours = null;
    },
  };
}
