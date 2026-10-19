// Partie complete de « Qui regarde ça ? » a 3 joueurs, sans navigateur.
//
// La recherche TMDB a besoin d'une cle, mais la MECANIQUE n'en a pas besoin :
// le serveur valide ce que le client lui envoie sans rappeler TMDB. Ce test
// joue donc une partie entiere hors ligne, et verifie en plus que la recherche
// echoue proprement quand la cle est absente.
import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';
const GAME = 'qui-regarde-ca';
const POSTER = 'https://image.tmdb.org/t/p/w342/abc123.jpg';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const check = (ok, l) => { if (!ok) problems.push(l); };
const act = (s, type, data) => s.emit('game:action', { type, data });
const gphase = (st) => (st?.phase === 'GAME' ? st.view?.phase : st?.phase);

const titre = (who, i) => ({
  tmdbId: `${100 + i}${who.length}`,
  kind: i % 2 ? 'film' : 'série',
  title: `Titre ${who}${i}`,
  year: '2019',
  poster: POSTER,
});

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
  // --- le jeu est publie par la plateforme --------------------------------
  const menu = await (await fetch(`${URL}/api/games`)).json();
  const fiche = menu.find((g) => g.id === GAME);
  check(!!fiche, "le jeu n'apparait pas dans /api/games");
  check(fiche?.rules?.length >= 3, 'les regles ne sont pas exposees au menu');

  // --- sans cle TMDB, la recherche doit le dire clairement -----------------
  const r = await fetch(`${URL}/api/quiregardeca/search?q=dexter`);
  const body = await r.json().catch(() => ({}));
  if (process.env.TMDB_API_KEY || process.env.TMDB_TOKEN) {
    check(r.ok, `la recherche TMDB echoue alors qu'une cle est fournie (${JSON.stringify(body)})`);
    if (r.ok) {
      check(Array.isArray(body), 'la recherche ne renvoie pas une liste');
      const bon = body.every((t) => t.tmdbId && t.title && ['film', 'série'].includes(t.kind));
      check(bon, 'un resultat TMDB est mal forme');
      console.log(`Recherche TMDB : ${body.length} resultat(s) pour « dexter »`);
      if (body[0]) console.log(`  ex. ${body[0].title} (${body[0].kind}, ${body[0].year})`);
    }
  } else {
    check(r.status === 503 && body.error === 'nokey',
      `sans cle, la recherche devrait repondre 503/nokey (recu ${r.status}/${body.error})`);
    console.log('Pas de cle TMDB : la recherche repond bien « nokey ».');
  }

  // --- une partie complete, sans toucher a TMDB ----------------------------
  const a = mk('Alice'); a.s.emit('room:create', { pseudo: 'Alice', gameId: GAME });
  await until(() => a.code, 'creation');
  const b = mk('Bob'); b.s.emit('room:join', { code: a.code, pseudo: 'Bob' });
  const c = mk('Cook'); c.s.emit('room:join', { code: a.code, pseudo: 'Cook' });
  await until(() => a.state?.players.length === 3, '3 joueurs');
  check(a.state.game.id === GAME, "le salon n'a pas ouvert le bon jeu");

  a.s.emit('game:start');
  await until(() => gphase(a.state) === 'PICKING', 'phase de selection');

  // Une affiche qui ne vient pas de TMDB doit etre refusee
  act(a.s, 'submit', { ...titre('Pirate', 1), poster: 'https://evil.example.com/a.jpg' });
  // Une categorie inventee aussi
  act(a.s, 'submit', { ...titre('Pirate', 2), kind: 'documentaire' });
  await wait(150);
  check(a.state.view.mySubmissions.length === 0,
    'une affiche ou une categorie arbitraire a ete acceptee');
  check(a.errors.filter((m) => /invalide/i.test(m)).length === 2,
    'les soumissions invalides ne sont pas signalees au joueur');

  for (const cl of [a, b, c]) for (let i = 0; i < 3; i++) act(cl.s, 'submit', titre(cl.pseudo, i));
  await until(() => [a, b, c].every((cl) => a.state.view.counts[cl.id] === 3), 'selections completes');

  // Chacun ne voit que sa propre selection
  check(a.state.view.mySubmissions.length === 3, 'Alice ne voit pas ses 3 titres');
  check(JSON.stringify(a.state).includes('TitreBob') === false,
    'Alice voit la selection de Bob pendant la phase de choix');

  // Deux fois le meme titre pour un meme joueur : refuse
  const avant = a.state.view.mySubmissions.length;
  act(a.s, 'submit', titre('Alice', 0));
  await wait(150);
  check(a.state.view.mySubmissions.length === avant, 'un joueur a pu soumettre deux fois le meme titre');
  check(a.errors.some((m) => /déjà choisi/i.test(m)), 'le doublon n\'est pas signale');

  // Personne n'est pret : l'hote ne peut pas lancer
  check(a.state.view.canBegin === false, "l'hote peut demarrer alors que personne n'est pret");
  [a, b, c].forEach((cl) => cl.s.emit('player:ready', { ready: true }));
  await until(() => a.state?.view?.canBegin === true, 'tout le monde pret');

  const vus = new Set();
  const leaks = [];
  for (const cl of [a, b, c]) {
    cl.s.on('room:state', (st) => {
      if (gphase(st) === 'PLAYING' && /ownerIds/.test(JSON.stringify(st))) {
        leaks.push(`${cl.pseudo} tour ${st.view.round.index}`);
      }
    });
  }

  act(a.s, 'begin');

  const pump = setInterval(() => {
    for (const cl of [a, b, c]) {
      const v = cl.state?.view;
      if (gphase(cl.state) !== 'PLAYING' || !v.round) continue;
      vus.add(v.round.title);
      if (v.round.canVote && !v.round.myVote) {
        act(cl.s, 'vote', { suspectId: v.round.suspects[0].id });
      }
    }
    if (gphase(a.state) === 'REVEAL') act(a.s, 'skip');
  }, 50);

  await until(() => a.state?.phase === 'SCORES', 'classement final', 60000);
  clearInterval(pump);

  check(vus.size === 9, `9 titres attendus, ${vus.size} joues`);
  check(leaks.length === 0, `fuite des proprietaires : ${leaks.join(', ')}`);
  const total = a.state.ranking.reduce((n, p) => n + p.score, 0);
  check(total > 0, 'aucun point distribue sur toute la partie');

  console.log('\nClassement final');
  for (const p of a.state.ranking) console.log(`  ${p.pseudo.padEnd(7)} ${p.score} pts`);
  console.log(`\nTitres joues : ${vus.size}`);

  console.log(problems.length
    ? `\n✗ ${problems.length} probleme(s) :`
    : '\n✓ qui-regarde-ca : validation, secret, partie complete OK');
  problems.forEach((p) => console.log('  - ' + p));
  [a, b, c].forEach((x) => x.s.close());
  process.exit(problems.length ? 1 : 0);
})();
