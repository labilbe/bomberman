/**
 * Extraction des sprites d'Atomic Bomberman vers des planches utilisables.
 *
 *   node scripts/extraire-ani.mjs <DATA/ANI> --sortie assets --format svg
 *
 * Le jeu n'est pas fourni : il faut pointer le dossier DATA/ANI de sa propre
 * copie. Rien n'est telecharge, rien n'est committe — le dossier de sortie est
 * exclu par .gitignore, parce que ces sprites restent la propriete d'Interplay.
 *
 * Par defaut les couleurs ne sont PAS reduites : le trace garde les teintes
 * exactes du sprite. `--couleurs N` plafonne la palette a N pour des fichiers
 * plus legers, au prix des degrades.
 *
 * Le format des .ANI n'est documente nulle part ; il a ete reconstitue ici, et
 * les trois modules de scripts/ani/ expliquent chacun la part qu'ils decodent.
 * `--sonde` affiche l'arbre d'un fichier, qui reste le meilleur point de depart
 * pour comprendre le reste.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { lireMorceaux, parcourir, lireEntete } from './ani/chfile.mjs';
import { lireAnimation } from './ani/animation.mjs';
import { encoderPng } from './ani/png.mjs';
import { vectoriser } from './ani/vecteur.mjs';

function options(argv) {
  const o = { source: '', sortie: 'assets', format: 'svg', couleurs: 0, seul: '', sonde: false };
  const reste = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--sonde') o.sonde = true;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
    else reste.push(a);
  }
  o.source = reste[0] ?? o.source;
  o.couleurs = Number(o.couleurs);
  return o;
}

/** Liste les .ANI a traiter : un fichier, ou tout un dossier. */
function fichiers(source, seul) {
  if (extname(source).toLowerCase() === '.ani') return [source];
  return readdirSync(source)
    .filter((n) => /\.ANI$/i.test(n))
    .filter((n) => !seul || n.toUpperCase().includes(seul.toUpperCase()))
    .map((n) => join(source, n));
}

/** Affiche l'arbre des morceaux : le mode d'emploi du format, en une commande. */
function sonder(chemin) {
  const octets = readFileSync(chemin);
  console.log(`${basename(chemin)} — sous-type ${lireEntete(octets).sousType}`);
  for (const { noeud, chemin: niveaux } of parcourir(lireMorceaux(octets))) {
    console.log(`${'  '.repeat(niveaux.length + 1)}${noeud.id} ${noeud.taille} o`);
  }
}

/**
 * Range les images d'un fichier en une planche carree.
 *
 * Une grille plutot qu'une bande : les sprites de bomber font 110 pixels de cote
 * et une bande de quinze images depassait 1600 pixels de large, au-dela de ce
 * que certaines textures acceptent. La grille garde les deux cotes modestes.
 */
function planche(images) {
  const cell = { l: Math.max(...images.map((i) => i.largeur)), h: Math.max(...images.map((i) => i.hauteur)) };
  const colonnes = Math.ceil(Math.sqrt(images.length));
  const lignes = Math.ceil(images.length / colonnes);
  const L = cell.l * colonnes;
  const H = cell.h * lignes;
  const rgba = new Uint8ClampedArray(L * H * 4);

  const cases = images.map((im, k) => {
    const cx = (k % colonnes) * cell.l;
    const cy = Math.floor(k / colonnes) * cell.h;
    for (let y = 0; y < im.hauteur; y += 1) {
      for (let x = 0; x < im.largeur; x += 1) {
        const s = (y * im.largeur + x) * 4;
        if (!im.rgba[s + 3]) continue;
        const d = ((cy + y) * L + cx + x) * 4;
        rgba[d] = im.rgba[s];
        rgba[d + 1] = im.rgba[s + 1];
        rgba[d + 2] = im.rgba[s + 2];
        rgba[d + 3] = 255;
      }
    }
    return { nom: im.nom, x: cx, y: cy, l: im.largeur, h: im.hauteur, ax: im.accrocheX, ay: im.accrocheY };
  });

  return { rgba, L, H, cases };
}

function traiter(chemin, o) {
  const { images, sequences } = lireAnimation(readFileSync(chemin));
  const nom = basename(chemin, extname(chemin)).toLowerCase();
  if (!images.length) return { nom, images: 0 };

  const dossier = join(o.sortie, nom);
  mkdirSync(dossier, { recursive: true });

  const manifeste = { nom, sequences };

  if (o.format === 'png' || o.format === 'les-deux') {
    const { rgba, L, H, cases } = planche(images);
    writeFileSync(join(dossier, `${nom}.png`), encoderPng(rgba, L, H));
    manifeste.planche = { fichier: `${nom}.png`, largeur: L, hauteur: H, cases };
  }

  if (o.format === 'svg' || o.format === 'les-deux') {
    manifeste.vecteurs = images.map((im, k) => {
      const fichier = `${String(k).padStart(3, '0')}.svg`;
      writeFileSync(join(dossier, fichier), vectoriser(im.rgba, im.largeur, im.hauteur, {
        couleurs: o.couleurs,
        titre: im.nom,
      }));
      return { fichier, largeur: im.largeur, hauteur: im.hauteur, accrocheX: im.accrocheX, accrocheY: im.accrocheY };
    });
  }

  writeFileSync(join(dossier, `${nom}.json`), `${JSON.stringify(manifeste, null, 2)}\n`);
  return { nom, images: images.length, sequences: sequences.length };
}

const o = options(process.argv.slice(2));
if (!o.source) {
  console.error('usage : node scripts/extraire-ani.mjs <DATA/ANI> [--sortie assets] [--format svg|png|les-deux] [--couleurs N] [--seul BWALK] [--sonde]');
  process.exit(1);
}

const liste = fichiers(o.source, o.seul);
if (o.sonde) {
  liste.forEach(sonder);
} else {
  let images = 0;
  for (const chemin of liste) {
    const r = traiter(chemin, o);
    images += r.images;
    console.log(`${r.nom.padEnd(12)} ${String(r.images).padStart(4)} images  ${String(r.sequences ?? 0).padStart(3)} sequences`);
  }
  console.log(`\n${liste.length} fichiers, ${images} images, format ${o.format}, vers ${o.sortie}/`);
}
