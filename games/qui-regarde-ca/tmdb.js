// ---------------------------------------------------------------------------
// Proxy TMDB — specifique a « Qui regarde ça ? », donc range avec lui.
//
// TMDB (themoviedb.org) couvre les films ET les series, avec les titres et les
// affiches en francais. Il demande une cle, gratuite, a creer sur le site :
//
//   TMDB_API_KEY=<cle v3>      ou      TMDB_TOKEN=<jeton v4 "Read Access">
//
// Sans cle, la recherche repond proprement « cle absente » plutot que de
// laisser le joueur devant un champ qui ne rend rien.
//
// Contrairement aux extraits Deezer, les URL d'affiche ne sont pas signees et
// n'expirent pas : on peut donc les stocker et les renvoyer telles quelles.
//
// Le debit reste encadre, comme pour Deezer : cache sur les recherches, file
// qui espace les appels sortants, quarantaine si la source refuse.
// ---------------------------------------------------------------------------
import { num, str } from '../../core/env.js';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w342';
// Ce que le client a le droit de nous renvoyer comme affiche.
export const POSTER_HOST = /^https:\/\/image\.tmdb\.org\/t\/p\//;

const KEY = str(process.env.TMDB_API_KEY, '');
const TOKEN = str(process.env.TMDB_TOKEN, '');
export const hasCredentials = () => Boolean(KEY || TOKEN);

const LANG = str(process.env.TMDB_LANG, 'fr-FR');
const CACHE_TTL = num(process.env.TMDB_CACHE_TTL_MS, 6 * 60 * 60 * 1000);
const CACHE_MAX = 500;
const GAP_MS = num(process.env.TMDB_GAP_MS, 250);
const MAX_WAIT_MS = num(process.env.TMDB_MAX_WAIT_MS, 20000);

const searchCache = new Map();
let lastCall = 0;
let queued = 0;
let chain = Promise.resolve();
let cooldownUntil = 0;

const normalize = (q) => q.trim().toLowerCase().replace(/\s+/g, ' ');

// Serialise les appels sortants avec un intervalle minimum entre deux.
function schedule(fn) {
  queued += 1;
  const run = chain.then(async () => {
    const attente = Math.max(0, lastCall + GAP_MS - Date.now());
    if (attente) await new Promise((r) => setTimeout(r, attente));
    lastCall = Date.now();
    return fn();
  });
  chain = run.then(() => {}, () => {});
  run.then(() => { queued -= 1; }, () => { queued -= 1; });
  return run;
}

async function callApi(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // Jeton v4 en en-tete, cle v3 en parametre : TMDB accepte les deux.
  const headers = { accept: 'application/json' };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  else url.searchParams.set('api_key', KEY);

  const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!r.ok) {
    const e = new Error(`tmdb ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

// Un resultat TMDB n'a pas les memes champs selon qu'il s'agit d'un film ou
// d'une serie : on ramene les deux a une forme unique.
function toItem(raw) {
  const kind = raw.media_type === 'movie' ? 'film' : 'série';
  const title = raw.media_type === 'movie' ? raw.title : raw.name;
  const date = raw.media_type === 'movie' ? raw.release_date : raw.first_air_date;
  if (!raw.id || !title) return null;
  return {
    tmdbId: String(raw.id),
    kind,
    title: String(title).slice(0, 200),
    year: /^\d{4}/.test(date || '') ? date.slice(0, 4) : '',
    poster: raw.poster_path ? IMG + raw.poster_path : '',
  };
}

async function searchTitles(term) {
  const json = await callApi('/search/multi', {
    query: term,
    language: LANG,
    include_adult: 'false',
    page: '1',
  });
  return (json.results || [])
    // search/multi renvoie aussi des personnes : elles n'ont rien a faire ici.
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .map(toItem)
    .filter(Boolean)
    // Sans affiche, la grille a un trou : on les relegue en fin de liste.
    .sort((a, b) => Number(Boolean(b.poster)) - Number(Boolean(a.poster)))
    .slice(0, 12);
}

function apiError(res, err, quoi) {
  console.error(`[${quoi}]`, err.status || '-', err.message, `| file: ${queued}`);
  if (err.status === 401 || err.status === 403) {
    return res.status(503).json({ error: 'badkey' });
  }
  if (err.status === 429) {
    cooldownUntil = Date.now() + 30000;
    return res.status(429).json({ error: 'rate', retryIn: 30 });
  }
  return res.status(502).json({ error: 'down' });
}

export function routes(app) {
  app.get('/api/quiregardeca/search', async (req, res) => {
    if (!hasCredentials()) return res.status(503).json({ error: 'nokey' });

    const raw = (req.query.q || '').trim();
    if (raw.length < 2) return res.json([]);

    const key = normalize(raw);
    const hit = searchCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return res.json(hit.data);

    const reste = Math.ceil((cooldownUntil - Date.now()) / 1000);
    if (reste > 0) return res.status(429).json({ error: 'rate', retryIn: reste });
    if ((queued + 1) * GAP_MS > MAX_WAIT_MS) {
      return res.status(429).json({ error: 'busy', retryIn: Math.ceil(MAX_WAIT_MS / 1000) });
    }

    try {
      const data = await schedule(() => searchTitles(key));
      if (searchCache.size >= CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
      searchCache.set(key, { at: Date.now(), data });
      res.json(data);
    } catch (err) {
      apiError(res, err, 'recherche tmdb');
    }
  });
}
