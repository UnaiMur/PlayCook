// Simulation d'une partie complete a 3 joueurs, sans navigateur.
// Verifie : lobby -> selection -> lecture -> votes -> revelation -> classement,
// le secret des proprietaires, le doublon joue deux fois, et les scores.
import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';
const PSEUDOS = ['Alice', 'Bob', 'Cook'];
const SHARED = { trackKey: '999', title: 'Morceau partagé', artist: 'X', artwork: '', previewUrl: 'https://audio-ssl.itunes.apple.com/x/9.m4a' };

const fakeTrack = (who, i) => ({
  trackKey: `${who}-${i}`,
  title: `Titre ${who}${i}`,
  artist: `Artiste ${who}`,
  artwork: '',
  previewUrl: `https://audio-ssl.itunes.apple.com/x/${who}${i}.m4a`,
});

const problems = [];
const check = (ok, label) => { if (!ok) problems.push(label); };

const clients = [];
let roomCode = null;
let finished = null;
const seenRounds = [];
const leaks = [];

function makeClient(idx) {
  const s = io(URL, { transports: ['websocket'] });
  const c = { s, idx, pseudo: PSEUDOS[idx], id: null, state: null };

  const EXPECTED = [/déjà choisi ce morceau/, /^En attente de /, /^Morceau invalide$/];
  s.on('error:msg', (m) => { if (!EXPECTED.some((re) => re.test(m))) problems.push(`[${c.pseudo}] erreur serveur : ${m}`); });
  s.on('room:joined', ({ code, playerId }) => { c.id = playerId; if (idx === 0) roomCode = code; });

  s.on('room:state', (st) => {
    c.state = st;

    // Aucun etat envoye au client ne doit contenir d'identite de proprietaire
    const raw = JSON.stringify(st);
    if (st.phase === 'PLAYING' && /ownerIds/.test(raw)) leaks.push(`${c.pseudo} tour ${st.round.index}`);

    if (st.phase === 'PLAYING') {
      const tag = `${st.round.index}:${st.round.title}`;
      if (idx === 0 && !seenRounds.includes(tag)) seenRounds.push(tag);
      if (st.round.canVote && !st.round.myVote) {
        const pick = st.round.suspects[Math.floor(Math.random() * st.round.suspects.length)];
        setTimeout(() => s.emit('vote:cast', { suspectId: pick.id }), 20);
      }
    }

    if (st.phase === 'REVEAL' && st.youAreHost) {
      setTimeout(() => s.emit('round:skip'), 30);
    }

    if (st.phase === 'SCORES' && idx === 0) finished?.(st);
  });

  clients.push(c);
  return c;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(25); }
  problems.push(`timeout : ${label}`);
  return false;
};

(async () => {
  const [a, b, c] = [makeClient(0), makeClient(1), makeClient(2)];

  a.s.emit('room:create', { pseudo: 'Alice' });
  await until(() => roomCode, 'creation de la partie');
  b.s.emit('room:join', { code: roomCode, pseudo: 'Bob' });
  c.s.emit('room:join', { code: roomCode, pseudo: 'Cook' });
  await until(() => a.state?.players.length === 3, '3 joueurs dans le salon');

  // Demarrage interdit a un non-hote
  b.s.emit('phase:picking');
  await wait(100);
  check(a.state.phase === 'LOBBY', 'un non-hote a pu lancer la selection');

  a.s.emit('phase:picking');
  await until(() => a.state?.phase === 'PICKING', 'passage en selection');

  // Alice et Bob prennent le MEME morceau -> doit passer deux fois
  a.s.emit('track:submit', SHARED);
  b.s.emit('track:submit', SHARED);
  for (const cl of clients) for (let i = 0; i < 2; i++) cl.s.emit('track:submit', fakeTrack(cl.pseudo, i));
  c.s.emit('track:submit', fakeTrack('Cook', 9));
  await until(() => a.state?.players.every((p) => p.trackCount >= 3), 'chacun a 3 morceaux');

  // Chaque joueur ne voit QUE sa propre selection
  check(a.state.mySubmissions.length === 3, 'Alice ne voit pas ses 3 morceaux');
  check(JSON.stringify(a.state).indexOf('TitreBob') === -1, 'Alice voit la selection de Bob');
  // ...mais avec l'URL audio, pour pouvoir reecouter ses propres choix
  check(
    a.state.mySubmissions.every((m) => typeof m.previewUrl === 'string' && m.previewUrl.startsWith('https://')),
    'previewUrl absente de ma propre selection : impossible de reecouter'
  );
  check(
    JSON.stringify(a.state).indexOf('/Bob') === -1,
    'une URL audio appartenant a Bob est visible par Alice'
  );

  // Doublon refuse pour un meme joueur
  a.s.emit('track:submit', SHARED);
  await wait(100);
  check(a.state.mySubmissions.length === 3, 'un joueur a pu soumettre deux fois le meme morceau');

  // Une URL qui ne vient pas d'Apple doit etre refusee
  const avantPirate = a.state.mySubmissions.length;
  a.s.emit('track:submit', { trackKey: 'pirate', title: 'X', artist: 'X', artwork: '', previewUrl: 'https://evil.example.com/a.mp3' });
  await wait(120);
  check(a.state.mySubmissions.length === avantPirate, 'une URL arbitraire a ete acceptee comme morceau');

  // Personne n'est pret : l'hote ne doit pas pouvoir demarrer
  check(a.state.canStart === false, "l'hote peut demarrer alors que personne n'est pret");
  a.s.emit('game:start');
  await wait(150);
  check(a.state.phase === 'PICKING', 'la partie a demarre sans que tout le monde soit pret');

  clients.forEach((cl) => cl.s.emit('player:ready', { ready: true }));
  await until(() => a.state?.canStart === true, 'tout le monde pret');

  finished = (st) => {
    console.log('\nClassement final');
    for (const p of st.ranking) console.log(`  ${p.pseudo.padEnd(8)} ${p.score} pts`);

    const total = st.ranking.reduce((n, p) => n + p.score, 0);
    const rounds = seenRounds.length;
    const shared = seenRounds.filter((r) => r.includes('partagé')).length;

    console.log(`\nTours joues        : ${rounds}`);
    console.log(`Morceau partage    : ${shared} passage(s)`);
    console.log(`Points distribues  : ${total}`);

    check(rounds === 9, `9 tours attendus, ${rounds} joues`);
    check(shared === 2, `le doublon devait passer 2 fois, il est passe ${shared} fois`);
    check(leaks.length === 0, `fuite des proprietaires : ${leaks.join(', ')}`);
    // 2 votants par tour, chacun rapporte 100 (bon) ou 50 au proprietaire (rate)
    check(total % 50 === 0 && total >= 9 * 100 && total <= 9 * 200, `total de points incoherent (${total})`);

    console.log(problems.length ? `\n✗ ${problems.length} probleme(s) :` : '\n✓ tout passe');
    problems.forEach((p) => console.log('  - ' + p));
    clients.forEach((x) => x.s.close());
    process.exit(problems.length ? 1 : 0);
  };

  a.s.emit('game:start');
  await until(() => false, 'fin de partie', 25000);
  console.log('✗ la partie ne s\'est pas terminee');
  problems.forEach((p) => console.log('  - ' + p));
  process.exit(1);
})();
