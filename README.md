# Atomic Bomberman — clone navigateur

Un clone d'*Atomic Bomberman* (Interplay, 1997) écrit en JavaScript pur : pas de
framework, pas d'étape de build, pas de dépendance au chargement. On ouvre
`index.html` et on joue — seul contre des bots, à deux au clavier, ou jusqu'à dix
dans la même arène, en réseau ou contre des bots.

Le moteur est **le même dans la page et sur le relais**. C'est le choix de fond
du projet : le solo et le réseau jouent exactement aux mêmes règles, et quand une
partie en ligne surprend, le solo sert de référence.

## Jouer

```sh
npm start          # sert la page sur http://localhost:1987
```

Rien à installer pour jouer : `npm start` ne fait que servir des fichiers
statiques. Le dépôt tel quel se dépose aussi sur GitHub Pages sans transformation.

**Commandes**

| Joueur | Déplacer | Bombe | Détonateur / Gant |
| --- | --- | --- | --- |
| 1 | Flèches | Espace | Entrée |
| 2 | Z Q S D | Maj gauche | Ctrl gauche |

À la manette : croix ou stick gauche, **A** pour poser, **B** pour déclencher et
pour frapper. La première manette pilote le joueur 1, la seconde le joueur 2.

**Bonus** — une bombe de plus, une flamme plus longue, de la vitesse, le coup de
pied, le détonateur, le gant rouge (renvoie une bombe par-dessus les murs), le
gant bleu (garde la touche enfoncée pour soulever la bombe et la promener), la
goutte (les bombes shootées rebondissent). Un bomber qui meurt lâche tout ce
qu'il avait ramassé.

Un double appui sur la touche des bombes les aligne toutes devant soi, jusqu'au
premier mur.

## Le réseau

Le relais est un Worker Cloudflare avec un Durable Object par salon : il ne sert
aucun fichier, il arbitre. Les clients lui envoient des intentions (direction,
bombe, détonateur, gant), il fait tourner le moteur et renvoie des instantanés.

```sh
npm run relay                              # wrangler dev sur :8787
npm run deploy                             # wrangler deploy
npm run test:relay                         # un bout en bout contre le relais
```

Pour jouer contre un relais local, ajouter `?relais=ws://localhost:8787/room` à
l'URL de la page.

Créer un salon permet de choisir, place par place, qui sera un humain et qui sera
un bot ; le code du salon par défaut se règle dans les Options et sert aussi bien
à créer qu'à rejoindre.

## Les sprites et les sons

Le jeu sait se passer d'eux : sans fichier extrait, tout est **dessiné et
synthétisé par le code** — c'est le cas d'un dépôt fraîchement cloné, et c'est un
mode de fonctionnement normal, pas un repli dégradé.

Avec votre propre copie d'Atomic Bomberman, deux scripts lisent ses fichiers
d'origine (ANI, CIMG, PCX, RMP, PAL, RSS) et en tirent ce que le moteur utilise :

```sh
node scripts/extract-game.mjs   "<chemin>/DATA/ANI"   # sprites → assets/game
node scripts/extract-sounds.mjs "<chemin>/DATA"       # sons    → assets/sounds
```

Les sprites sortent en SVG, dédoublonnés, avec un `manifest.json` que la page
charge au démarrage ; les couleurs par joueur sont obtenues par rotation de
teinte, à la demande. Les sons sortent en WAV, avec leurs variantes — le jeu
d'origine tire au sort parmi vingt explosions, et une seule finirait par scier.

Ces images et ces sons restent la propriété d'Interplay.

## Comment c'est fait

- `src/engine/` — le moteur, pur, sans DOM : pas à pas fixe à 60 Hz, sous-unités
  entières (1024 par case), RNG `xorshift32` semé. Mêmes entrées + même graine =
  même partie, sur n'importe quelle machine. C'est ce qui rend le réseau et les
  tests possibles.
- `src/render/` — le dessin sur canvas, les sprites vectoriels ou peints au code,
  la palette.
- `src/input/` — clavier et manettes, fondus en une seule intention par place.
- `src/net/` — le protocole et les deux transports : local et en ligne.
- `src/ai/` — les bots : carte de danger, puis décision.
- `src/extraction/` — les lecteurs de formats du jeu d'origine (partagés par les
  scripts).
- `worker/` — le relais : `index.js` route, `room.js` tient un salon.

Arène de 15 × 13 cases, dix places comme le jeu d'origine — les quatre coins,
les quarts des longs côtés, les milieux des petits — matchs au meilleur des 3, 5
ou 7.

## Tests

```sh
npm test           # node --test, sans dépendance
```

Les règles du moteur sont testées sur une arène nue — murs seuls, ni brique ni
bonus tiré au sort — pour qu'une assertion ne dépende jamais de ce que le hasard
a posé là.

## Licence

MIT pour le code de ce dépôt. *Atomic Bomberman*, ses sprites et ses sons
appartiennent à Interplay ; ce projet n'est affilié ni à Interplay ni à Hudson
Soft.
