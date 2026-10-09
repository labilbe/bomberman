/**
 * Extraction des sons et des musiques d'Atomic Bomberman vers des WAV.
 *
 *   node scripts/extraire-sons.mjs "<DATA>" [--sortie assets/sons]
 *
 * Le jeu range ses 251 bruitages dans DATA/SOUND, en .RSS — du PCM brut, sans
 * en-tete — et leur table dans DATA/RES/SOUNDLST.RES. On ne prend que ce dont
 * le moteur a besoin : un role par evenement, avec ses variantes, tirees de la
 * plage d'identifiants que le jeu reserve a cet usage.
 *
 * Les variantes comptent. Atomic Bomberman a vingt sons d'explosion et treize
 * de bonus ramasse, et les tire au sort : a quatre joueurs, une explosion par
 * seconde, un son unique deviendrait vite une scie.
 *
 * Rien n'est committe : la sortie tombe dans assets/, exclu par .gitignore. Ces
 * sons restent la propriete d'Interplay ; il faut sa propre copie du jeu.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { lireRss, enMono, reechantillonner, versWav, FREQUENCE } from './son/rss.mjs';
import { lireListe, plage } from './son/liste.mjs';

/**
 * Ce que le moteur annonce, et ou le jeu range le son correspondant.
 *
 * Les bornes viennent des commentaires de SOUNDLST.RES, pas d'un choix a nous :
 * c'est le jeu qui declare que 200 a 219 sont des explosions.
 */
const ROLES = {
  bomb: [100, 102], // poser une bombe
  boom: [200, 219], // explosion
  kick: [120, 123], // bombe frappee du pied
  death: [300, 301], // mourir dans les flammes
  pick: [400, 412], // ramasser un bonus
};

/**
 * Les musiques, et ce qu'il faut savoir avant de les chercher.
 *
 * Seules celles-ci existent dans une installation. Les onze musiques de PARTIE
 * — grnacres, hockey, sewer... — sont commentees dans SOUNDLST.RES et absentes
 * du disque : c'etaient des pistes audio du CD, que le jeu lisait directement.
 * Il n'y a donc pas de musique pendant une manche, et ce n'est pas un oubli.
 */
const MUSIQUES = { menu: 1010, victoire: 1020, defaite: 1030, nulle: 1130 };

const argv = process.argv.slice(2);
const source = argv.find((a) => !a.startsWith('--'));
const lire = (nom, defaut) => {
  const k = argv.indexOf(`--${nom}`);
  return k === -1 ? defaut : argv[k + 1];
};
const sortie = lire('sortie', 'assets/sons');
// Par defaut les musiques ne sont PAS touchees : frequence d'origine, vraie
// stereo. Les reduire a 11 kHz mono divisait bien leur poids par quatre, mais
// s'entendait immediatement — et comme elles se chargent a la demande, ce poids
// ne retarde pas l'ouverture de la page. L'option --musique-hz reste la pour
// qui prefere l'echange inverse ; elle moyenne alors la fenetre au lieu de
// prendre un echantillon sur deux, ce que l'ancienne version faisait.
const frequenceMusique = Number(lire('musique-hz', FREQUENCE));

if (!source) {
  console.error('usage : node scripts/extraire-sons.mjs "<DATA>" [--sortie assets/sons] [--musique-hz 11025]');
  process.exit(1);
}

mkdirSync(sortie, { recursive: true });

const table = lireListe(readFileSync(join(source, 'RES', 'SOUNDLST.RES'), 'latin1'));
const dossierSons = join(source, 'SOUND');

/**
 * Convertit un .RSS en WAV.
 *
 * Les BRUITAGES sont replies en mono : leurs deux canaux sont identiques a 99 %
 * — c'est du mono range en stereo — et le jeu les joue au centre. On divise le
 * poids par deux sans rien perdre.
 *
 * Les MUSIQUES, elles, sortent telles quelles : vraie stereo, frequence
 * d'origine, aucun traitement. Elles sont chargees a la demande et non au
 * demarrage, donc leur poids ne coute rien a l'ouverture de la page — les
 * reduire n'achetait rien et s'entendait tout de suite.
 */
function convertir(nom, { frequence = FREQUENCE, mono = true } = {}) {
  const chemin = join(dossierSons, `${nom.toUpperCase()}.RSS`);
  if (!existsSync(chemin)) return null;

  const brut = lireRss(readFileSync(chemin));
  const canaux = mono ? 1 : 2;
  const prepare = mono ? reechantillonner(enMono(brut), FREQUENCE, frequence) : brut;
  const wav = versWav(prepare, { canaux, frequence });

  const fichier = `${nom.toLowerCase()}.wav`;
  writeFileSync(join(sortie, fichier), wav);
  return { fichier, octets: wav.length, secondes: prepare.length / canaux / frequence };
}

const manifeste = { roles: {}, musiques: {} };
const absents = [];
let total = 0;

for (const [role, [premier, dernier]] of Object.entries(ROLES)) {
  const noms = plage(table, premier, dernier);
  const sortis = [];
  for (const nom of noms) {
    const r = convertir(nom);
    if (!r) { absents.push(`${role} : ${nom}.RSS`); continue; }
    sortis.push(r.fichier);
    total += r.octets;
  }
  manifeste.roles[role] = sortis;
}

for (const [role, identifiant] of Object.entries(MUSIQUES)) {
  const nom = table.get(identifiant);
  if (!nom) { absents.push(`musique ${role} : identifiant ${identifiant} absent de la liste`); continue; }
  const r = convertir(nom, { frequence: frequenceMusique, mono: frequenceMusique !== FREQUENCE });
  if (!r) { absents.push(`musique ${role} : ${nom}.RSS`); continue; }
  manifeste.musiques[role] = { fichier: r.fichier, secondes: Number(r.secondes.toFixed(1)) };
  total += r.octets;
}

writeFileSync(join(sortie, 'manifeste.json'), `${JSON.stringify(manifeste, null, 2)}\n`);

const variantes = Object.entries(manifeste.roles).map(([r, v]) => `${r} ${v.length}`).join(', ');
console.log(`${Object.keys(manifeste.roles).length} roles (${variantes}), ${Object.keys(manifeste.musiques).length} musiques`);
console.log(`${(total / 1024 / 1024).toFixed(1)} Mo vers ${sortie}/`);
if (absents.length) console.log(`\nabsents :\n  ${absents.join('\n  ')}`);
