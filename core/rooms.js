// ---------------------------------------------------------------------------
// Modele de donnees : salons et joueurs.
//
// Ce fichier ne connait AUCUN jeu. Il ne sait que repondre a : qui est dans ce
// salon, qui est l'hote, qui est encore connecte. Tout ce qui est specifique a
// une partie vit dans games/<id>/server.js.
// ---------------------------------------------------------------------------

const rooms = new Map();

// Sans I, O, 0 ni 1 : un code se dicte a l'oral ou se recopie depuis une photo.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const uid = () => Math.random().toString(36).slice(2, 10);

export const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function makeCode() {
  let code;
  do {
    code = Array.from(
      { length: 4 },
      () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

export function createRoom(hostId, gameId) {
  const room = {
    code: makeCode(),
    hostId,
    phase: 'LOBBY',          // LOBBY -> GAME -> SCORES -> LOBBY
    players: new Map(),
    gameId,                  // jeu selectionne dans le salon
    game: null,              // instance vivante pendant GAME
    timer: null,             // timer principal, possede par le jeu via ctx
    ranking: null,           // fige a la fin d'une partie
  };
  rooms.set(room.code, room);
  return room;
}

export const getRoom = (code) => rooms.get(String(code || '').toUpperCase());

export function dropRoom(room) {
  clearTimer(room);
  if (room.game?.stop) {
    try { room.game.stop(); } catch { /* un jeu qui tombe ne doit pas bloquer le menage */ }
  }
  rooms.delete(room.code);
}

export function addPlayer(room, id, pseudo, socketId) {
  const existing = room.players.get(id);
  if (existing) {
    existing.socketId = socketId;
    existing.connected = true;
    if (pseudo) existing.pseudo = pseudo;
    return existing;
  }
  const player = {
    id,
    socketId,
    pseudo: pseudo || 'Joueur',
    score: 0,
    ready: false,
    connected: true,
  };
  room.players.set(id, player);
  return player;
}

export const list = (room) => [...room.players.values()];
export const connected = (room) => list(room).filter((p) => p.connected);

export function resetScores(room) {
  for (const p of room.players.values()) {
    p.score = 0;
    p.ready = false;
  }
}

// L'hote part : on promeut quelqu'un plutot que de laisser la partie orpheline.
export function reassignHost(room) {
  const next = connected(room)[0];
  if (next) room.hostId = next.id;
  return next || null;
}

export function clearTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}
