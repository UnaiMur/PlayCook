// ---------------------------------------------------------------------------
// Client de la plateforme.
//
// Il gere l'identite, la connexion, le salon, le classement final et le
// chargement du module de jeu. Il ne sait rien du blind test : quand la partie
// commence, il importe /games/<id>/client.js et lui confie #game-root.
//
// Un module de jeu exporte par defaut :
//   { id, mount(root, api), render(view, api), unmount() }
//
// `api` lui donne : emit(), ready(), toast(), now(), sound, me, players,
// isHost, state. Voir makeApi() plus bas.
// ---------------------------------------------------------------------------
import { $, el, esc, toast } from './dom.js';
import { sync, now } from './clock.js';
import { sound, initVolume, listenForUnlock } from './sound.js';

const socket = io();

// --- identite persistante : permet de retrouver sa place apres un F5 --------
let playerId = localStorage.getItem('playerId');
if (!playerId) {
  playerId = Math.random().toString(36).slice(2, 10);
  localStorage.setItem('playerId', playerId);
}
$('pseudo').value = localStorage.getItem('pseudo') || '';

let state = null;
let loaded = null;        // { id, module } du jeu monte
let loading = null;       // id en cours de chargement (evite les doubles imports)

initVolume();
listenForUnlock();

function show(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
}

// ---------------------------------------------------------------------------
// L'API remise au module de jeu
// ---------------------------------------------------------------------------
function makeApi() {
  return {
    // Actions : tout passe par un seul evenement, route cote serveur sur `type`.
    emit: (type, data) => socket.emit('game:action', { type, data }),
    ready: (v) => socket.emit('player:ready', { ready: v }),

    me: state?.you,
    isHost: !!state?.youAreHost,
    players: state?.players || [],
    player: (id) => (state?.players || []).find((p) => p.id === id) || null,
    state,

    now,              // horloge serveur estimee
    sound,            // canaux audio partages
    toast,
    el,
    esc,
  };
}

// ---------------------------------------------------------------------------
// Chargement dynamique du jeu
// ---------------------------------------------------------------------------
async function mountGame(id) {
  if (loaded?.id === id || loading === id) return;
  unmountGame();
  loading = id;
  try {
    const mod = (await import(`/games/${id}/client.js`)).default;
    if (loading !== id) return;          // la partie a change entre-temps
    const root = $('game-root');
    root.innerHTML = '';
    mod.mount(root, makeApi());
    loaded = { id, module: mod };
  } catch (err) {
    console.error('[jeu]', id, err);
    toast('Impossible de charger ce jeu');
  } finally {
    if (loading === id) loading = null;
  }
}

function unmountGame() {
  if (!loaded) return;
  try { loaded.module.unmount?.(); } catch (err) { console.error('[jeu] unmount', err); }
  $('game-root').innerHTML = '';
  loaded = null;
}

// ---------------------------------------------------------------------------
// Accueil
// ---------------------------------------------------------------------------
$('btnCreate').onclick = () => {
  const pseudo = $('pseudo').value.trim();
  if (!pseudo) return toast('Choisis un pseudo');
  localStorage.setItem('pseudo', pseudo);
  socket.emit('room:create', { pseudo, playerId });
};

$('btnJoin').onclick = () => {
  const pseudo = $('pseudo').value.trim();
  const code = $('joinCode').value.trim().toUpperCase();
  if (!pseudo) return toast('Choisis un pseudo');
  if (code.length !== 4) return toast('Code à 4 lettres');
  localStorage.setItem('pseudo', pseudo);
  socket.emit('room:join', { code, pseudo, playerId });
};

$('btnStart').onclick = () => socket.emit('game:start');
$('btnBack').onclick = () => socket.emit('lobby:return');

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------
socket.on('room:joined', ({ code, playerId: id }) => {
  playerId = id;
  localStorage.setItem('playerId', id);
  $('roomCode').textContent = code;
  sync(socket).catch(() => {});
});

socket.on('error:msg', toast);

socket.on('room:state', (s) => {
  const previous = state;
  state = s;
  $('roomCode').textContent = s.code;

  // Quitter une partie coupe le son : un extrait ne doit pas survivre au salon.
  if (s.phase !== 'GAME') sound.stop();
  if (previous?.phase === 'GAME' && s.phase !== 'GAME') unmountGame();

  if (s.phase === 'LOBBY') renderLobby(s);
  if (s.phase === 'GAME') renderGame(s);
  if (s.phase === 'SCORES') renderScores(s);
});

function playerLine(p, right) {
  return el(
    p.connected ? 'li' : 'li.off',
    {},
    el('span', { text: p.pseudo + (p.isHost ? ' 👑' : '') }),
    el('span.meta', { text: right })
  );
}

function renderLobby(s) {
  show('lobby');
  $('lobbyCode').textContent = s.code;

  const list = $('lobbyPlayers');
  list.innerHTML = '';
  for (const p of s.players) list.append(playerLine(p, p.ready ? '✓' : ''));

  // Choix du jeu : visible par tous, cliquable par l'hote seulement.
  const picker = $('gamePicker');
  picker.innerHTML = '';
  for (const g of s.catalogue) {
    const chosen = s.game?.id === g.id;
    picker.append(el(
      `button.card${chosen ? '.chosen' : ''}`,
      {
        disabled: !s.youAreHost && !chosen,
        onclick: () => socket.emit('lobby:select', { gameId: g.id }),
      },
      el('strong', { text: g.name }),
      el('span.tagline', { text: g.tagline }),
      el('span.meta', { text: `${g.minPlayers}–${g.maxPlayers} joueurs` })
    ));
  }

  $('btnStart').style.display = s.youAreHost ? 'block' : 'none';
  $('btnStart').disabled = !s.canStart;
  $('btnStart').textContent = s.canStart ? 'Démarrer' : (s.startHint || 'Démarrer');
  $('lobbyWait').textContent = s.youAreHost ? '' : "L'hôte lance la partie.";
}

function renderGame(s) {
  show('game');
  $('gameTitle').textContent = s.game?.name || '';
  if (!s.game) return;
  if (loaded?.id !== s.game.id) {
    mountGame(s.game.id).then(() => {
      if (loaded?.id === s.game.id) loaded.module.render(state.view, makeApi());
    });
    return;
  }
  try {
    loaded.module.render(s.view, makeApi());
  } catch (err) {
    console.error('[jeu] render', err);
  }
}

function renderScores(s) {
  show('scores');
  const list = $('ranking');
  list.innerHTML = '';
  (s.ranking || []).forEach((p, i) => {
    list.append(el('li', {},
      el('span', { text: `${i + 1}. ${p.pseudo}` }),
      el('span', { text: `${p.score} pts` })));
  });
  $('btnBack').style.display = s.youAreHost ? 'block' : 'none';
  $('scoresWait').textContent = s.youAreHost ? '' : "En attente de l'hôte…";
}

// `esc` est reexporte pour les jeux qui construisent du HTML a la main.
export { esc };

show('home');
