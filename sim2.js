import { io } from 'socket.io-client';
const URL = 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const check = (ok, l) => { if (!ok) problems.push(l); };

const mk = (pseudo, playerId) => {
  const s = io(URL, { transports: ['websocket'] });
  const c = { s, pseudo, id: playerId || null, state: null };
  s.on('room:joined', ({ playerId: id, code }) => { c.id = id; c.code = code; });
  s.on('room:state', (st) => { c.state = st; });
  return c;
};
const until = async (fn, l, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(25); }
  problems.push(`timeout : ${l}`); return false;
};

(async () => {
  const a = mk('Alice'); a.s.emit('room:create', { pseudo: 'Alice' });
  await until(() => a.code, 'creation');
  const code = a.code;
  const b = mk('Bob'); b.s.emit('room:join', { code, pseudo: 'Bob' });
  const c = mk('Cook'); c.s.emit('room:join', { code, pseudo: 'Cook' });
  await until(() => a.state?.players.length === 3, '3 joueurs');

  a.s.emit('phase:picking');
  await until(() => a.state?.phase === 'PICKING', 'selection');
  for (const cl of [a, b, c])
    for (let i = 0; i < 3; i++)
      cl.s.emit('track:submit', { trackKey: `${200 + i}${cl.pseudo.length}`, title: `T${cl.pseudo}${i}`, artist: 'A', artwork: '' });
  await until(() => a.state?.players.every((p) => p.trackCount === 3), 'selections completes');
  [a, b, c].forEach((cl) => cl.s.emit('player:ready', { ready: true }));
  await until(() => a.state?.canStart === true, 'tout le monde pret');

  a.s.emit('game:start');
  await until(() => a.state?.phase === 'PLAYING', 'lecture');

  // --- F5 de Bob en pleine partie -----------------------------------------
  const bobId = b.id;
  const bobScoreAvant = a.state.players.find((p) => p.pseudo === 'Bob').score;
  b.s.close();
  await wait(200);
  check(a.state.players.find((p) => p.pseudo === 'Bob').connected === false, 'Bob devrait apparaitre deconnecte');

  const b2 = mk('Bob', bobId);
  b2.s.emit('room:join', { code, pseudo: 'Bob', playerId: bobId });
  await until(() => b2.state?.phase, 'reconnexion de Bob');
  check(b2.id === bobId, 'Bob a recu un nouvel identifiant au lieu de retrouver le sien');
  check(a.state.players.find((p) => p.pseudo === 'Bob').connected === true, 'Bob toujours marque deconnecte');
  check(a.state.players.find((p) => p.pseudo === 'Bob').score === bobScoreAvant, 'le score de Bob a bouge au retour');
  check(a.state.players.length === 3, `${a.state.players.length} joueurs au lieu de 3 : un doublon a ete cree`);
  check(['PLAYING', 'REVEAL'].includes(b2.state.phase), 'Bob ne retombe pas dans la partie en cours');

  // --- deconnexion pendant la REVELATION -----------------------------------
  await until(() => a.state?.phase === 'REVEAL', 'revelation', 8000);
  const avant = a.state.players.map((p) => `${p.pseudo}:${p.score}`).join(' ');
  c.s.close();
  await wait(300);
  const apres = a.state.players.map((p) => `${p.pseudo}:${p.score}`).join(' ');
  check(avant === apres, `scores doubles pendant la revelation : ${avant} -> ${apres}`);

  // --- l'hote quitte pendant la REVELATION ---------------------------------
  // Plus de timer automatique : si personne ne reprend la main, la partie gele.
  check(b2.state.phase === 'REVEAL', 'Bob devrait etre sur la revelation');
  check(b2.state.youAreHost === false, 'Bob est deja hote avant le depart d\'Alice');
  a.s.close();
  await until(() => b2.state?.youAreHost === true, 'Bob promu hote apres le depart d\'Alice');

  const tourAvant = b2.state.reveal?.index;
  b2.s.emit('round:skip');
  await until(
    () => b2.state?.phase === 'PLAYING' || b2.state?.reveal?.index > tourAvant || b2.state?.phase === 'SCORES',
    'le nouvel hote peut relancer la partie'
  );

  console.log(problems.length ? `✗ ${problems.length} probleme(s) :` : '✓ reconnexion, deconnexion et reprise de l\'hote OK');
  problems.forEach((p) => console.log('  - ' + p));
  [b2, c].forEach((x) => x.s.close());
  process.exit(problems.length ? 1 : 0);
})();
