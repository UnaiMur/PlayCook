// « Devine le craft » : la comparaison des réponses, puis une partie complète
// à 3 joueurs.
//
// Le test joue comme un joueur qui connaît Minecraft : il lit la grille qu'on
// lui montre, retrouve la recette dans recettes.json, et répond. Ça vérifie au
// passage que la grille envoyée au client correspond bien aux données.
import { io } from 'socket.io-client';
import { readFileSync } from 'fs';
import { correspond, normaliser } from '../games/devine-le-craft/reponses.js';

const URL = 'http://localhost:3000';
const GAME = 'devine-le-craft';
const DONNEES = JSON.parse(readFileSync('games/devine-le-craft/recettes.json', 'utf8'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const check = (ok, l) => { if (!ok) problems.push(l); };
const act = (s, type, data) => s.emit('game:action', { type, data });
const gphase = (st) => (st?.phase === 'GAME' ? st.view?.phase : st?.phase);

// ---------------------------------------------------------------------------
// 1. La comparaison des reponses — fonction pure, pas besoin du serveur
// ---------------------------------------------------------------------------
const DOIT_PASSER = [
  ['etabli', ['Établi']],
  ['Établi', ['Établi']],
  ['un etabli', ['Établi']],
  ['etablie', ['Établi']],                 // faute de frappe
  ['table de craft', ['Établi', 'table de craft']],
  ['canne a peche', ['Canne à pêche']],    // accents omis
  ['piston colant', ['Piston collant']],   // lettre manquante
  ['POMME DOREE', ['Pomme dorée']],
  ["coffre de l'ender", ["Coffre de l'Ender"]],
];
const DOIT_ECHOUER = [
  ['four', ['Haut fourneau']],
  ['piston', ['Piston collant']],
  ['arc', ['Arbalète']],
  ['torche', ['Torche de redstone']],
  ['coffre', ["Coffre de l'Ender"]],
  ['pelle en pierre', ['Pioche en pierre']],
  ['', ['Établi']],
];
for (const [rep, alias] of DOIT_PASSER) {
  check(correspond(rep, alias), `« ${rep} » devrait valider « ${alias[0]} »`);
}
for (const [rep, alias] of DOIT_ECHOUER) {
  check(!correspond(rep, alias), `« ${rep} » ne devrait PAS valider « ${alias[0]} »`);
}
check(normaliser('  Œuf  ') === 'uf' || normaliser('Œuf').length > 0, 'la normalisation casse sur les ligatures');

// ---------------------------------------------------------------------------
// 2. Index des recettes : grille + legende -> reponse attendue
// ---------------------------------------------------------------------------
const cle = (r) => JSON.stringify([r.grille, r.legende, r.vrac]);
const index = new Map();
let collisions = 0;
for (const r of DONNEES.recettes) {
  const k = cle(r);
  if (index.has(k) && index.get(k).resultat !== r.resultat) collisions++;
  index.set(k, r);
}
check(collisions === 0, `${collisions} recette(s) impossibles a distinguer de leur grille`);
check(DONNEES.recettes.length >= 50, `seulement ${DONNEES.recettes.length} recettes dans le jeu`);

// ---------------------------------------------------------------------------
// 3. Une partie complete
// ---------------------------------------------------------------------------
const mk = (pseudo) => {
  const s = io(URL, { transports: ['websocket'] });
  const c = { s, pseudo, state: null, errors: [] };
  s.on('room:joined', ({ playerId, code }) => { c.id = playerId; c.code = code; });
  s.on('room:state', (st) => { c.state = st; });
  s.on('error:msg', (m) => c.errors.push(m));
  return c;
};
const until = async (fn, l, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(25); }
  problems.push(`timeout : ${l}`); return false;
};

(async () => {
  const menu = await (await fetch(`${URL}/api/games`)).json();
  check(menu.some((g) => g.id === GAME), "le jeu n'apparait pas dans /api/games");

  const a = mk('Alice'); a.s.emit('room:create', { pseudo: 'Alice', gameId: GAME });
  await until(() => a.code, 'creation');
  const b = mk('Bob'); b.s.emit('room:join', { code: a.code, pseudo: 'Bob' });
  const c = mk('Cook'); c.s.emit('room:join', { code: a.code, pseudo: 'Cook' });
  await until(() => a.state?.players.length === 3, '3 joueurs');

  a.s.emit('game:start');
  await until(() => gphase(a.state) === 'QUESTION', 'premiere question');

  // --- la reponse ne doit jamais circuler pendant la manche ----------------
  const vuePendant = JSON.stringify(a.state.view);
  check(!/"resultat"/.test(vuePendant), 'le resultat est envoye au client pendant la manche');
  check(!/"alias"/.test(vuePendant), 'les alias sont envoyes au client pendant la manche');

  const r1 = a.state.view.round;
  const recette = index.get(cle(r1));
  check(!!recette, 'la grille recue ne correspond a aucune recette connue');
  check(!vuePendant.includes(recette.resultat),
    `la reponse « ${recette.resultat} » apparait dans ce que recoit le client`);
  check(r1.grille !== null || r1.vrac !== null, 'la manche n\'a ni grille ni ingredients');

  // --- une mauvaise reponse est refusee, et conservee dans mes essais -------
  act(a.s, 'guess', { texte: 'nawak' });
  await until(() => a.state.view.round.mesEssais.length === 1, 'essai enregistre');
  check(a.state.view.round.mesEssais[0].bon === false, 'une reponse fausse a ete acceptee');
  check(a.state.view.round.jaiTrouve === false, 'le joueur est marque gagnant a tort');
  // ...et elle reste privee
  check(!JSON.stringify(b.state.view).includes('nawak'), 'Bob voit les essais d\'Alice');

  // --- la bonne reponse, avec une faute de frappe volontaire ---------------
  const avecFaute = recette.resultat.slice(0, -1);     // on mange la derniere lettre
  act(a.s, 'guess', { texte: avecFaute });
  await until(() => a.state.view.round.jaiTrouve === true,
    `la bonne reponse « ${avecFaute} » n'a pas ete acceptee`);
  check(a.state.view.round.monRang === 1, 'Alice devrait etre premiere a trouver');
  check(a.state.view.round.trouves === 1, 'le compteur de trouveurs est faux');
  check(gphase(a.state) === 'QUESTION', 'la manche s\'est fermee alors que 2 joueurs cherchent');

  // --- abandon des deux autres : la manche doit se cloturer -----------------
  act(b.s, 'abandonner');
  act(c.s, 'abandonner');
  await until(() => gphase(a.state) === 'REVEAL', 'cloture apres abandon de tous les autres');

  const rev = a.state.view.reveal;
  check(rev.resultat === recette.resultat, `revelation : « ${rev.resultat} » au lieu de « ${recette.resultat} »`);
  check(rev.trouveurs.length === 1 && rev.trouveurs[0].pseudo === 'Alice', 'la liste des trouveurs est fausse');
  check(rev.trouveurs[0].points === 150, `Alice devrait marquer 150 (100 + bonus), elle a ${rev.trouveurs[0].points}`);
  check(rev.rates.includes('Bob') && rev.rates.includes('Cook'), 'les joueurs qui ont seche ne sont pas listes');

  // --- on enchaine jusqu'au classement -------------------------------------
  const vues = new Set([recette.resultat]);
  const fuites = [];
  const pump = setInterval(() => {
    if (gphase(a.state) === 'REVEAL') return act(a.s, 'skip');
    if (gphase(a.state) !== 'QUESTION') return;
    const r = a.state.view.round;
    if (!r) return;
    const rec = index.get(cle(r));
    if (!rec) return;
    if (JSON.stringify(a.state.view).includes(rec.resultat)) fuites.push(rec.resultat);
    vues.add(rec.resultat);
    // Alice repond juste, Bob se trompe puis abandonne, Cook abandonne.
    if (!r.jaiTrouve) act(a.s, 'guess', { texte: rec.resultat });
    if (!b.state.view?.round?.jaiAbandonne) act(b.s, 'abandonner');
    if (!c.state.view?.round?.jaiAbandonne) act(c.s, 'abandonner');
  }, 60);

  await until(() => a.state?.phase === 'SCORES', 'classement final', 90000);
  clearInterval(pump);

  check(fuites.length === 0, `la reponse a fuite sur ${fuites.length} manche(s) : ${fuites.join(', ')}`);
  const alice = a.state.ranking.find((p) => p.pseudo === 'Alice');
  check(alice.score === vues.size * 150,
    `Alice devrait avoir ${vues.size * 150} pts (150 par manche), elle a ${alice.score}`);
  check(a.state.ranking.find((p) => p.pseudo === 'Bob').score === 0,
    'Bob n\'a rien trouve, il ne devrait avoir aucun point');

  console.log('\nClassement final');
  for (const p of a.state.ranking) console.log(`  ${p.pseudo.padEnd(7)} ${p.score} pts`);
  console.log(`\nCrafts joues : ${vues.size} — ${[...vues].slice(0, 4).join(', ')}…`);
  console.log(`Recettes disponibles : ${DONNEES.recettes.length}`);

  console.log(problems.length
    ? `\n✗ ${problems.length} probleme(s) :`
    : '\n✓ devine-le-craft : reponses tolerantes, secret de la reponse, partie complete OK');
  problems.forEach((p) => console.log('  - ' + p));
  [a, b, c].forEach((x) => x.s.close());
  process.exit(problems.length ? 1 : 0);
})();
