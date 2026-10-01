# Qui écoute ça ?

Blind-test multijoueur en navigateur. Phase 1 : chacun choisit 3 à 5 morceaux.
Phase 2 : ils passent dans un ordre aléatoire et il faut deviner qui les a mis.

## Lancer

```bash
npm install
npm start          # http://localhost:3000
```

Ouvre l'adresse dans plusieurs onglets (ou plusieurs appareils) pour tester.
Le premier joueur crée la partie, les autres rejoignent avec le code à 4 lettres.

Pour jouer avec des gens qui ne sont pas sur ton réseau, expose le port 3000 :
`npx localtunnel --port 3000`, ngrok, ou un déploiement sur Render / Fly.io.

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

## Comment ça marche

**Le serveur est la seule source de vérité.** Le champ `ownerIds` d'un morceau
ne quitte jamais `server.js` avant la révélation : `publicState()` construit une
vue différente pour chaque joueur et n'y met que ce qu'il a le droit de voir.
Ouvrir l'onglet réseau du navigateur ne donne donc aucun avantage.

**Source audio : l'API iTunes Search** (`/api/search`). Pas de clé, pas de compte,
extraits de 30 secondes. Spotify ne convient plus : son champ `preview_url` est
`null` pour toute application créée après le 27 novembre 2024. Apple n'envoie pas
d'en-têtes CORS, donc la requête passe obligatoirement par le serveur, qui met
aussi en cache (l'API plafonne vers 20 appels par minute).

**Synchronisation du son.** Le serveur annonce un instant de départ absolu
(`startAt`). Chaque client estime d'abord son décalage d'horloge avec le serveur
(5 allers-retours, médiane), précharge l'extrait, puis programme la lecture.
Décalage résiduel : quelques dizaines de millisecondes.

**Autoplay.** Les navigateurs refusent de jouer du son sans interaction
préalable. Le premier clic n'importe où dans la page débloque le contexte audio
via un échantillon silencieux.

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
annule automatiquement le « prêt ».

**Reconnexion.** L'identité du joueur vit dans `localStorage`, pas dans le
socket. Un F5 en pleine partie retrouve sa place et son score.

## Fichiers

```
server.js          état des parties, machine à états, proxy iTunes
public/app.js      écrans, horloge, lecture audio, votes
public/index.html  structure des 6 écrans
public/style.css
sim.js             simulation d'une partie à 3 joueurs (sans navigateur)
sim2.js            reconnexion, déconnexion et reprise de l'hôte
sim3.js            vérifie que le morceau va au bout et que le récap arrive
```

Pour lancer les tests (ils ont besoin de `socket.io-client`) :

```bash
npm install --no-save socket.io-client
LEAD_MS=100 VOTE_MS=1500 npm start &
node sim.js && node sim2.js && VOTE_MS=1500 node sim3.js
```

## À savoir

À **2 joueurs le jeu n'a pas d'intérêt** : la liste des suspects ne contient
qu'un seul nom, donc toute réponse est bonne. Compte 3 joueurs minimum, 4 ou 5
pour que ce soit vraiment amusant.

Les parties vivent en mémoire : un redémarrage du serveur les efface.
