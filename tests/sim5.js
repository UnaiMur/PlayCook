// Partie complete de « Qui dans le groupe ? » a 4 joueurs, sans navigateur.
// Verifie : ecriture des questions, secret des questions des autres, vote,
// majorite, points aux bons votants, cloture anticipee, et classement final.
import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';
const GAME = 'qui-dans-le-groupe';
const ROUNDS = Number(process.env.QDG_ROUNDS || 8);
const POINTS = Number(process.env.QDG_POINTS || 100);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const check = (ok, l) => { if (!ok) problems.push(l); };
const act = (s, type, data) => s.emit('game:action', { type, data });
const gphase = (st) => (st?.phase === 'GAME' ? st.view?.phase : st?.phase);

const mk = (pseudo) => {
  const s = io(URL, { transports: ['websocket'] });
  const c = { s, pseudo, state: null, errors: [] };
  s.on('room:joined', ({ playerId, code }) => { c.id = playerId; c.code = code; });
  s.on('room:state', (st) => { c.state = st; });
  s.on('error:msg', (m) => c.errors.push(m));
  return c;
};
const until = async (fn, l, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(25); }
  problems.push(`timeout : ${l}`); return false;
};

(async () => {
  // --- le jeu est bien publie par la plateforme ----------------------------
  const menu = await (await fetch(`${URL}/api/games`)).json();
  const fiche = menu.find((g) => g.id === GAME);
  check(!!fiche, 'le jeu n\'apparait pas dans /api/games');
  check(fiche?.minPlayers === 3, 'le minimum de joueurs annonce n\'est pas 3');
  check(fiche?.rules?.length >= 3, 'les regles ne sont pas exposees au menu');

  const a = mk('Alice'); a.s.emit('room:create', { pseudo: 'Alice', gameId: GAME });
  await until(() => a.code, 'creation');
  const b = mk('Bob'); b.s.emit('room:join', { code: a.code, pseudo: 'Bob' });
  const c = mk('Cook'); c.s.emit('room:join', { code: a.code, pseudo: 'Cook' });
  await until(() => a.state?.players.length === 3, '3 joueurs');
  check(a.state.game.id === GAME, 'le salon n\'a pas ouvert le bon jeu');

  // --- a 2 joueurs on ne peut pas demarrer (minPlayers = 3) ----------------
  // (deja 3 ici : on verifie plutot que la plateforme autorise le depart)
  check(a.state.canStart === true, "l'hote ne peut pas demarrer a 3 joueurs");

  a.s.emit('game:start');
  await until(() => gphase(a.state) === 'WRITING', 'phase d\'ecriture');

  // --- ecriture ------------------------------------------------------------
  act(a.s, 'add', { text: 'court' });
  await wait(100);
  check(
    a.errors.some((m) => /trop courte/i.test(m)),
    'une question de 5 caracteres a ete acceptee'
  );
  check(a.state.view.myQuestions.length === 0, 'la question trop courte est passee quand meme');

  act(a.s, 'add', { text: 'Qui oublierait son propre anniversaire ?' });
  act(a.s, 'add', { text: 'Qui parlerait a un distributeur en panne ?' });
  act(a.s, 'add', { text: 'Qui depasserait la limite de deux questions ?' });
  act(b.s, 'add', { text: 'Qui partirait en vacances sans valise ?' });
  await until(() => a.state.view.myQuestions.length === 2, 'Alice a deux questions');
  check(
    a.state.view.myQuestions.length === 2,
    'la limite de questions par joueur n\'est pas respectee'
  );
  check(
    JSON.stringify(a.state).includes('valise') === false,
    'Alice voit la question de Bob avant la partie'
  );
  check(a.state.view.total === 3, `le compteur commun annonce ${a.state.view.total} au lieu de 3`);

  // Ecrire est facultatif : Cook ne propose rien.
  [a, b, c].forEach((cl) => cl.s.emit('player:ready', { ready: true }));
  await until(() => a.state?.view?.canBegin === true, 'tout le monde pret');

  // --- la partie ------------------------------------------------------------
  const vues = new Set();
  let cloturesAnticipees = 0;

  const pump = setInterval(() => {
    for (const cl of [a, b, c]) {
      const v = cl.state?.view;
      if (gphase(cl.state) === 'VOTING' && v.round && !v.round.myVote) {
        vues.add(v.round.text);
        // Tout le monde designe Cook : la majorite doit etre nette.
        act(cl.s, 'vote', { targetId: c.id });
      }
    }
    if (gphase(a.state) === 'REVEAL') act(a.s, 'skip');
  }, 50);

  act(a.s, 'begin');

  // La manche doit se cloturer des que les trois ont vote, sans attendre le
  // chrono (25 s par defaut) : on mesure le temps jusqu'a la revelation.
  const t0 = Date.now();
  await until(() => gphase(a.state) === 'REVEAL', 'premiere revelation', 20000);
  if (Date.now() - t0 < 3000) cloturesAnticipees += 1;

  const premier = a.state.view.reveal;
  check(premier?.winners?.length === 1 && premier.winners[0] === 'Cook',
    `la majorite n'a pas designe Cook (${premier?.winners})`);
  check(premier?.tally?.[0]?.count === 3, 'le decompte des voix est faux');
  const gainAlice = premier?.scores.find((p) => p.pseudo === 'Alice')?.delta;
  check(gainAlice === POINTS, `Alice devrait gagner ${POINTS} points, elle en a ${gainAlice}`);
  const gainCook = premier?.scores.find((p) => p.pseudo === 'Cook')?.delta;
  check(gainCook === POINTS, 'Cook a vote pour lui-meme : il fait partie de la majorite');

  await until(() => a.state?.phase === 'SCORES', 'classement final', 60000);
  clearInterval(pump);

  check(vues.size === ROUNDS, `${ROUNDS} questions attendues, ${vues.size} jouees`);
  check(cloturesAnticipees === 1, 'la manche a attendu le chrono alors que tout le monde avait vote');
  const total = a.state.ranking.reduce((n, p) => n + p.score, 0);
  check(total === ROUNDS * 3 * POINTS, `total de points incoherent (${total})`);

  console.log('\nClassement final');
  for (const p of a.state.ranking) console.log(`  ${p.pseudo.padEnd(7)} ${p.score} pts`);
  console.log(`\nQuestions jouees : ${vues.size}`);

  console.log(problems.length
    ? `\n✗ ${problems.length} probleme(s) :`
    : '\n✓ qui-dans-le-groupe : ecriture, secret, majorite, points et enchainement OK');
  problems.forEach((p) => console.log('  - ' + p));
  [a, b, c].forEach((x) => x.s.close());
  process.exit(problems.length ? 1 : 0);
})();
