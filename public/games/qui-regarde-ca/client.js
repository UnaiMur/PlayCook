// ---------------------------------------------------------------------------
// Client de « Qui regarde ça ? ».
//
// Les trois ecrans, la recherche et les votes viennent du moteur partage
// (../_shared/devine-qui.js). Il ne reste ici que l'affichage propre aux
// series et aux films : l'affiche, le titre, l'annee et la categorie.
//
// Aucun son : ce jeu n'utilise pas api.sound.
// ---------------------------------------------------------------------------
import { createGuessWhoClient } from '../_shared/devine-qui.js';

const SEARCH = '/api/quiregardeca/search';

// Pas de <img src=""> : un src vide relance une requete sur la page elle-meme.
const poster = (url, api) =>
  (url ? api.el('img', { src: url, alt: '' }) : api.el('span.noart', { text: '🎬' }));

const bigPoster = (url, api) =>
  (url ? api.el('img.art.poster', { src: url, alt: '' }) : api.el('div.art.poster'));

// « série · 2008 », ou juste l'un des deux quand l'autre manque.
const subtitle = (t) => [t.kind, t.year].filter(Boolean).join(' · ');

export default createGuessWhoClient({
  id: 'qui-regarde-ca',

  search: {
    url: SEARCH,
    placeholder: 'Une série ou un film, puis Entrée…',
    minLength: 2,
    errorMessage: (body) => {
      if (body?.error === 'nokey') return 'Recherche indisponible : clé TMDB absente côté serveur';
      if (body?.error === 'badkey') return 'Recherche indisponible : clé TMDB refusée';
      return null;      // le moteur retombe sur son message generique
    },
  },

  texts: {
    pick: 'Choisis tes séries et tes films',
    mine: 'Ta sélection',
    hint: (config, n) =>
      `Entre ${config.minItems} et ${config.maxItems} titres — tu en as ${n}.`,
    counter: (r) => `Titre ${r.index} / ${r.total}`,
    prompt: 'Qui regarde ça ?',
    yours: "C'est ton titre — croise les doigts.",
  },

  row: (t, api) => [
    poster(t.poster, api),
    api.el('div.info', {},
      api.el('div.t', { text: t.title }),
      api.el('div.a', { text: subtitle(t) })),
  ],

  stage: (r, api) => [
    bigPoster(r.poster, api),
    api.el('h2.center', { text: r.title }),
    api.el('p.artist.center', { text: subtitle(r) }),
  ],

  reveal: (d, api) => [
    bigPoster(d.poster, api),
    api.el('h2.center', { text: d.title }),
    api.el('p.artist.center', { text: subtitle(d) }),
  ],
});
