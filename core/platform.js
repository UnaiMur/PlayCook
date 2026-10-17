// ---------------------------------------------------------------------------
// La plateforme.
//
// Elle possede tout ce qui ne depend pas du jeu joue :
//   - les salons, les joueurs, les codes, les reconnexions, l'hote
//   - les trois phases communes LOBBY -> GAME -> SCORES
//   - la diffusion d'etat, la synchro d'horloge, les timers, les erreurs
//
// Elle ne sait rien du blind test. Un jeu est un module qui expose :
//
//   meta   : { id, name, tagline, minPlayers, maxPlayers }
//   routes?: (app) => void                      // routes HTTP optionnelles
//   create : (ctx) => instance
//
// et dont l'instance expose :
//
//   start()                      // lancee quand l'hote demarre
//   view(playerId)               // ce que CE joueur a le droit de voir
//   action(type, playerId, data) // une action de joueur
//   onJoin?(playerId)            // arrivee ou reconnexion en cours de partie
//   onLeave?(playerId)           // deconnexion en cours de partie
//   stop?()                      // menage (timers, ressources)
//
// Regle d'or : le jeu ne touche jamais aux sockets. Il lit l'etat, le modifie,
// et appelle ctx.update() ; la plateforme s'occupe du reste.
// ---------------------------------------------------------------------------
import {
  createRoom, getRoom, dropRoom, addPlayer, list, connected,
  resetScores, reassignHost, clearTimer, uid, shuffle,
} from './rooms.js';
import { getGame, defaultGameId, catalogue } from './registry.js';

export function attach(io) {
  // -------------------------------------------------------------------------
  // Vue publique commune. La partie specifique au jeu est deleguee a view().
  // -------------------------------------------------------------------------
  function publicState(room, playerId) {
    const players = list(room).map((p) => ({
      id: p.id,
      pseudo: p.pseudo,
      score: p.score,
      connected: p.connected,
      ready: p.ready === true,
      isHost: p.id === room.hostId,
    }));

    const game = getGame(room.gameId);
    const state = {
      code: room.code,
      phase: room.phase,
      you: playerId,
      youAreHost: playerId === room.hostId,
      players,
      catalogue: catalogue(),
      game: game ? { id: game.meta.id, name: game.meta.name } : null,
    };

    if (room.phase === 'LOBBY' && game) {
      const n = players.length;
      state.canStart =
        playerId === room.hostId && n >= game.meta.minPlayers && n <= game.meta.maxPlayers;
      state.startHint =
        n < game.meta.minPlayers
          ? `Il faut au moins ${game.meta.minPlayers} joueurs`
          : n > game.meta.maxPlayers
            ? `Ce jeu se joue a ${game.meta.maxPlayers} joueurs maximum`
            : '';
    }

    if (room.phase === 'GAME' && room.game) {
      try {
        state.view = room.game.view(playerId);
      } catch (err) {
        console.error(`[${room.gameId}] view`, err);
        state.view = { phase: 'ERROR' };
      }
    }

    if (room.phase === 'SCORES') state.ranking = room.ranking;

    return state;
  }

  function broadcast(room) {
    for (const p of room.players.values()) {
      if (p.socketId) io.to(p.socketId).emit('room:state', publicState(room, p.id));
    }
  }

  const fail = (socket, msg) => socket.emit('error:msg', msg);

  function failTo(room, playerId, msg) {
    const p = room.players.get(playerId);
    if (p?.socketId) io.to(p.socketId).emit('error:msg', msg);
  }

  // -------------------------------------------------------------------------
  // Le contexte remis au jeu : sa seule porte vers la plateforme.
  // -------------------------------------------------------------------------
  function makeContext(room) {
    return {
      // --- joueurs ---
      players: () => list(room).map((p) => ({
        id: p.id, pseudo: p.pseudo, score: p.score, connected: p.connected, ready: p.ready,
      })),
      connected: () => connected(room).map((p) => ({ id: p.id, pseudo: p.pseudo })),
      pseudo: (id) => room.players.get(id)?.pseudo || '?',
      has: (id) => room.players.has(id),
      isHost: (id) => id === room.hostId,
      hostId: () => room.hostId,

      // --- scores ---
      // Le jeu dit combien il attribue ; la plateforme tient le compte.
      award: (id, n) => {
        const p = room.players.get(id);
        if (p) p.score += n;
      },

      // --- drapeau "pret" : commun a tous les jeux a phase de preparation ---
      ready: (id) => room.players.get(id)?.ready === true,
      setReady: (id, v) => {
        const p = room.players.get(id);
        if (p) p.ready = !!v;
      },
      allReady: () => connected(room).every((p) => p.ready),
      notReady: () => connected(room).filter((p) => !p.ready).map((p) => p.pseudo),

      // --- temps ---
      now: () => Date.now(),
      // Un seul timer principal par salon : poser le suivant annule le precedent,
      // ce qui evite les doubles enchainements quand l'hote force un passage.
      setTimer: (ms, fn) => {
        clearTimer(room);
        room.timer = setTimeout(() => {
          room.timer = null;
          try { fn(); } catch (err) { console.error(`[${room.gameId}] timer`, err); }
        }, ms);
      },
      clearTimer: () => clearTimer(room),

      // --- sorties ---
      update: () => broadcast(room),
      fail: (playerId, msg) => failTo(room, playerId, msg),
      finish: () => finishGame(room),

      // --- utilitaires ---
      uid,
      shuffle,
    };
  }

  // -------------------------------------------------------------------------
  // Cycle de vie d'une partie
  // -------------------------------------------------------------------------
  function startGame(room) {
    const game = getGame(room.gameId);
    if (!game) return;

    clearTimer(room);
    resetScores(room);
    room.ranking = null;
    room.game = game.create(makeContext(room));
    room.phase = 'GAME';

    try {
      room.game.start();
    } catch (err) {
      console.error(`[${room.gameId}] start`, err);
      return backToLobby(room);
    }
    broadcast(room);
  }

  function finishGame(room) {
    clearTimer(room);
    if (room.game?.stop) {
      try { room.game.stop(); } catch (err) { console.error(`[${room.gameId}] stop`, err); }
    }
    room.game = null;
    room.ranking = list(room)
      .map((p) => ({ id: p.id, pseudo: p.pseudo, score: p.score }))
      .sort((a, b) => b.score - a.score);
    room.phase = 'SCORES';
    broadcast(room);
  }

  function backToLobby(room) {
    clearTimer(room);
    if (room.game?.stop) {
      try { room.game.stop(); } catch { /* ignore */ }
    }
    room.game = null;
    room.ranking = null;
    resetScores(room);
    room.phase = 'LOBBY';
    broadcast(room);
  }

  // -------------------------------------------------------------------------
  // Sockets
  // -------------------------------------------------------------------------
  io.on('connection', (socket) => {
    let roomCode = null;
    let playerId = null;

    const room = () => getRoom(roomCode);

    // Permet a chaque client d'estimer son decalage d'horloge : indispensable
    // des qu'un jeu veut declencher quelque chose au meme instant partout.
    socket.on('time:sync', (cb) => typeof cb === 'function' && cb(Date.now()));

    function join(r, id, pseudo) {
      roomCode = r.code;
      playerId = id;
      socket.join(r.code);
      addPlayer(r, id, (pseudo || 'Joueur').slice(0, 16), socket.id);
      socket.emit('room:joined', { code: r.code, playerId: id });
      if (r.phase === 'GAME' && r.game?.onJoin) {
        try { r.game.onJoin(id); } catch (err) { console.error(`[${r.gameId}] onJoin`, err); }
      }
      broadcast(r);
    }

    socket.on('room:create', ({ pseudo, playerId: pid, gameId } = {}) => {
      const id = pid || uid();
      const r = createRoom(id, getGame(gameId) ? gameId : defaultGameId());
      join(r, id, pseudo);
    });

    socket.on('room:join', ({ code, pseudo, playerId: pid } = {}) => {
      const r = getRoom(code);
      if (!r) return fail(socket, "Cette partie n'existe pas");

      const id = pid || uid();
      const known = r.players.has(id);
      // Un nouveau venu peut entrer tant que la partie n'a pas commence ; un
      // joueur deja connu revient a tout moment (rafraichissement, reseau).
      if (!known && r.phase === 'GAME') {
        const game = getGame(r.gameId);
        if (!game?.meta.allowLateJoin) return fail(socket, 'La partie a deja commence');
      }
      if (!known) {
        const game = getGame(r.gameId);
        if (game && r.players.size >= game.meta.maxPlayers) {
          return fail(socket, 'La partie est complete');
        }
      }
      join(r, id, pseudo);
    });

    // --- salon ---------------------------------------------------------------
    socket.on('lobby:select', ({ gameId } = {}) => {
      const r = room();
      if (!r || playerId !== r.hostId || r.phase !== 'LOBBY') return;
      if (!getGame(gameId)) return;
      r.gameId = gameId;
      broadcast(r);
    });

    socket.on('game:start', () => {
      const r = room();
      if (!r || playerId !== r.hostId || r.phase !== 'LOBBY') return;
      const game = getGame(r.gameId);
      if (!game) return;
      const n = r.players.size;
      if (n < game.meta.minPlayers) return fail(socket, `Il faut au moins ${game.meta.minPlayers} joueurs`);
      if (n > game.meta.maxPlayers) return fail(socket, `Maximum ${game.meta.maxPlayers} joueurs`);
      startGame(r);
    });

    // Retour au salon : depuis le classement, ou abandon en cours de partie.
    socket.on('lobby:return', () => {
      const r = room();
      if (!r || playerId !== r.hostId) return;
      if (r.phase === 'LOBBY') return;
      backToLobby(r);
    });

    // --- actions de jeu ------------------------------------------------------
    // Un seul evenement pour tous les jeux : le routage se fait sur `type`.
    socket.on('game:action', ({ type, data } = {}) => {
      const r = room();
      if (!r || r.phase !== 'GAME' || !r.game) return;
      if (!r.players.has(playerId)) return;
      if (typeof type !== 'string') return;
      try {
        r.game.action(type, playerId, data);
      } catch (err) {
        console.error(`[${r.gameId}] action ${type}`, err);
        fail(socket, 'Action impossible');
      }
    });

    // Le drapeau "pret" est commun : un jeu le lit, il n'a pas a le gerer.
    socket.on('player:ready', ({ ready } = {}) => {
      const r = room();
      if (!r || r.phase !== 'GAME' || !r.game) return;
      // Le jeu valide : lui seul sait si on a le droit de se declarer pret.
      try {
        r.game.action('ready', playerId, { ready: !!ready });
      } catch (err) {
        console.error(`[${r.gameId}] ready`, err);
      }
    });

    socket.on('disconnect', () => {
      const r = room();
      if (!r) return;
      const p = r.players.get(playerId);
      if (!p) return;

      p.connected = false;
      p.socketId = null;

      if (r.hostId === playerId) reassignHost(r);

      if (list(r).every((x) => !x.connected)) return dropRoom(r);

      if (r.phase === 'GAME' && r.game?.onLeave) {
        try { r.game.onLeave(playerId); } catch (err) { console.error(`[${r.gameId}] onLeave`, err); }
      }
      broadcast(r);
    });
  });
}
