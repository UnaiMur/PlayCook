// ---------------------------------------------------------------------------
// PlayCook — point d'entree.
//
// Ce fichier ne contient volontairement aucune regle de jeu : il monte le
// serveur HTTP, branche la plateforme sur Socket.IO et laisse chaque jeu
// declarer ses propres routes.
//
//   core/     la plateforme (salons, joueurs, phases, diffusion)
//   games/    un dossier par jeu, serveur + client
//
// Pour ajouter un jeu : creer games/<id>/server.js et games/<id>/client.js,
// puis l'importer dans core/registry.js.
// ---------------------------------------------------------------------------
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

import { attach } from './core/platform.js';
import { mountRoutes, catalogue } from './core/registry.js';

const app = express();
const http = createServer(app);
const io = new Server(http);
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// Le menu principal doit lister les jeux avant qu'un salon existe : c'est la
// seule chose que le client peut demander sans etre dans une partie.
app.get('/api/games', (req, res) => res.json(catalogue()));

mountRoutes(app);
attach(io);

http.listen(PORT, () => console.log(`http://localhost:${PORT}`));
