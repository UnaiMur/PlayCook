// ---------------------------------------------------------------------------
// « Qui regarde ça ? » — le blind test, version séries et films.
//
// Meme mecanique que « Qui a mis ça ? » : chacun soumet en secret, puis on
// devine qui a choisi quoi. La difference tient en deux points :
//
//   - la source est TMDB au lieu de Deezer (films ET series, en francais) ;
//   - il n'y a rien a ecouter, donc pas de top depart synchronise : la manche
//     laisse simplement le temps de regarder l'affiche et de voter.
//
// Tout le reste vient de games/_shared/devine-qui.js.
// ---------------------------------------------------------------------------
import { num, bool } from '../../core/env.js';
import { createGuessWho } from '../_shared/devine-qui.js';
import { routes as tmdbRoutes, hasCredentials, POSTER_HOST } from './tmdb.js';

export const meta = {
  id: 'qui-regarde-ca',
  name: 'Qui regarde ça ?',
  tagline: 'Chacun met ses séries et ses films, devinez qui regarde quoi.',
  icon: '📺',
  rules: [
    'Chacun choisit 3 à 5 séries ou films en secret.',
    'Ils passent dans un ordre aléatoire, affiche et titre à l\'écran.',
    'À chaque titre, devine qui l\'a mis : 100 points si tu trouves.',
    'Si personne ne te démasque, tu gagnes 50 points par joueur piégé.',
  ],
  minPlayers: 2,
  maxPlayers: 12,
  allowLateJoin: false,
};

// Surchargeables au lancement : QRC_ROUND_MS=20000 npm start
const CONFIG = {
  minItems: num(process.env.QRC_MIN_ITEMS, 3),
  maxItems: num(process.env.QRC_MAX_ITEMS, 5),
  // false : deux joueurs qui mettent la meme serie -> elle passe deux fois.
  // true  : elle passe une fois, avec deux bonnes reponses.
  mergeDuplicates: bool(process.env.QRC_MERGE_DUPLICATES, false),
  // Pas de son a precharger : la manche commence tout de suite.
  roundMs: num(process.env.QRC_ROUND_MS, 20000),
  revealMs: num(process.env.QRC_REVEAL_MS, 0),
  pointsCorrect: num(process.env.QRC_POINTS_CORRECT, 100),
  pointsPerFooled: num(process.env.QRC_POINTS_FOOLED, 50),
};

export const routes = tmdbRoutes;

// Un avertissement au demarrage vaut mieux qu'une recherche muette en pleine
// partie : le jeu reste visible, mais on sait pourquoi il ne cherchera rien.
if (!hasCredentials()) {
  console.warn(
    '[qui-regarde-ca] TMDB_API_KEY ou TMDB_TOKEN absent : la recherche de '
    + 'séries et films restera indisponible. Voir le README.'
  );
}

const clean = (s) => String(s ?? '').slice(0, 200);

export function create(ctx) {
  return createGuessWho(ctx, {
    minPlayers: meta.minPlayers,
    minItems: CONFIG.minItems,
    maxItems: CONFIG.maxItems,
    mergeDuplicates: CONFIG.mergeDuplicates,
    leadMs: 0,
    roundMs: CONFIG.roundMs,
    revealMs: CONFIG.revealMs,
    pointsCorrect: CONFIG.pointsCorrect,
    pointsPerFooled: CONFIG.pointsPerFooled,

    labels: {
      one: 'titre',
      many: 'titres',
      duplicate: 'Tu as déjà choisi ce titre',
    },

    // Le client renvoie l'objet : on ne le croit pas sur parole. Seules une
    // affiche servie par TMDB et une des deux categories connues passent.
    sanitize(raw) {
      if (!/^\d+$/.test(String(raw.tmdbId ?? ''))) return null;
      if (raw.kind !== 'film' && raw.kind !== 'série') return null;
      if (raw.poster && !POSTER_HOST.test(raw.poster)) return null;
      const title = clean(raw.title);
      if (!title) return null;
      return {
        tmdbId: clean(raw.tmdbId),
        kind: raw.kind,
        title,
        year: /^\d{4}$/.test(String(raw.year ?? '')) ? String(raw.year) : '',
        poster: clean(raw.poster),
      };
    },

    // Un film et une serie peuvent porter le meme identifiant chez TMDB : la
    // categorie fait donc partie de l'identite.
    identity: (t) => `${t.kind}:${t.tmdbId}`,

    // Rien a rafraichir avant une manche : les URL d'affiche n'expirent pas.
    fields: (t) => ({
      tmdbId: t.tmdbId,
      kind: t.kind,
      title: t.title,
      year: t.year,
      poster: t.poster,
    }),
  });
}
