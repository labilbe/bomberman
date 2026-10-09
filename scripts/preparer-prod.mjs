/**
 * Assemble le dossier a deployer, assets compris.
 *
 *   node scripts/preparer-prod.mjs [--sortie dist-prive]
 *
 * Ce dossier part sur un hebergement PROTEGE PAR AUTHENTIFICATION, et c'est la
 * seule facon d'y mettre les fichiers extraits du jeu. Ils appartiennent a
 * Interplay : les servir depuis une URL ouverte reviendrait a les redistribuer,
 * alors qu'un acces restreint reste l'usage de sa propre copie.
 *
 * C'est aussi pour cela que la page publique, sur GitHub Pages, ne les a pas et
 * ne doit pas les avoir : elle tourne sur les sprites dessines au code et les
 * sons synthetises. Les deux cibles n'ont pas le meme contenu, volontairement.
 *
 * On ne copie que ce que la page sert reellement. Les tests et les outils
 * d'extraction n'ont rien a faire en production : ils ne sont jamais demandes
 * par le navigateur, et les laisser publierait la moitie du depot pour rien.
 */

import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const k = argv.indexOf('--sortie');
const sortie = k === -1 ? 'dist-prive' : argv[k + 1];

/** Ce que le navigateur demande, et rien d'autre. */
const CONTENU = ['index.html', 'style.css', 'favicon.svg', 'fond-accueil.svg', 'src', 'assets'];

await rm(sortie, { recursive: true, force: true });
await mkdir(sortie, { recursive: true });

const manquants = [];
for (const entree of CONTENU) {
  if (!existsSync(entree)) {
    manquants.push(entree);
    continue;
  }
  await cp(entree, join(sortie, entree), { recursive: true });
}

/** Compte les fichiers et les octets d'un dossier, recursivement. */
async function peser(dossier) {
  let fichiers = 0;
  let octets = 0;
  for (const entree of await readdir(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) {
      const sous = await peser(chemin);
      fichiers += sous.fichiers;
      octets += sous.octets;
    } else {
      fichiers += 1;
      octets += (await stat(chemin)).size;
    }
  }
  return { fichiers, octets };
}

const { fichiers, octets } = await peser(sortie);
console.log(`${fichiers} fichiers, ${(octets / 1024 / 1024).toFixed(1)} Mo vers ${sortie}/`);

const avecAssets = existsSync(join(sortie, 'assets', 'jeu', 'manifeste.json'));
console.log(avecAssets
  ? 'assets du jeu : PRESENTS — ce dossier ne doit partir que derriere authentification'
  : 'assets du jeu : absents — extrais-les d abord avec extraire-jeu.mjs et extraire-sons.mjs');

if (manquants.length) console.log(`\nmanquants :\n  ${manquants.join('\n  ')}`);
