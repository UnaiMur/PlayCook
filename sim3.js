// Verifie qu'un tour va jusqu'au bout du morceau meme si tout le monde
// a vote immediatement, et que le recapitulatif des points arrive bien.
import { io } from 'socket.io-client';
const URL = 'http://localhost:3000';
const VOTE_MS = Number(process.env.VOTE_MS || 4000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const check = (ok, l) => { if (!ok) problems.push(l); };

let tPlaying = null, tReveal = null, reveal = null;

const mk = (pseudo, isA) => {
  const s = io(URL, { transports: ['websocket'] });
  const c = { s, pseudo, state: null };
  s.on('room:joined', ({ code }) => { c.code = code; });
  s.on('room:state', (st) => {
    c.state = st;
    if (st.phase === 'PLAYING') {
      if (isA && st.round.index === 1 && tPlaying === null) tPlaying = Date.now();
      if (st.round.canVote && !st.round.myVote) s.emit('vote:cast', { suspectId: st.round.suspects[0].id });
    }
    if (st.phase === 'REVEAL' && isA && tReveal === null) { tReveal = Date.now(); reveal = st.reveal; }
  });
  return c;
};
const until = async (fn, l, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(25); }
  problems.push(`timeout : ${l}`); return false;
};

(async () => {
  const a = mk('Alice', true); a.s.emit('room:create', { pseudo: 'Alice' });
  await until(() => a.code, 'creation');
  const b = mk('Bob'); b.s.emit('room:join', { code: a.code, pseudo: 'Bob' });
  const c = mk('Cook'); c.s.emit('room:join', { code: a.code, pseudo: 'Cook' });
  await until(() => a.state?.players.length === 3, '3 joueurs');

  a.s.emit('phase:picking');
  await until(() => a.state?.phase === 'PICKING', 'selection');
  for (const cl of [a, b, c])
    for (let i = 0; i < 3; i++)
      cl.s.emit('track:submit', { trackKey: `${200 + i}${cl.pseudo.length}`, title: `T${i}`, artist: 'A', artwork: '' });
  await until(() => a.state?.players.every((p) => p.trackCount === 3), 'selections');

  [a, b, c].forEach((cl) => cl.s.emit('player:ready', { ready: true }));
  await until(() => a.state?.canStart === true, 'tous prets');

  a.s.emit('game:start');
  await until(() => tReveal !== null, 'premiere revelation');

  const duree = tReveal - tPlaying;
  console.log(`Duree du tour : ${duree} ms (fenetre configuree : ${VOTE_MS} ms)`);
  check(duree >= VOTE_MS * 0.9, `le tour a ete coupe court (${duree} ms) : les votes ont interrompu le morceau`);
  check(Array.isArray(reveal?.scores) && reveal.scores.length === 3, 'le recapitulatif des points est absent');
  if (reveal?.scores) {
    console.log('Recapitulatif recu :');
    reveal.scores.forEach((p) => console.log(`  ${p.pseudo.padEnd(7)} ${p.delta >= 0 ? '+' : ''}${p.delta} -> ${p.score} pts`));
    check(reveal.scores.some((p) => p.delta !== 0), 'aucun joueur ne gagne de points au premier tour');
    const trie = reveal.scores.every((p, i, t) => i === 0 || t[i - 1].score >= p.score);
    check(trie, 'le recapitulatif n\'est pas trie par score decroissant');
  }

  console.log(problems.length ? `\n✗ ${problems.length} probleme(s) :` : '\n✓ le morceau va au bout et le recap arrive');
  problems.forEach((p) => console.log('  - ' + p));
  [a, b, c].forEach((x) => x.s.close());
  process.exit(problems.length ? 1 : 0);
})();
