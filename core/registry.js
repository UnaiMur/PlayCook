// ---------------------------------------------------------------------------
// Catalogue des jeux.
//
// Ajouter un jeu = ecrire games/<id>/server.js + games/<id>/client.js, puis
// l'importer ici. Rien d'autre a toucher dans le coeur.
// ---------------------------------------------------------------------------
import * as blindtest from '../games/blindtest/server.js';
import * as quiRegardeCa from '../games/qui-regarde-ca/server.js';
import * as quiDansLeGroupe from '../games/qui-dans-le-groupe/server.js';
import * as devineLeCraft from '../games/devine-le-craft/server.js';

const modules = [blindtest, quiRegardeCa, quiDansLeGroupe, devineLeCraft];

const byId = new Map();
for (const mod of modules) {
  if (!mod.meta?.id) throw new Error('jeu sans meta.id');
  if (byId.has(mod.meta.id)) throw new Error(`jeu en double : ${mod.meta.id}`);
  if (typeof mod.create !== 'function') throw new Error(`${mod.meta.id} : create() manquant`);
  byId.set(mod.meta.id, mod);
}

export const games = () => [...byId.values()];
export const getGame = (id) => byId.get(id) || null;
export const defaultGameId = () => modules[0].meta.id;

// Ce que le menu et le salon affichent : juste de quoi choisir, jamais
// l'implementation. Sert aussi la route /api/games, consultee avant meme
// d'avoir un salon.
export const catalogue = () =>
  games().map((g) => ({
    id: g.meta.id,
    name: g.meta.name,
    tagline: g.meta.tagline || '',
    rules: g.meta.rules || [],
    icon: g.meta.icon || '🎲',
    minPlayers: g.meta.minPlayers,
    maxPlayers: g.meta.maxPlayers,
  }));

// Chaque jeu peut exposer ses propres routes HTTP (proxys d'API, etc.).
export function mountRoutes(app) {
  for (const g of games()) {
    if (typeof g.routes === 'function') g.routes(app);
  }
}
