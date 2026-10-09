import test from 'node:test';
import assert from 'node:assert/strict';

import { decider, creerMemoire, creerPilote, REFLEXE_PAS } from '../src/ai/pilote.js';
import { carteDanger, fuite, parcourir, SUR } from '../src/ai/danger.js';
import { creerPartie, pasPartie } from '../src/engine/partie.js';
import { poser } from '../src/engine/bombes.js';
import { pas } from '../src/engine/pas.js';
import { index, caseAxe, caseDe, estLibre } from '../src/engine/grille.js';
import { MECHE_PAS, VECTEURS } from '../src/engine/constantes.js';
import { areneNue, brique, placer, entree } from './aide.js';

test('la carte de danger couvre le souffle et s arrete aux murs', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 3);
  joueur.portee = 2;
  poser(etat, joueur);
  const danger = carteDanger(etat);

  assert.equal(danger[index(3, 3)], MECHE_PAS, 'la case de la bombe');
  assert.equal(danger[index(5, 3)], MECHE_PAS, 'a deux cases, dans la portee');
  assert.equal(danger[index(6, 3)], SUR, 'au-dela de la portee');
  // (2,2) est un pilier du damier : rien ne passe au travers.
  assert.equal(danger[index(1, 1)], SUR);
});

test('une brique arrete le souffle, donc le danger', () => {
  const etat = areneNue();
  brique(etat, 4, 3);
  const joueur = placer(etat, 0, 3, 3);
  joueur.portee = 4;
  poser(etat, joueur);
  const danger = carteDanger(etat);
  assert.equal(danger[index(5, 3)], SUR, 'derriere la brique, on est a l abri');
});

test('un refuge est une case que rien ne menace, pas une case ou l on arrive a temps', () => {
  // Le piege historique : la case de la bombe elle-meme est atteignable « a
  // temps » puisqu'on y est deja, et une meche dure deux secondes et demie.
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 3);
  poser(etat, joueur);
  const sortie = fuite(etat, joueur, carteDanger(etat));
  assert.ok(sortie, 'il doit exister une sortie dans une arene nue');
  assert.equal(sortie.sur, true);
  assert.ok(sortie.distance > 0, 'rester sur sa bombe n est pas une fuite');
  assert.ok(sortie.dir >= 0);
});

test('le parcours evite les cases menacees quand on le lui demande', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 3, 3);
  joueur.portee = 2;
  poser(etat, joueur);
  const danger = carteDanger(etat);

  const libre = parcourir(etat, 3, 5);
  const prudent = parcourir(etat, 3, 5, { evite: danger });
  assert.ok(libre.distance[index(3, 1)] > 0, 'sans garde-fou, on passe par le souffle');
  assert.equal(prudent.distance[index(3, 1)], -1, 'avec garde-fou, le passage est coupe');
});

test('un bot pose sur une case menacee s en eloigne', () => {
  const etat = areneNue({ places: 2 });
  const joueur = placer(etat, 0, 3, 3);
  poser(etat, joueur);

  const { entree: intention } = decider(etat, 0, creerMemoire());
  assert.ok(intention.dir >= 0, 'il doit choisir une direction');
  const v = VECTEURS[intention.dir];
  const danger = carteDanger(etat);
  // La direction choisie doit mener hors du souffle, ou vers une case plus sure.
  const voisine = danger[index(3 + v.dx, 3 + v.dy)];
  assert.ok(voisine >= danger[index(3, 3)], 'il ne doit pas aller vers le pire');
});

test('un bot ne pose pas de bombe dans un cul-de-sac dont il est le fond', () => {
  // Couloir d une case, ferme : poser ici, c est mourir.
  const etat = areneNue({ places: 2 });
  brique(etat, 1, 2);
  brique(etat, 2, 1);
  const joueur = placer(etat, 0, 1, 1);

  const { entree: intention } = decider(etat, 0, creerMemoire());
  assert.equal(intention.poser, false, 'aucune sortie : aucune bombe');
});

test('un bot pose quand une brique est a portee et qu il peut fuir', () => {
  const etat = areneNue({ places: 2 });
  brique(etat, 4, 3);
  placer(etat, 0, 3, 3);
  const { entree: intention } = decider(etat, 0, creerMemoire());
  assert.equal(intention.poser, true);
});

test('decider est pure : elle ne touche pas l etat et se repete', () => {
  const etat = areneNue({ places: 2 });
  brique(etat, 5, 3);
  placer(etat, 0, 3, 3);
  const avant = JSON.stringify({
    tuiles: [...etat.tuiles],
    objets: [...etat.objets],
    joueurs: etat.joueurs,
    bombes: etat.bombes,
    rng: etat.rng,
  });

  const memoire = creerMemoire();
  const un = decider(etat, 0, memoire);
  const deux = decider(etat, 0, memoire);

  assert.deepEqual(un.entree, deux.entree, 'meme etat et meme memoire, meme intention');
  assert.deepEqual(un.memoire, deux.memoire);
  assert.equal(
    JSON.stringify({
      tuiles: [...etat.tuiles],
      objets: [...etat.objets],
      joueurs: etat.joueurs,
      bombes: etat.bombes,
      rng: etat.rng,
    }),
    avant,
    'l etat ne doit pas avoir bouge',
  );
});

test('entre deux decisions, le bot tient son cap sans reposer de bombe', () => {
  const etat = areneNue({ places: 2 });
  brique(etat, 4, 3);
  placer(etat, 0, 3, 3);
  let memoire = creerMemoire();
  const premier = decider(etat, 0, memoire);
  memoire = premier.memoire;
  assert.equal(premier.entree.poser, true);

  for (let i = 1; i < REFLEXE_PAS; i += 1) {
    pas(etat, entree(0, {}));
    const suivant = decider(etat, 0, memoire);
    assert.equal(suivant.entree.poser, false, 'la pose est une impulsion, jamais tenue');
    assert.equal(suivant.entree.dir, memoire.dir, 'le cap est tenu');
  }
});

test('un bot mort ne demande plus rien', () => {
  const etat = areneNue({ places: 2 });
  etat.joueurs[0].vivant = false;
  const { entree: intention } = decider(etat, 0, creerMemoire());
  assert.deepEqual(intention, { dir: -1, poser: false, declencher: false });
});

test('quatre bots jouent une partie entiere sans s enliser', () => {
  // Le vrai juge de l IA : des matchs complets, reproductibles, ou l on compte
  // ce qui se passe. Les seuils sont larges a dessein — c'est un garde-fou
  // contre les regressions grossieres, pas un concours de force.
  let finis = 0;
  let briquesCassees = 0;
  let morts = 0;
  let propres = 0;
  let nulles = 0;
  let manches = 0;

  const MATCHS = 40;
  for (let n = 0; n < MATCHS; n += 1) {
    const partie = creerPartie({ graine: 5000 + n * 13, places: 4, format: 3 });
    const pilotes = [0, 1, 2, 3].map((i) =>
      creerPilote({ niveau: ['tranquille', 'normal', 'teigneux', 'normal'][i] }),
    );
    for (let i = 0; i < 60 * 240 && !partie.fini; i += 1) {
      const proprios = new Map(partie.etat.bombes.map((bombe) => [bombe.id, bombe.place]));
      const resultat = pasPartie(
        partie,
        pilotes.map((pilote, place) => pilote(partie.etat, place)),
      );
      const explosions = resultat.evenements
        .filter((evenement) => evenement[0] === 'boom')
        .map((evenement) => proprios.get(evenement[1]));
      for (const evenement of resultat.evenements) {
        if (evenement[0] === 'brick') briquesCassees += 1;
        if (evenement[0] !== 'death') continue;
        morts += 1;
        if (explosions.length > 0 && explosions.every((place) => place === evenement[1])) {
          propres += 1;
        }
      }
      if (resultat.transition?.type === 'score') {
        manches += 1;
        if (resultat.transition.verdict.nulle) nulles += 1;
      }
    }
    if (partie.fini) finis += 1;
  }

  // Pas « tous », mais « presque tous », et le seuil vient de la mesure : sur
  // 100 matchs simules, 98 se terminent. Les deux qui restent sont deux
  // survivants prudents qui tournent l un autour de l autre jusqu a la fin du
  // temps — un equilibre instable, tres sensible a la graine. Exiger 12 sur 12
  // faisait donc echouer le test sur une seule graine malchanceuse.
  //
  // A noter : avec la portee de depart a UNE case, 100 matchs sur 100 se
  // terminaient. Passer a deux — la valeur d Atomic Bomberman — coute ces 2 %.
  assert.ok(finis / MATCHS >= 0.9, `trop de matchs enlises : ${MATCHS - finis}/${MATCHS}`);
  assert.ok(briquesCassees > MATCHS * 20, `trop peu de briques cassees : ${briquesCassees}`);
  assert.ok(propres / morts < 0.25, `trop de bots tues par leur propre bombe : ${propres}/${morts}`);
  assert.ok(nulles / Math.max(1, manches) < 0.5, `trop de manches nulles : ${nulles}/${manches}`);
});

test('la fuite ne traverse pas une case qui brulera avant qu on en sorte', () => {
  // Un couloir long, une bombe sous les pieds : le seul refuge est au bout, et
  // tout le trajet passe dans le souffle. Le bot doit refuser d'y aller plutot
  // que de partir et exploser en chemin — c'est le defaut qui causait un mort
  // sur cinq, la fuite cherchant le refuge le plus proche sans jamais verifier
  // qu'on y arrivait a temps.
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 1);
  joueur.portee = 9;
  // Une vitesse de tortue : meme la case voisine n'est plus atteignable a temps.
  joueur.vitesse = 8;
  poser(etat, joueur);

  const sortie = fuite(etat, joueur, carteDanger(etat));
  assert.equal(sortie, null, 'aucune fuite ne doit etre proposee');
});

test('la fuite rend un refuge quand il est atteignable a temps', () => {
  const etat = areneNue();
  const joueur = placer(etat, 0, 1, 1);
  joueur.portee = 1;
  poser(etat, joueur);

  const sortie = fuite(etat, joueur, carteDanger(etat));
  assert.ok(sortie, 'une sortie existe');
  assert.equal(sortie.sur, true, 'et elle mene hors de danger');
  const pasParCase = Math.ceil(1024 / joueur.vitesse);
  assert.ok(sortie.distance * pasParCase < MECHE_PAS, 'atteignable avant l explosion');
});

test('un bot ne meurt presque jamais de sa propre bombe', () => {
  // La verification qui compte vraiment : on fait jouer quatre bots et on compte
  // les morts sur sa propre bombe. Avant la fuite datee, il y en avait UNE SUR
  // CINQ — c'etait le defaut le plus visible de cette IA.
  let suicides = 0;
  let morts = 0;

  /** La case (x, y) est-elle dans la croix d'une bombe, murs compris ? */
  const dansLaCroix = (etat, bombe, x, y) => {
    if (bombe.x === x && bombe.y === y) return true;
    for (const v of VECTEURS) {
      for (let k = 1; k <= bombe.portee; k += 1) {
        const cx = bombe.x + v.dx * k;
        const cy = bombe.y + v.dy * k;
        if (!estLibre(caseDe(etat, cx, cy))) break;
        if (cx === x && cy === y) return true;
      }
    }
    return false;
  };

  for (let graine = 1; graine <= 60; graine += 1) {
    const etat = creerPartie({ graine, places: 4 }).etat;
    const pilotes = [0, 1, 2, 3].map(() => creerPilote({ niveau: 'normal' }));
    const derniere = [null, null, null, null];

    for (let t = 0; t < 60 * 60 && etat.joueurs.filter((j) => j.vivant).length > 1; t += 1) {
      const entrees = etat.joueurs.map((j, k) => (j.vivant ? pilotes[k](etat, k) : undefined));
      pas(etat, entrees);
      for (const ev of etat.evenements) {
        if (ev[0] === 'bomb') {
          const poseur = etat.joueurs.find((j) => j.place === ev[3]);
          derniere[ev[3]] = { x: ev[1], y: ev[2], portee: poseur.portee, pas: etat.pas };
        }
        if (ev[0] !== 'death') continue;
        morts += 1;
        const mien = derniere[ev[1]];
        const mort = etat.joueurs.find((j) => j.place === ev[1]);
        if (!mien || etat.pas - mien.pas > MECHE_PAS + 30) continue;
        if (dansLaCroix(etat, mien, caseAxe(mort.x), caseAxe(mort.y))) suicides += 1;
      }
    }
  }

  assert.ok(morts > 100, `echantillon trop maigre : ${morts} morts`);
  // Le seuil n'est pas zero, et la raison est ecrite dans danger.js : la carte
  // de danger ne simule pas les CHAINES. Une bombe prise dans l'explosion d'une
  // autre part avant la fin de sa meche, et le bot qui comptait sur ce delai se
  // fait prendre. C'est un choix assume — simuler les chaines couterait une file
  // par appel, soixante fois par seconde et par bot.
  //
  // Les mesures : 21 % avant la fuite datee, 2,6 % apres sur 600 morts, et 4,3 %
  // sur l'echantillon plus court de ce test. Le seuil est donc a 8 % — assez
  // haut pour ne pas clignoter d'une graine a l'autre, assez bas pour qu'un
  // retour a l'ancienne fuite le fasse echouer largement.
  const part = suicides / morts;
  assert.ok(part < 0.08, `${suicides} morts sur sa propre bombe sur ${morts} (${Math.round(part * 100)} %)`);
});
