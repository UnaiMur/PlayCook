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
import { mountRoutes } from './core/registry.js';

const app = express();
const http = createServer(app);
const io = new Server(http);
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
mountRoutes(app);
attach(io);

http.listen(PORT, () => console.log(`http://localhost:${PORT}`));
