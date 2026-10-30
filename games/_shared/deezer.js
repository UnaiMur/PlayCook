// ---------------------------------------------------------------------------
// Proxy Deezer — partage par les jeux musicaux.
//
// Deux jeux s'en servent (« Qui a mis ça ? » et « Devine la musique »), et
// c'est volontairement UN SEUL module : le quota Deezer est par IP, donc par
// serveur. Deux proxys independants auraient chacun leur file et leur
// quarantaine, et se seraient fait bloquer a deux fois la vitesse. Ici la file,
// les caches et la quarantaine sont communs.
//
// Chaque jeu monte ses propres routes avec son prefixe, via routes(app, nom) :
// les URL restent propres a chaque jeu, la plomberie est commune.
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
const chartCache = new Map();
let genresCache = null;
const CACHE_TTL = num(process.env.CACHE_TTL_MS, 60 * 60 * 1000);
// Les tops et la liste des genres bougent a peine : on les garde longtemps,
// c'est autant d'appels economises sur le quota pour les parties suivantes.
const CHART_TTL = num(process.env.CHART_TTL_MS, 6 * 60 * 60 * 1000);
const CHART_PAGES = num(process.env.CHART_PAGES, 3);
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

// Un morceau tel qu'on le fait circuler. previewUrl volontairement absent :
// il expirerait avant d'etre utilise (voir l'entete).
//
// `titleShort` est le titre sans les « (feat. ...) » et autres mentions, tel
// que Deezer le fournit. « Devine la musique » s'en sert pour accepter la
// reponse courte sans avoir a deviner ou couper le titre long.
const piste = (t) => ({
  trackKey: String(t.id),
  title: t.title,
  titleShort: t.title_short || '',
  artist: t.artist?.name || '',
  artwork: secure(t.album?.cover_medium || t.album?.cover || ''),
});

// Un morceau sans extrait jouable n'a aucun interet ici, quel que soit le jeu.
const jouable = (t) => t.id && t.preview && t.readable !== false;

async function searchTracks(term) {
  const json = await callApi(`/search?limit=12&q=${encodeURIComponent(term)}`);
  return (json.data || []).filter(jouable).map(piste);
}

// Secondes restantes de quarantaine, 0 si la voie est libre.
export const cooldownRestant = () =>
  Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));

// ---------------------------------------------------------------------------
// Les tops, pour le mode « musique aleatoire »
//
// Deezer n'a pas d'endpoint « un morceau au hasard » : on puise donc dans les
// tops, ce qui tombe bien pour un blind test — un morceau que personne ne
// connait ne se devine pas. Le genre 0 vaut « tous genres ».
//
// On pagine pour avoir de quoi tirer sans se repeter d'une partie a l'autre :
// un top de 100 titres suffirait a une partie mais pas a dix.
// ---------------------------------------------------------------------------
export async function chartTracks(genreId = '0') {
  const id = /^\d+$/.test(String(genreId)) ? String(genreId) : '0';
  const hit = chartCache.get(id);
  if (hit && Date.now() - hit.at < CHART_TTL) return hit.data;

  const lot = [];
  const vus = new Set();
  for (let page = 0; page < CHART_PAGES; page++) {
    const json = await schedule(
      () => callApi(`/chart/${id}/tracks?limit=100&index=${page * 100}`)
    );
    const data = json.data || [];
    for (const t of data) {
      if (!jouable(t) || vus.has(String(t.id))) continue;
      vus.add(String(t.id));
      lot.push(piste(t));
    }
    // Page incomplete : le top est plus court que prevu, inutile d'insister.
    if (data.length < 100) break;
  }

  if (!lot.length) throw new Error('top vide');
  chartCache.set(id, { at: Date.now(), data: lot });
  return lot;
}

// La liste des genres vient de Deezer plutot que d'une table ecrite ici : des
// identifiants recopies de memoire seraient faux, et une liste figee vieillit.
export async function listGenres() {
  if (genresCache && Date.now() - genresCache.at < CHART_TTL) return genresCache.data;

  const json = await schedule(() => callApi('/genre'));
  const data = (json.data || [])
    .filter((g) => g.id != null && g.name)
    .map((g) => ({ id: String(g.id), name: g.name }));
  if (!data.length) throw new Error('genres vides');

  genresCache = { at: Date.now(), data };
  return data;
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

// Monte /api/<prefixe>/search et /api/<prefixe>/preview. Chaque jeu appelle
// ceci avec son propre prefixe : des URL lisibles cote client, une seule file
// d'attente cote serveur.
export function routes(app, prefixe) {
  if (!prefixe) throw new Error('deezer: prefixe de route manquant');

  app.get(`/api/${prefixe}/search`, async (req, res) => {
    const raw = (req.query.q || '').trim();
    if (raw.length < 2) return res.json([]);

    const key = normalize(raw);
    const hit = searchCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return res.json(hit.data);

    const reste = cooldownRestant();
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
  app.get(`/api/${prefixe}/preview`, async (req, res) => {
    const id = String(req.query.id || '').trim();
    if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'bad' });

    const reste = cooldownRestant();
    if (reste > 0) return res.status(429).json({ error: 'rate', retryIn: reste });

    try {
      res.json({ url: await resolvePreview(id) });
    } catch (err) {
      apiError(res, err, 'extrait');
    }
  });
}
