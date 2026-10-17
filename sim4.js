// Verifie la PLATEFORME, pas le jeu : cycle salon -> partie -> classement ->
// retour au salon, choix du jeu reserve a l'hote, et remise a zero des scores.
import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const check = (ok, l) => { if (!ok) problems.push(l); };
const act = (s, type, data) => s.emit('game:action', { type, data });
const gphase = (st) => (st?.phase === 'GAME' ? st.view?.phase : st?.phase);

const mk = (pseudo) => {
  const s = io(URL, { transports: ['websocket'] });
  const c = { s, pseudo, state: null };
  s.on('room:joined', ({ playerId, code }) => { c.id = playerId; c.code = code; });
  s.on('room:state', (st) => { c.state = st; });
  s.on('error:msg', (m) => { c.lastError = m; });
  return c;
};
const until = async (fn, l, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(25); }
  problems.push(`timeout : ${l}`); return false;
};

// Joue une partie complete de blind test, le plus vite possible.
async function playThrough(host, all) {
  host.s.emit('game:start');
  await until(() => gphase(host.state) === 'PICKING', 'selection');
  for (const cl of all) {
    for (let i = 0; i < 3; i++) {
      act(cl.s, 'submit', { trackKey: `${300 + i}${cl.pseudo.length}`, title: `T${cl.pseudo}${i}`, artist: 'A', artwork: '' });
    }
  }
  await until(() => all.every((cl) => host.state.view.counts[cl.id] === 3), 'selections');
  all.forEach((cl) => cl.s.emit('player:ready', { ready: true }));
  await until(() => host.state?.view?.canBegin === true, 'tous prets');
  act(host.s, 'begin');

  // Vote au hasard et enchaine les revelations jusqu'au classement.
  const pump = setInterval(() => {
    for (const cl of all) {
      const v = cl.state?.view;
      if (gphase(cl.state) === 'PLAYING' && v.round.canVote && !v.round.myVote) {
        act(cl.s, 'vote', { suspectId: v.round.suspects[0].id });
      }
    }
    if (gphase(host.state) === 'REVEAL') act(host.s, 'skip');
  }, 60);

  await until(() => host.state?.phase === 'SCORES', 'classement final', 40000);
  clearInterval(pump);
}

(async () => {
  const a = mk('Alice'); a.s.emit('room:create', { pseudo: 'Alice' });
  await until(() => a.code, 'creation');
  const b = mk('Bob'); b.s.emit('room:join', { code: a.code, pseudo: 'Bob' });
  await until(() => a.state?.players.length === 2, '2 joueurs');

  // --- le salon decrit le catalogue ---------------------------------------
  check(a.state.phase === 'LOBBY', 'le salon ne demarre pas en LOBBY');
  check(a.state.view === undefined, 'une vue de jeu fuit alors quaucune partie ne tourne');
  const cat = a.state.catalogue;
  check(Array.isArray(cat) && cat.every((g) => g.id && g.name && g.minPlayers), 'catalogue incomplet');
  check(a.state.canStart === true, "l'hote ne peut pas demarrer a 2 joueurs");
  check(b.state.canStart === undefined || b.state.canStart === false, 'un non-hote se croit autorise a demarrer');

  // --- seul l'hote choisit le jeu -----------------------------------------
  const autre = cat.find((g) => g.id !== a.state.game.id);
  if (autre) {
    b.s.emit('lobby:select', { gameId: autre.id });
    await wait(120);
    check(a.state.game.id !== autre.id, 'un non-hote a pu changer de jeu');
    a.s.emit('lobby:select', { gameId: autre.id });
    await until(() => a.state.game.id === autre.id, "l'hote ne peut pas changer de jeu");
    a.s.emit('lobby:select', { gameId: 'blindtest' });
    await until(() => a.state.game.id === 'blindtest', 'retour au blind test');
  }
  a.s.emit('lobby:select', { gameId: 'jeu-qui-nexiste-pas' });
  await wait(100);
  check(a.state.game.id === 'blindtest', 'un identifiant de jeu inconnu a ete accepte');

  // --- une partie complete -------------------------------------------------
  await playThrough(a, [a, b]);
  check(Array.isArray(a.state.ranking) && a.state.ranking.length === 2, 'classement final absent');
  const total = a.state.ranking.reduce((n, p) => n + p.score, 0);
  check(total > 0, 'personne na marque de point sur toute la partie');
  check(a.state.view === undefined, 'la vue du jeu survit au classement');

  // --- retour au salon ------------------------------------------------------
  b.s.emit('lobby:return');
  await wait(120);
  check(a.state.phase === 'SCORES', 'un non-hote a pu ramener tout le monde au salon');

  a.s.emit('lobby:return');
  await until(() => a.state?.phase === 'LOBBY', 'retour au salon');
  check(a.state.players.every((p) => p.score === 0), 'les scores ne sont pas remis a zero');
  check(a.state.players.every((p) => !p.ready), 'les drapeaux "pret" survivent a la partie');

  // --- on enchaine une deuxieme partie -------------------------------------
  await playThrough(a, [a, b]);
  check(a.state.phase === 'SCORES', 'la deuxieme partie ne va pas au bout');
  check(
    a.state.ranking.reduce((n, p) => n + p.score, 0) > 0,
    'la deuxieme partie ne distribue aucun point'
  );

  console.log(problems.length
    ? `✗ ${problems.length} probleme(s) :`
    : '✓ plateforme : catalogue, droits de lhote, cycle complet et enchainement OK');
  problems.forEach((p) => console.log('  - ' + p));
  [a, b].forEach((x) => x.s.close());
  process.exit(problems.length ? 1 : 0);
})();
