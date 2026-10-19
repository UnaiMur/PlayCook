// ---------------------------------------------------------------------------
// Proxy Deezer — specifique au blind test, donc range avec lui.
//
// Apple renvoyait des 403 meme a une requete par minute : l'IP de sortie de
// l'hebergeur est bloquee, et aucun reglage de debit n'y change rien. Deezer
// prend le relais : api.deezer.com, sans cle ni compte.
//
// PARTICULARITE IMPORTANTE : les URL d'extrait Deezer sont signees et expirent
// au bout d'environ 15 minutes (parametre hdnea=exp=...). On ne les stocke donc
// JAMAIS. On ne garde que l'identifiant du morceau, et on resigne l'URL juste
// avant chaque lecture. Sinon un morceau choisi en phase de selection serait
// muet le temps que la partie arrive jusqu'a lui.
//
// Le debit reste encadre : cache sur les metadonnees, file qui espace les
// appels sortants, quarantaine si la source refuse.
// ---------------------------------------------------------------------------
import { num } from '../../core/env.js';

const API = 'https://api.deezer.com';
// Extraits et pochettes sortent tous du CDN de Deezer. Deux constantes pour
// deux usages : verifier une URL signee qu'on vient de recevoir de l'API, et
// verifier une pochette que le client nous renvoie.
export const PREVIEW_HOST = /^https:\/\/[\w.-]+\.dzcdn\.net\//;
export const ARTWORK_HOST = PREVIEW_HOST;

const searchCache = new Map();
const previewCache = new Map();
const CACHE_TTL = num(process.env.CACHE_TTL_MS, 60 * 60 * 1000);
// Bien en deca des ~15 min de validite d'une URL signee
const PREVIEW_TTL = num(process.env.PREVIEW_TTL_MS, 5 * 60 * 1000);
const CACHE_MAX = 500;
const GAP_MS = num(process.env.API_GAP_MS, 400);
const MAX_WAIT_MS = num(process.env.API_MAX_WAIT_MS, 20000);

let lastCall = 0;
let queued = 0;
let chain = Promise.resolve();
let cooldownUntil = 0;

const normalize = (q) => q.trim().toLowerCase().replace(/\s+/g, ' ');
const secure = (u) => (u || '').replace(/^http:\/\//, 'https://');

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

async function callApi(path) {
  const r = await fetch(API + path, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) {
    const e = new Error(`deezer ${r.status}`);
    e.status = r.status;
    throw e;
  }
  const json = await r.json();
  // Deezer signale ses erreurs dans un corps 200, quota compris
  if (json && json.error && Object.keys(json.error).length) {
    const e = new Error(json.error.message || json.error.type || 'erreur deezer');
    e.status = /quota|limit/i.test(e.message) ? 429 : 502;
    throw e;
  }
  return json;
}

async function searchTracks(term) {
  const json = await callApi(`/search?limit=12&q=${encodeURIComponent(term)}`);
  // previewUrl volontairement absent : il expirerait avant d'etre utilise
  return (json.data || [])
    .filter((t) => t.id && t.preview && t.readable !== false)
    .map((t) => ({
      trackKey: String(t.id),
      title: t.title,
      artist: t.artist?.name || '',
      artwork: secure(t.album?.cover_medium || t.album?.cover || ''),
    }));
}

export async function resolvePreview(trackKey) {
  const hit = previewCache.get(trackKey);
  if (hit && Date.now() - hit.at < PREVIEW_TTL) return hit.url;

  const json = await schedule(() => callApi(`/track/${encodeURIComponent(trackKey)}`));
  const url = secure(json.preview || '');
  if (!PREVIEW_HOST.test(url)) throw new Error('extrait introuvable');

  if (previewCache.size >= CACHE_MAX) previewCache.delete(previewCache.keys().next().value);
  previewCache.set(trackKey, { at: Date.now(), url });
  return url;
}

function apiError(res, err, quoi) {
  console.error(`[${quoi}]`, err.status || '-', err.message, `| file: ${queued}`);
  if (err.status === 403 || err.status === 429) {
    cooldownUntil = Date.now() + 60000;
    return res.status(429).json({ error: 'rate', retryIn: 60 });
  }
  return res.status(502).json({ error: 'down' });
}

export function routes(app) {
  app.get('/api/blindtest/search', async (req, res) => {
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
      const data = await schedule(() => searchTracks(key));
      if (searchCache.size >= CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
      searchCache.set(key, { at: Date.now(), data });
      res.json(data);
    } catch (err) {
      apiError(res, err, 'recherche');
    }
  });

  // Signe une URL d'extrait a la demande, pour les boutons d'ecoute de la
  // phase de selection. La partie, elle, resigne cote serveur a chaque manche.
  app.get('/api/blindtest/preview', async (req, res) => {
    const id = String(req.query.id || '').trim();
    if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'bad' });

    const reste = Math.ceil((cooldownUntil - Date.now()) / 1000);
    if (reste > 0) return res.status(429).json({ error: 'rate', retryIn: reste });

    try {
      res.json({ url: await resolvePreview(id) });
    } catch (err) {
      apiError(res, err, 'extrait');
    }
  });
}
