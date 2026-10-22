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
goutte (les bombes shootées rebondissent), la rafale, la flamme d'or (toute la
portée d'un coup) et le paquet mystère. Un bomber qui meurt lâche tout ce qu'il
avait ramassé.

**Une manche dure deux minutes par défaut** — le `playtime` du jeu d'origine —
et la durée se règle de une à cinq minutes dans les Options, l'écran de nouvelle
partie la recopiant à chaque ouverture. Quand il tombe, la sirène sonne deux fois et
*HURRY!* traverse le plateau, puis le terrain se referme : des blocs durs tombent un par un, en spirale, du coin haut
gauche jusqu'au centre, écrasant qui se trouve dessous — chacun avec le bruit
de plaque du jeu d'origine, tiré au sort parmi ses trois variantes. Ce n'est pas un match
nul, c'est une échéance : le sol disparaît jusqu'à ce que la manche se décide
toute seule. Deux bombers qui s'évitent ne s'évitent pas éternellement.

**Le crâne**, lui, ne se ramasse pas : il s'attrape. Colique, mèche courte,
flamme rabougrie, jambes de plomb ou jambes folles, quinze secondes durant. Il
ne touche à aucun bonus — tout revient intact — et surtout il se REFILE : entrez
dans un adversaire et c'est lui qui l'a.

Avec la rafale, un double appui sur la touche des bombes les aligne toutes devant
soi, jusqu'au premier mur. Sans le bonus, le second appui ne pose rien.

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

**Il n'y a pas de « partie réseau » à part.** On ouvre *Nouvelle partie*, et sur
la ligne de chaque joueur on choisit ce qui le pilote : un clavier, une manette,
un bot — ou *En réseau*, c'est-à-dire quelqu'un qui va rejoindre. Dès qu'une
place est confiée au réseau, le code du salon apparaît sous la liste : c'est le
rendez-vous à partager, et c'est la seule différence. *Rejoindre une partie en
réseau* reste à part, puisqu'on y répond à une invitation au lieu de poser la
table.

En ligne, un écran ne tient qu'une place : les autres claviers de la liste
repassent donc en bots. Le code du salon par défaut se règle dans les Options et
sert aussi bien à poser la table qu'à rejoindre.

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

**Les onze décors du jeu sont extraits**, chacun avec son sol peint, ses rochers
et ses briques : *Green Acres*, *Ancient Egypt*, *The Coal Mine*, *Inner City
Trash*… Ils portent les noms que le jeu leur donne, lus dans son `MESSAGES.TXT`,
et l'écran de nouvelle partie les propose — *Au hasard* par défaut, comme le
*Random Each Game* de l'original. Le sol n'est chargé qu'au moment où une partie
le demande : c'est une image par décor, et une partie n'en montre qu'un.

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
