# PlayCook

Plateforme de mini-jeux à jouer entre amis dans le navigateur : un salon, un
code à 4 lettres, et des jeux qui se branchent dessus.

Trois jeux pour l'instant :

- **Qui a mis ça ?** — un blind-test où chacun choisit 3 à 5 morceaux, puis où
  il faut deviner qui a mis quoi.
- **Qui regarde ça ?** — le même, en séries et en films : chacun met 3 à 5
  titres, affiche à l'écran, et on devine qui regarde quoi.
- **Qui dans le groupe ?** — une question par manche, chacun désigne un joueur,
  la majorité l'emporte. Les points vont à ceux qui ont vu venir le groupe.

## Lancer

```bash
npm install
npm start          # http://localhost:3000
```

Ouvre l'adresse dans plusieurs onglets (ou plusieurs appareils) pour tester.
Le premier joueur crée la partie, les autres rejoignent avec le code à 4 lettres.

Pour jouer avec des gens qui ne sont pas sur ton réseau, expose le port 3000 :
`npx localtunnel --port 3000`, ngrok, ou un déploiement sur Render / Fly.io.

## Clé TMDB (pour « Qui regarde ça ? »)

Ce jeu cherche les séries et les films chez [TMDB](https://www.themoviedb.org),
qui demande une clé — gratuite, mais il faut un compte :

1. créer un compte sur themoviedb.org, puis **Paramètres → API** ;
2. demander une clé (usage personnel, le formulaire est court) ;
3. la passer au serveur dans `TMDB_API_KEY` (clé v3) ou `TMDB_TOKEN` (jeton v4
   « Read Access ») — sur Render, dans **Environment**.

```bash
TMDB_API_KEY=xxxxxxxx npm start
```

Sans clé, les deux autres jeux fonctionnent normalement ; « Qui regarde ça ? »
reste visible mais sa recherche répond « clé TMDB absente », et le serveur le
signale au démarrage.

## Architecture

Le découpage sépare **ce qui est commun à tous les jeux** de **ce qui est propre
à un jeu**. Rien d'autre.

```
server.js                   point d'entrée : HTTP + Socket.IO, trois lignes
core/
  platform.js               salons, phases communes, diffusion, contexte des jeux
  rooms.js                  modèle salon/joueur : codes, reconnexion, hôte
  registry.js               catalogue : la seule liste des jeux installés
  env.js                    lecture des variables d'environnement
games/
  _shared/
    devine-qui.js           moteur « chacun soumet, on devine qui »
  blindtest/
    server.js               ce qui est propre à la musique
    deezer.js               proxy Deezer : recherche et signature des extraits
  qui-regarde-ca/
    server.js               ce qui est propre aux séries et aux films
    tmdb.js                 proxy TMDB : recherche films + séries, affiches
  qui-dans-le-groupe/
    server.js               règles (WRITING / VOTING / REVEAL)
    questions.js            banque de questions par défaut
public/
  index.html                coquille : accueil, création, salon, #game-root, scores
  style.css
  core/
    app.js                  client plateforme : vitrine, salon, chargement du jeu
    dom.js, clock.js, sound.js
  games/_shared/devine-qui.js          moteur commun, côté écran
  games/blindtest/client.js            pré-écoute + audio synchronisé
  games/qui-regarde-ca/client.js       affiches
  games/qui-dans-le-groupe/client.js   questions et votes
tests/
  sim.js … sim6.js          simulations de parties, sans navigateur
  simdom.js                 monte les clients dans un DOM headless
```

**La plateforme possède trois phases** : `LOBBY` → `GAME` → `SCORES`. Elle tient
les joueurs, les scores, le drapeau « prêt », l'hôte, les reconnexions, la
synchro d'horloge et le son. Elle ne sait rien des règles.

**Un jeu possède ses propres phases**, à l'intérieur de `GAME`. Il reçoit un
contexte (`ctx`) et ne touche jamais aux sockets : il lit l'état, le modifie,
appelle `ctx.update()`, et la plateforme diffuse à chacun la vue qui lui revient.

**Deux jeux partagent le même moteur.** « Qui a mis ça ? » et « Qui regarde
ça ? » sont la même mécanique — chacun soumet en secret, puis on devine qui a
choisi quoi — sur deux sources différentes. Elle vit dans
`games/_shared/devine-qui.js` (et son pendant écran dans
`public/games/_shared/`). Chaque jeu ne déclare que ses différences :

| | Qui a mis ça ? | Qui regarde ça ? |
|---|---|---|
| Source | Deezer | TMDB |
| Élément | un morceau | une série ou un film |
| Avant la manche | resigner l'URL d'extrait | rien |
| Pendant la manche | 30 s d'écoute synchronisée | 20 s pour regarder l'affiche |

Résultat : 114 lignes pour le blind-test et 108 pour les séries, au lieu de
331 lignes dupliquées. Un bug de décompte corrigé une fois l'est pour les deux.

## Ajouter un jeu

Trois fichiers, une ligne à modifier.

**1. `games/<id>/server.js`** — les règles :

```js
export const meta = {
  id: 'imposteur',
  name: "L'imposteur",
  tagline: 'Tout le monde a le même mot, sauf un.',
  icon: '🕵️',                       // affiché sur la vignette du menu
  rules: ['...', '...'],            // dépliable depuis la vignette
  minPlayers: 3,
  maxPlayers: 12,
};

export function create(ctx) {
  let phase = 'INDICES';

  return {
    start() { /* mise en place */ },

    // Ce que CE joueur a le droit de voir. Le reste ne quitte pas le serveur.
    view(playerId) {
      return { phase, monMot: mots[playerId] };
    },

    // Une action de joueur, routée depuis le client sur `type`.
    action(type, playerId, data) {
      if (type === 'vote') { /* ... */ ctx.update(); }
    },

    onJoin(playerId) {},   // optionnel : arrivée ou reconnexion en cours de partie
    onLeave(playerId) {},  // optionnel
    stop() { ctx.clearTimer(); },
  };
}

// optionnel : routes HTTP propres au jeu
export function routes(app) { app.get('/api/imposteur/mots', ...); }
```

Ce que `ctx` fournit :

| Catégorie | Méthodes |
|---|---|
| Joueurs | `players()`, `connected()`, `pseudo(id)`, `has(id)`, `isHost(id)`, `hostId()` |
| Scores | `award(id, n)` — la plateforme tient le compte |
| Prêt | `ready(id)`, `setReady(id, v)`, `allReady()`, `notReady()` |
| Temps | `now()`, `setTimer(ms, fn)`, `clearTimer()` |
| Sorties | `update()`, `fail(id, msg)`, `finish()` |
| Divers | `uid()`, `shuffle(arr)` |

`setTimer` ne garde qu'un timer par salon : en poser un annule le précédent, ce
qui évite les doubles enchaînements quand l'hôte force un passage.

**2. `public/games/<id>/client.js`** — l'interface :

```js
export default {
  id: 'imposteur',
  mount(root, api) { /* construit le DOM une fois dans root */ },
  render(view, api) { /* appelé à chaque état reçu */ },
  unmount() { /* timers, audio */ },
};
```

`api` donne `emit(type, data)`, `ready(v)`, `me`, `isHost`, `players`, `state`,
`now()` (horloge serveur), `sound`, `toast()`, `el()`, `esc()`.

**3. `core/registry.js`** — importer le module et l'ajouter au tableau.

**Raccourci** : si le jeu est du type « chacun soumet des trucs, on devine qui
les a mis », n'écris pas tout ça — reprends `games/_shared/devine-qui.js` comme
le font les deux premiers jeux. Tu ne déclares alors que la source, la
validation d'un élément et ce qu'on en affiche.

C'est tout : le jeu apparaît automatiquement dans le menu principal et dans le
salon, l'hôte peut le choisir, et le client charge `/games/<id>/client.js` à la
volée.

**Le choix du jeu précède la partie.** L'accueil est une vitrine : il présente
PlayCook puis liste les jeux, chacun avec son icône, son résumé, son nombre de
joueurs et ses règles dépliables. On clique sur un jeu, on donne son pseudo, et
la partie est créée avec ce jeu. La liste vient de `GET /api/games`, la seule
route consultable sans salon — la page d'accueil n'a pas besoin d'une partie
pour s'afficher.

Rejoindre se fait depuis le même écran, avec le code : pas de choix de jeu à
faire, c'est celui de l'hôte. Et une fois dans le salon, l'hôte peut encore
changer de jeu tant que rien n'a démarré ; les autres voient les mêmes
vignettes, sans pouvoir cliquer.

## Réglages

Tout se surcharge par variable d'environnement, sans toucher au code :

```bash
LEAD_MS=1500 VOTE_MS=20000 REVEAL_MS=6000 MERGE_DUPLICATES=true npm start
```

| Variable | Défaut | Rôle |
|---|---|---|
| `MIN_TRACKS` / `MAX_TRACKS` | 3 / 5 | morceaux par joueur |
| `MERGE_DUPLICATES` | `false` | `false` : un même morceau choisi par deux joueurs passe **deux fois**. `true` : il passe une fois avec **deux bonnes réponses** |
| `LEAD_MS` | 3000 | délai de préchargement avant le top départ synchronisé |
| `VOTE_MS` | 30000 | durée du tour — le morceau va toujours jusqu'au bout |
| `REVEAL_MS` | 0 | `0` : l'hôte décide quand passer au suivant. Une valeur > 0 enchaîne automatiquement après ce délai |
| `POINTS_CORRECT` | 100 | points pour une bonne réponse |
| `POINTS_FOOLED` | 50 | points au propriétaire par joueur piégé |

Ceux de « Qui regarde ça ? » :

| Variable | Défaut | Rôle |
|---|---|---|
| `TMDB_API_KEY` / `TMDB_TOKEN` | — | clé TMDB, voir plus haut |
| `TMDB_LANG` | `fr-FR` | langue des titres et des affiches |
| `QRC_MIN_ITEMS` / `QRC_MAX_ITEMS` | 3 / 5 | titres par joueur |
| `QRC_MERGE_DUPLICATES` | `false` | même logique que `MERGE_DUPLICATES` |
| `QRC_ROUND_MS` | 20000 | temps d'affichage d'un titre |
| `QRC_REVEAL_MS` | 0 | `0` : l'hôte enchaîne lui-même |
| `QRC_POINTS_CORRECT` / `QRC_POINTS_FOOLED` | 100 / 50 | points |

Ceux de « Qui dans le groupe ? » :

| Variable | Défaut | Rôle |
|---|---|---|
| `QDG_ROUNDS` | 8 | questions jouées dans une partie |
| `QDG_CUSTOM_MAX` | 2 | questions qu'un joueur peut ajouter avant la partie |
| `QDG_VOTE_MS` | 25000 | temps par question — la manche se ferme dès que tout le monde a voté |
| `QDG_REVEAL_MS` | 0 | `0` : l'hôte enchaîne lui-même |
| `QDG_POINTS` | 100 | points par vote conforme à la majorité |

Chaque jeu déclare les siens dans son propre fichier, avec les helpers de
`core/env.js` : la plateforme n'a pas à connaître la liste.

## Déployer

Ce serveur garde l'état des parties **en mémoire** et tient des connexions
WebSocket ouvertes. Deux conséquences :

- **Pas de serverless.** Vercel, Netlify Functions et Cloudflare Workers ne
  conviennent pas : il faut un processus Node qui vit en continu.
- **Une seule instance.** Deux répliques signifient deux jeux de parties
  distincts, et un joueur qui atterrit sur la mauvaise ne trouve pas son code.
  Pour scaler il faudrait l'adaptateur Redis de Socket.IO et des sessions
  persistantes ; inutile pour un jeu entre amis.

Un redémarrage ou un redéploiement efface toutes les parties en cours. C'est
acceptable ici — personne ne joue 24h/24 — mais à savoir.

Sur Render (plan gratuit) : connecter le dépôt GitHub, type **Web Service**,
build `npm install`, start `npm start`. Le port est fourni par la variable
`PORT`, que `server.js` lit déjà.

## Comment ça marche

**Le serveur est la seule source de vérité.** Le champ `ownerIds` d'un morceau
ne quitte jamais `games/blindtest/server.js` avant la révélation : `view()`
construit une vue différente pour chaque joueur et n'y met que ce qu'il a le
droit de voir. Ouvrir l'onglet réseau du navigateur ne donne aucun avantage.

**Source audio : l'API Deezer** (`api.deezer.com`), sans clé ni compte, extraits
de 30 secondes. Spotify ne convient plus (`preview_url` est `null` pour toute
application créée après le 27 novembre 2024), et Apple renvoie des 403 depuis les
IP d'hébergeur, quel que soit le débit.

**Les URL d'extrait Deezer sont signées et expirent en ~15 minutes.** Elles ne
sont donc jamais stockées ni envoyées au navigateur : le serveur ne garde que
l'identifiant du morceau et resigne l'URL juste avant chaque lecture — à chaque
manche pour la partie, à chaque clic sur ▶ pour la phase de sélection. Sans ça,
les dernières manches d'une longue partie seraient muettes.

Le débit sortant est encadré : cache d'une heure sur les métadonnées, file qui
espace les appels, et quarantaine d'une minute si la source refuse.

**Synchronisation du son.** Le serveur annonce un instant de départ absolu
(`startAt`). Chaque client estime d'abord son décalage d'horloge avec le serveur
(5 allers-retours, médiane), précharge l'extrait, puis programme la lecture.
Décalage résiduel : quelques dizaines de millisecondes. L'horloge et le lecteur
appartiennent à la plateforme : tout jeu qui fait du son en hérite.

**Autoplay.** Les navigateurs refusent de jouer du son sans interaction
préalable. Le premier clic n'importe où dans la page débloque le contexte audio
via un échantillon silencieux.

**Volume.** Réglage local à chaque joueur, conservé dans `localStorage` d'une
partie à l'autre. Sur iOS le volume est matériel et `audio.volume` n'a aucun
effet : le curseur est détecté comme inopérant et masqué plutôt que d'afficher
une commande morte.

**Écoute pendant la sélection.** Un bouton ▶ sur chaque résultat de recherche et
sur chaque morceau de sa propre liste, sur un canal audio distinct de celui de la
partie, arrêté dès qu'on quitte la phase de sélection. Les métadonnées envoyées
au client ne concernent que ses propres morceaux : la sélection des autres reste
entièrement côté serveur.

**Déroulement d'un tour.** Le morceau joue toujours `VOTE_MS` en entier, même
quand tout le monde a déjà voté : les votes sont enregistrés au fil de l'eau
mais n'interrompent jamais la lecture. L'écran de révélation qui suit affiche le
propriétaire, le détail des votes, et le classement mis à jour avec les points
gagnés sur ce tour. Il reste affiché tant que l'hôte n'a pas cliqué sur
« Morceau suivant » — les autres joueurs voient qui l'on attend. Si l'hôte
quitte à ce moment-là, un autre joueur est promu et récupère le bouton.

**Phase de sélection.** Chaque joueur se déclare prêt une fois ses morceaux
choisis. Tant qu'il en manque un, le bouton de démarrage de l'hôte reste bloqué
et affiche qui l'on attend. Retirer un morceau et repasser sous le minimum
annule automatiquement le « prêt ». Un joueur déconnecté n'est plus attendu :
sinon un onglet fermé bloquerait la partie pour tout le monde.

**Reconnexion.** L'identité du joueur vit dans `localStorage`, pas dans le
socket. Un F5 en pleine partie retrouve sa place et son score.

## Tests

Les simulations de parties ont besoin d'un serveur déjà démarré ; `simdom`,
non. `sim6` joue une partie entière **sans clé TMDB** : le serveur valide ce
que le client lui envoie sans rappeler l'API, donc seule la recherche a besoin
d'une clé.

```bash
LEAD_MS=100 VOTE_MS=400 npm start &
npm run sim          # partie complète à 3 joueurs : secret, doublons, scores
npm run sim2         # reconnexion, déconnexion et reprise de l'hôte
npm run sim4         # plateforme : catalogue, droits de l'hôte, enchaînement
npm run sim5         # qui dans le groupe : écriture, majorité, points
npm run sim6         # qui regarde ça : validation, secret, partie complète

# Les clients, dans un DOM headless — le seul test qui attrape un module
# cassé ou absent, ce que les simulations serveur ne voient pas.
npm install --no-save jsdom
npm run simdom

# sim3 vérifie la durée d'un tour : il lui faut la même fenêtre que le serveur
LEAD_MS=100 VOTE_MS=4000 npm start &
VOTE_MS=4000 npm run sim3
```

## À savoir

À **2 joueurs le blind-test n'a pas d'intérêt** : la liste des suspects ne
contient qu'un seul nom, donc toute réponse est bonne. Compte 3 joueurs minimum,
4 ou 5 pour que ce soit vraiment amusant.

Les parties vivent en mémoire : un redémarrage du serveur les efface.
