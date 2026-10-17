# PlayCook

Plateforme de mini-jeux à jouer entre amis dans le navigateur : un salon, un
code à 4 lettres, et des jeux qui se branchent dessus.

Premier jeu disponible : **« Qui a mis ça ? »**, un blind-test où chacun choisit
3 à 5 morceaux, puis où il faut deviner qui a mis quoi.

## Lancer

```bash
npm install
npm start          # http://localhost:3000
```

Ouvre l'adresse dans plusieurs onglets (ou plusieurs appareils) pour tester.
Le premier joueur crée la partie, les autres rejoignent avec le code à 4 lettres.

Pour jouer avec des gens qui ne sont pas sur ton réseau, expose le port 3000 :
`npx localtunnel --port 3000`, ngrok, ou un déploiement sur Render / Fly.io.

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
  blindtest/
    server.js               règles du blind-test (PICKING / PLAYING / REVEAL)
    deezer.js               proxy Deezer : recherche et signature des extraits
public/
  index.html                coquille : accueil, salon, #game-root, classement
  style.css
  core/
    app.js                  client plateforme + chargement du module de jeu
    dom.js, clock.js, sound.js
  games/blindtest/client.js interface du blind-test
sim.js sim2.js sim3.js sim4.js   simulations sans navigateur
```

**La plateforme possède trois phases** : `LOBBY` → `GAME` → `SCORES`. Elle tient
les joueurs, les scores, le drapeau « prêt », l'hôte, les reconnexions, la
synchro d'horloge et le son. Elle ne sait rien des règles.

**Un jeu possède ses propres phases**, à l'intérieur de `GAME`. Il reçoit un
contexte (`ctx`) et ne touche jamais aux sockets : il lit l'état, le modifie,
appelle `ctx.update()`, et la plateforme diffuse à chacun la vue qui lui revient.

## Ajouter un jeu

Trois fichiers, une ligne à modifier.

**1. `games/<id>/server.js`** — les règles :

```js
export const meta = {
  id: 'imposteur',
  name: "L'imposteur",
  tagline: 'Tout le monde a le même mot, sauf un.',
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

C'est tout : le salon affiche le nouveau jeu automatiquement, l'hôte peut le
choisir, et le client charge `/games/<id>/client.js` à la volée.

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

Ces réglages appartiennent au blind-test : un nouveau jeu déclare les siens dans
son propre fichier, avec les helpers de `core/env.js`.

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

Quatre simulations sans navigateur, à lancer contre un serveur déjà démarré :

```bash
LEAD_MS=100 VOTE_MS=400 npm start &
npm run sim          # partie complète à 3 joueurs : secret, doublons, scores
npm run sim2         # reconnexion, déconnexion et reprise de l'hôte
npm run sim4         # plateforme : catalogue, droits de l'hôte, enchaînement

# sim3 vérifie la durée d'un tour : il lui faut la même fenêtre que le serveur
LEAD_MS=100 VOTE_MS=4000 npm start &
VOTE_MS=4000 npm run sim3
```

## À savoir

À **2 joueurs le blind-test n'a pas d'intérêt** : la liste des suspects ne
contient qu'un seul nom, donc toute réponse est bonne. Compte 3 joueurs minimum,
4 ou 5 pour que ce soit vraiment amusant.

Les parties vivent en mémoire : un redémarrage du serveur les efface.
