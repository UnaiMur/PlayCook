import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const http = createServer(app);
const io = new Server(http);
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// ---------------------------------------------------------------------------
// Configuration de partie
// ---------------------------------------------------------------------------
// Surchargeables au lancement : LEAD_MS=500 VOTE_MS=15000 npm start
const num = (v, d) => (v === undefined ? d : Number(v));

const CONFIG = {
  minTracks: num(process.env.MIN_TRACKS, 3),
  maxTracks: num(process.env.MAX_TRACKS, 5),
  // false : chaque soumission est une entree distincte -> le morceau passe
  //         deux fois si deux joueurs l'ont choisi.
  // true  : les doublons fusionnent -> une seule lecture, plusieurs bonnes
  //         reponses acceptees.
  mergeDuplicates: process.env.MERGE_DUPLICATES === 'true',
  leadMs: num(process.env.LEAD_MS, 3000),      // prechargement avant le top depart
  voteMs: num(process.env.VOTE_MS, 30000),     // duree du tour
  // 0 = l'hote decide quand passer au morceau suivant (defaut).
  // Une valeur > 0 enchaine automatiquement apres ce delai.
  revealMs: num(process.env.REVEAL_MS, 0),
  pointsCorrect: num(process.env.POINTS_CORRECT, 100),
  pointsPerFooled: num(process.env.POINTS_FOOLED, 50),
};

// ---------------------------------------------------------------------------
// Proxy iTunes (l'API Apple n'envoie pas d'en-tetes CORS : impossible de
// l'appeler depuis le navigateur, tout passe par ici)
// ---------------------------------------------------------------------------
const searchCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);

  const key = q.toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return res.json(hit.data);

  try {
    const url = new URL('https://itunes.apple.com/search');
    url.searchParams.set('term', q);
    url.searchParams.set('media', 'music');
    url.searchParams.set('entity', 'song');
    url.searchParams.set('country', 'FR');
    url.searchParams.set('limit', '12');

    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`iTunes ${r.status}`);
    const json = await r.json();

    const data = (json.results || [])
      .filter((t) => t.previewUrl)
      .map((t) => ({
        trackKey: String(t.trackId),
        title: t.trackName,
        artist: t.artistName,
        artwork: (t.artworkUrl100 || '').replace('100x100', '300x300'),
        previewUrl: t.previewUrl,
      }));

    searchCache.set(key, { at: Date.now(), data });
    res.json(data);
  } catch (err) {
    console.error('[itunes]', err.message);
    res.status(502).json({ error: 'Recherche indisponible' });
  }
});

// ---------------------------------------------------------------------------
// Etat des parties (en memoire : largement suffisant pour commencer)
// ---------------------------------------------------------------------------
/**
 * Room = {
 *   code, hostId, phase, players: Map, submissions: [], playlist: [],
 *   currentIndex, votes: {}, roundStartAt, timer
 * }
 * Submission = { id, trackKey, title, artist, artwork, previewUrl, ownerIds: [] }
 *
 * REGLE CENTRALE : ownerIds ne quitte JAMAIS le serveur avant la revelation.
 */
const rooms = new Map();

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1
const makeCode = () => {
  let code;
  do {
    code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function clearTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

// ---------------------------------------------------------------------------
// Vue publique : ce que chaque joueur a le droit de voir
// ---------------------------------------------------------------------------
function publicState(room, playerId) {
  const players = [...room.players.values()].map((p) => ({
    id: p.id,
    pseudo: p.pseudo,
    score: p.score,
    connected: p.connected,
    isHost: p.id === room.hostId,
    ready: p.ready === true,
    trackCount: room.submissions.filter((s) => s.ownerIds.includes(p.id)).length,
  }));

  const state = {
    code: room.code,
    phase: room.phase,
    youAreHost: playerId === room.hostId,
    you: playerId,
    players,
    config: { minTracks: CONFIG.minTracks, maxTracks: CONFIG.maxTracks },
  };

  if (room.phase === 'PICKING') {
    state.mySubmissions = room.submissions
      .filter((s) => s.ownerIds.includes(playerId))
      .map((s) => ({ id: s.id, title: s.title, artist: s.artist, artwork: s.artwork }));
    state.myReady = room.players.get(playerId)?.ready === true;
    // L'hote ne peut plus partir avant que chacun se soit declare pret
    state.canStart =
      players.length >= 2 && players.every((p) => p.trackCount >= CONFIG.minTracks && p.ready);
    state.waitingFor = players.filter((p) => !p.ready).map((p) => p.pseudo);
  }

  const current = room.playlist[room.currentIndex];

  if (room.phase === 'PLAYING' && current) {
    // Le titre et la pochette sont visibles : le joueur doit deviner QUI,
    // pas QUOI. Les ownerIds, eux, restent cote serveur.
    state.round = {
      index: room.currentIndex + 1,
      total: room.playlist.length,
      title: current.title,
      artist: current.artist,
      artwork: current.artwork,
      previewUrl: current.previewUrl,
      startAt: room.roundStartAt,
      voteEndsAt: room.roundStartAt + CONFIG.voteMs,
      canVote: !current.ownerIds.includes(playerId),
      myVote: room.votes[playerId] || null,
      votedCount: Object.keys(room.votes).length,
      expectedVotes: expectedVoters(room, current).length,
      suspects: players.filter((p) => p.id !== playerId).map((p) => ({ id: p.id, pseudo: p.pseudo })),
    };
  }

  if (room.phase === 'REVEAL' && current) {
    state.reveal = room.lastReveal;
  }

  if (room.phase === 'SCORES') {
    state.ranking = [...players].sort((a, b) => b.score - a.score);
  }

  return state;
}

function expectedVoters(room, submission) {
  return [...room.players.values()].filter(
    (p) => p.connected && !submission.ownerIds.includes(p.id)
  );
}

function broadcast(room) {
  for (const p of room.players.values()) {
    if (p.socketId) io.to(p.socketId).emit('room:state', publicState(room, p.id));
  }
}

// ---------------------------------------------------------------------------
// Boucle de jeu
// ---------------------------------------------------------------------------
function startRound(room) {
  clearTimer(room);
  room.votes = {};
  room.lastReveal = null;
  room.phase = 'PLAYING';
  room.roundStartAt = Date.now() + CONFIG.leadMs;
  broadcast(room);

  // Le serveur tranche de toute facon a la fin de la fenetre, meme si des
  // joueurs n'ont pas vote (onglet ferme, deconnexion...).
  room.timer = setTimeout(() => endRound(room), CONFIG.leadMs + CONFIG.voteMs);
}

function endRound(room) {
  clearTimer(room);
  const current = room.playlist[room.currentIndex];
  if (!current) return;

  const deltas = {};
  const bump = (id, n) => { deltas[id] = (deltas[id] || 0) + n; };

  const votes = [];
  for (const [voterId, suspectId] of Object.entries(room.votes)) {
    const correct = current.ownerIds.includes(suspectId);
    if (correct) bump(voterId, CONFIG.pointsCorrect);
    else current.ownerIds.forEach((o) => bump(o, CONFIG.pointsPerFooled));
    votes.push({
      voterId,
      voterPseudo: room.players.get(voterId)?.pseudo || '?',
      suspectId,
      suspectPseudo: room.players.get(suspectId)?.pseudo || '?',
      correct,
    });
  }

  for (const [id, n] of Object.entries(deltas)) {
    const p = room.players.get(id);
    if (p) p.score += n;
  }

  room.lastReveal = {
    index: room.currentIndex + 1,
    total: room.playlist.length,
    title: current.title,
    artist: current.artist,
    artwork: current.artwork,
    owners: current.ownerIds.map((id) => room.players.get(id)?.pseudo || '?'),
    votes,
    deltas,
    // Classement apres ce tour, avec ce que chacun vient de gagner
    scores: [...room.players.values()]
      .map((p) => ({ pseudo: p.pseudo, score: p.score, delta: deltas[p.id] || 0 }))
      .sort((a, b) => b.score - a.score),
    isLast: room.currentIndex >= room.playlist.length - 1,
  };

  room.phase = 'REVEAL';
  broadcast(room);
  // Par defaut on attend l'hote : il relance quand le groupe a fini de commenter.
  if (CONFIG.revealMs > 0) room.timer = setTimeout(() => nextRound(room), CONFIG.revealMs);
}

function nextRound(room) {
  clearTimer(room);
  if (room.currentIndex >= room.playlist.length - 1) {
    room.phase = 'SCORES';
    broadcast(room);
    return;
  }
  room.currentIndex += 1;
  startRound(room);
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  let roomCode = null;
  let playerId = null;

  const room = () => rooms.get(roomCode);
  const fail = (msg) => socket.emit('error:msg', msg);

  socket.on('time:sync', (cb) => typeof cb === 'function' && cb(Date.now()));

  function attach(r, id, pseudo) {
    roomCode = r.code;
    playerId = id;
    socket.join(r.code);

    const existing = r.players.get(id);
    if (existing) {
      existing.socketId = socket.id;
      existing.connected = true;
      if (pseudo) existing.pseudo = pseudo;
    } else {
      r.players.set(id, { id, socketId: socket.id, pseudo, score: 0, ready: false, connected: true });
    }
    broadcast(r);
  }

  socket.on('room:create', ({ pseudo, playerId: pid }) => {
    const id = pid || uid();
    const code = makeCode();
    const r = {
      code,
      hostId: id,
      phase: 'LOBBY',
      players: new Map(),
      submissions: [],
      playlist: [],
      currentIndex: -1,
      votes: {},
      roundStartAt: null,
      lastReveal: null,
      timer: null,
    };
    rooms.set(code, r);
    attach(r, id, (pseudo || 'Joueur').slice(0, 16));
    socket.emit('room:joined', { code, playerId: id });
  });

  socket.on('room:join', ({ code, pseudo, playerId: pid }) => {
    const r = rooms.get((code || '').toUpperCase());
    if (!r) return fail("Cette partie n'existe pas");

    const id = pid || uid();
    const known = r.players.has(id);
    if (!known && r.phase !== 'LOBBY' && r.phase !== 'PICKING') {
      return fail('La partie a déjà commencé');
    }
    attach(r, id, (pseudo || 'Joueur').slice(0, 16));
    socket.emit('room:joined', { code: r.code, playerId: id });
  });

  socket.on('phase:picking', () => {
    const r = room();
    if (!r || playerId !== r.hostId || r.phase !== 'LOBBY') return;
    if (r.players.size < 2) return fail('Il faut au moins 2 joueurs');
    r.phase = 'PICKING';
    broadcast(r);
  });

  socket.on('track:submit', (track) => {
    const r = room();
    if (!r || r.phase !== 'PICKING') return;
    if (!track?.previewUrl || !track?.trackKey) return fail('Morceau invalide');

    const mine = r.submissions.filter((s) => s.ownerIds.includes(playerId));
    if (mine.length >= CONFIG.maxTracks) return fail(`Maximum ${CONFIG.maxTracks} morceaux`);
    if (mine.some((s) => s.trackKey === track.trackKey)) return fail('Tu as déjà choisi ce morceau');

    const twin = r.submissions.find((s) => s.trackKey === track.trackKey);
    if (CONFIG.mergeDuplicates && twin) {
      twin.ownerIds.push(playerId);
    } else {
      r.submissions.push({
        id: uid(),
        trackKey: track.trackKey,
        title: track.title,
        artist: track.artist,
        artwork: track.artwork,
        previewUrl: track.previewUrl,
        ownerIds: [playerId],
      });
    }
    broadcast(r);
  });

  socket.on('player:ready', ({ ready }) => {
    const r = room();
    if (!r || r.phase !== 'PICKING') return;
    const p = r.players.get(playerId);
    if (!p) return;
    const count = r.submissions.filter((s) => s.ownerIds.includes(playerId)).length;
    if (ready && count < CONFIG.minTracks) return fail(`Il te faut ${CONFIG.minTracks} morceaux`);
    p.ready = !!ready;
    broadcast(r);
  });

  socket.on('track:remove', ({ id }) => {
    const r = room();
    if (!r || r.phase !== 'PICKING') return;
    const s = r.submissions.find((x) => x.id === id && x.ownerIds.includes(playerId));
    if (!s) return;
    s.ownerIds = s.ownerIds.filter((o) => o !== playerId);
    if (s.ownerIds.length === 0) r.submissions = r.submissions.filter((x) => x.id !== s.id);

    // Repasser sous le minimum annule automatiquement le "pret"
    const left = r.submissions.filter((x) => x.ownerIds.includes(playerId)).length;
    if (left < CONFIG.minTracks) {
      const p = r.players.get(playerId);
      if (p) p.ready = false;
    }
    broadcast(r);
  });

  socket.on('game:start', () => {
    const r = room();
    if (!r || playerId !== r.hostId || r.phase !== 'PICKING') return;
    const notReady = [...r.players.values()].filter(
      (p) => !p.ready || r.submissions.filter((s) => s.ownerIds.includes(p.id)).length < CONFIG.minTracks
    );
    if (notReady.length) return fail(`En attente de : ${notReady.map((p) => p.pseudo).join(', ')}`);

    r.playlist = shuffle(r.submissions);
    r.currentIndex = 0;
    startRound(r);
  });

  socket.on('vote:cast', ({ suspectId }) => {
    const r = room();
    if (!r || r.phase !== 'PLAYING') return;
    const current = r.playlist[r.currentIndex];
    if (!current) return;
    if (current.ownerIds.includes(playerId)) return;        // c'est ton morceau
    if (suspectId === playerId) return;                      // pas de vote pour soi
    if (!r.players.has(suspectId)) return;
    if (r.votes[playerId]) return;                           // un seul vote par tour

    r.votes[playerId] = suspectId;
    broadcast(r);
    // Pas de fin anticipee : le morceau va toujours jusqu'au bout.
  });

  socket.on('round:skip', () => {
    const r = room();
    if (!r || playerId !== r.hostId) return;
    if (r.phase === 'PLAYING') endRound(r);
    else if (r.phase === 'REVEAL') nextRound(r);
  });

  socket.on('disconnect', () => {
    const r = room();
    if (!r) return;
    const p = r.players.get(playerId);
    if (!p) return;

    p.connected = false;
    p.socketId = null;

    // L'hote part : on promeut quelqu'un d'autre plutot que de bloquer la partie
    if (r.hostId === playerId) {
      const next = [...r.players.values()].find((x) => x.connected);
      if (next) r.hostId = next.id;
    }

    if ([...r.players.values()].every((x) => !x.connected)) {
      clearTimer(r);
      rooms.delete(r.code);
      return;
    }
    broadcast(r);
  });
});

http.listen(PORT, () => console.log(`http://localhost:${PORT}`));
