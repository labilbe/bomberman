/**
 * Extraction des seuls sprites dont le moteur se sert, vers des SVG.
 *
 *   node scripts/extraire-jeu.mjs "<DATA/ANI>" [--sortie assets/jeu] [--terrain 0..10]
 *
 * `extraire-ani.mjs` sort tout le corpus — 2327 images, une trentaine de
 * megaoctets en SVG. Le jeu n'en utilise qu'une fraction, et c'est celle-la
 * qu'on veut charger dans le navigateur. Ce script fait le tri d'apres une table
 * de roles, et surtout il DEDOUBLONNE : une sequence d'Atomic Bomberman fait des
 * aller-retours dans ses images (la bombe pulse sur 18 pas pour 10 images), donc
 * on ecrit une image par source et le manifeste n'y renvoie que par son indice.
 *
 * Par defaut les couleurs ne sont PAS reduites : le trace garde les teintes
 * exactes du sprite, donc ses degrades. `--couleurs N` plafonne la palette a N
 * si l'on prefere des fichiers legers — a seize teintes le casque perd son
 * reflet et le torse ses demi-tons, pour environ 40 % de poids en moins.
 *
 * Rien n'est committe : la sortie tombe dans assets/, exclu par .gitignore. Ces
 * sprites restent la propriete d'Interplay ; il faut sa propre copie du jeu.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { lireAnimation } from './ani/animation.mjs';
import { vectoriser } from './ani/vecteur.mjs';
import { decoderPcx } from './ani/pcx.mjs';
import { encoderPng } from './ani/png.mjs';
import { lireCouleursJoueurs } from './ani/remap.mjs';

/**
 * Ce que le moteur demande, et ou le jeu le range.
 *
 * Les quatre directions suivent la numerotation du moteur — HAUT, DROITE, BAS,
 * GAUCHE — et pas l'ordre dans lequel le fichier les stocke, qui commence a
 * l'est. Les noms d'Atomic Bomberman sont tous en « green » parce que le jeu
 * recolorait le bomber vert par joueur au moment du rendu ; on fait pareil, dans
 * le chargeur.
 */
const DIRECTIONS = ['north', 'east', 'south', 'west'];

/**
 * Table des roles, pour un terrain donne.
 *
 * Elle depend du terrain parce que le decor va par jeux complets : le terrain 3
 * a ses propres rochers, ses propres briques et sa propre animation de brique
 * qui tombe, dans TILES3 et XBRICK3. Garder le decor du terrain 0 sous un sol de
 * sable donnerait un plateau qui n'existe dans aucune partie.
 */
const rolesDe = (terrain) => ({
  sol: [`TILES${terrain}.ANI`, `tile ${terrain} blank`],
  mur: [`TILES${terrain}.ANI`, `tile ${terrain} solid`],
  brique: [`TILES${terrain}.ANI`, `tile ${terrain} brick`],
  briqueCasse: [`XBRICK${terrain}.ANI`, `flame brick ${terrain}`],
  bombe: ['BOMBS.ANI', 'bomb regular green'],
  bombeDetonateur: ['TRIGBOMB.ANI', 'bomb trigger green'],
  mort: ['XPLODE1.ANI', 'die green 1'],

  flammeCentre: ['FLAME.ANI', 'flame center green'],
  ...Object.fromEntries(DIRECTIONS.flatMap((d, k) => [
    [`flammeMilieu${k}`, ['FLAME.ANI', `flame mid${d} green`]],
    [`flammeBout${k}`, ['FLAME.ANI', `flame tip${d} green`]],
  ])),

  ...Object.fromEntries(DIRECTIONS.flatMap((d, k) => [
    [`marche${k}`, ['WALK.ANI', `walk ${d}`]],
    [`immobile${k}`, ['STAND.ANI', `stand ${d}`]],
  ])),

  // Les noms du moteur a gauche, ceux du jeu a droite : « speed » est un
  // patin a roulettes chez Interplay, « kick » une chaussure.
  bonusBomb: ['POWERS.ANI', 'power bomb'],
  bonusFlame: ['POWERS.ANI', 'power flame'],
  bonusSpeed: ['POWERS.ANI', 'power skate'],
  bonusKick: ['POWERS.ANI', 'power kicker'],
  bonusTrigger: ['POWERS.ANI', 'power trigger'],
});

const argv = process.argv.slice(2);
const source = argv.find((a) => !a.startsWith('--'));
const lire = (nom, defaut) => {
  const k = argv.indexOf(`--${nom}`);
  return k === -1 ? defaut : argv[k + 1];
};
const sortie = lire('sortie', 'assets/jeu');
const couleurs = Number(lire('couleurs', 0));
const terrain = Number(lire('terrain', 0));

if (!source) {
  console.error('usage : node scripts/extraire-jeu.mjs "<DATA/ANI>" [--sortie assets/jeu] [--couleurs N] [--terrain 0..10]');
  process.exit(1);
}

mkdirSync(sortie, { recursive: true });

/**
 * Geometrie du sol dans les images FIELD*.PCX, relevee sur FIELD0.
 *
 * L'herbe commence a (15, 66) et ses bandes claires et sombres alternent toutes
 * les 36 pixels, soit une par rangee de la grille. On decoupe donc DEUX rangees
 * sur toute la largeur du terrain : cette bande se repete verticalement sans
 * couture, et horizontalement elle ne se repete pas du tout.
 */
const SOL = { x: 15, y: 66, largeur: 600, hauteur: 72 };

/**
 * Decoupe le sol du terrain demande.
 *
 * Le sol du jeu d'origine n'est pas une tuile : c'est une image peinte de
 * 640 x 480 par terrain. La tuile « tile N blank » des .ANI est une autre herbe,
 * a pois, qui ne ressemble pas au fond — la recopier 195 fois donnait un damier
 * que le jeu n'a jamais eu.
 *
 * Et ce sol sort en PNG, seule exception au tout-vectoriel : c'est du bruit
 * pixel par pixel, qui se vectorise en 765 ko de minuscules taches contre 3,6 ko
 * de PNG, pour un dessin qui ne gagne rien a etre agrandi.
 */
function decouperSol() {
  const fichier = join(source, '..', 'RES', `FIELD${terrain}.PCX`);
  const champ = decoderPcx(readFileSync(fichier));
  const { x, y, largeur, hauteur } = SOL;
  const rgba = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let l = 0; l < hauteur; l += 1) {
    for (let c = 0; c < largeur; c += 1) {
      const s = ((y + l) * champ.largeur + (x + c)) * 4;
      const d = (l * largeur + c) * 4;
      rgba[d] = champ.rgba[s];
      rgba[d + 1] = champ.rgba[s + 1];
      rgba[d + 2] = champ.rgba[s + 2];
      rgba[d + 3] = 255;
    }
  }
  writeFileSync(join(sortie, 'sol.png'), encoderPng(rgba, largeur, hauteur));
  return { fichier: 'sol.png', largeur, hauteur, terrain };
}

/**
 * L'ecran-titre du jeu, pour le fond de la page d'accueil.
 *
 * On prend TITLE.PCX et non MAINMENU.PCX : le second porte deja ses propres
 * libelles — « Start Game », « Options »... — qui se liraient en transparence
 * derriere notre formulaire. Le titre, lui, n'est qu'une illustration.
 */
function decouperAccueil() {
  const fichier = join(source, '..', 'RES', 'TITLE.PCX');
  if (!existsSync(fichier)) return null;
  const image = decoderPcx(readFileSync(fichier));
  writeFileSync(join(sortie, 'accueil.png'), encoderPng(image.rgba, image.largeur, image.hauteur));
  return { fichier: 'accueil.png', largeur: image.largeur, hauteur: image.hauteur };
}

/** Cache des fichiers .ANI deja ouverts : TILES0 et FLAME servent plusieurs roles. */
const ouverts = new Map();
function ouvrir(fichier) {
  if (!ouverts.has(fichier)) ouverts.set(fichier, lireAnimation(readFileSync(join(source, fichier))));
  return ouverts.get(fichier);
}

const images = [];
const indexParSource = new Map();
const roles = {};
const manquants = [];

for (const [role, [fichier, sequence]] of Object.entries(rolesDe(terrain))) {
  let animation;
  try {
    animation = ouvrir(fichier);
  } catch {
    manquants.push(`${role} : ${fichier} introuvable`);
    continue;
  }

  const seq = animation.sequences.find((s) => s.nom === sequence);
  if (!seq) {
    manquants.push(`${role} : sequence "${sequence}" absente de ${fichier}`);
    continue;
  }

  roles[role] = seq.pas.map((pas) => {
    const cle = `${fichier}#${pas.image}`;
    let indice = indexParSource.get(cle);
    if (indice === undefined) {
      const image = animation.images[pas.image];
      indice = images.length;
      const nomFichier = `${String(indice).padStart(3, '0')}.svg`;
      writeFileSync(join(sortie, nomFichier), vectoriser(image.rgba, image.largeur, image.hauteur, {
        couleurs,
        titre: `${sequence} ${pas.image}`,
      }));
      images.push({
        fichier: nomFichier,
        largeur: image.largeur,
        hauteur: image.hauteur,
        // Le point d'accroche est en bas au centre chez Atomic Bomberman : c'est
        // lui qui pose le sprite sur sa case, pas le coin de l'image.
        accrocheX: image.accrocheX,
        accrocheY: image.accrocheY,
      });
      indexParSource.set(cle, indice);
    }
    return { image: indice, duree: pas.duree };
  });
}

const tuile = images[indexParSource.get(`TILES${terrain}.ANI#0`)] ?? images[0];
const sol = decouperSol();
const accueil = decouperAccueil();
// Les dix couleurs de joueur, lues dans les tables du jeu.
const couleursJoueur = lireCouleursJoueurs(join(source, '..', '..'));
writeFileSync(join(sortie, 'manifeste.json'), `${JSON.stringify({
  tuile: { largeur: tuile.largeur, hauteur: tuile.hauteur },
  sol,
  accueil,
  couleursJoueur,
  images,
  roles,
}, null, 2)}\n`);

console.log(`${Object.keys(roles).length} roles, ${images.length} images uniques, sol du terrain ${terrain}, vers ${sortie}/`);
console.log(`${couleursJoueur.length} couleurs de joueur lues dans COLOR.PAL et les .RMP`);
if (manquants.length) console.log(`\nmanquants :\n  ${manquants.join('\n  ')}`);
