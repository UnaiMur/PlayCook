// UNO : d'abord les règles de pose (fonctions pures), puis une partie entière
// jouée par trois robots jusqu'au classement.
//
// Le test le plus parlant ici est un invariant : à tout instant, les mains des
// trois joueurs + la pioche + la défausse doivent faire exactement 108 cartes.
// Une carte dupliquée ou perdue par le mélange se voit immédiatement.
import { io } from 'socket.io-client';
import {
  paquet, jouable, identique, points, toutesLesImages, COULEURS,
} from '../games/uno/cartes.js';

const URL = 'http://localhost:3000';
const GAME = 'uno';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const check = (ok, l) => { if (!ok) problems.push(l); };
const act = (s, type, data) => s.emit('game:action', { type, data });
const gphase = (st) => (st?.phase === 'GAME' ? st.view?.phase : st?.phase);

// ---------------------------------------------------------------------------
// 1. Le paquet et les règles de pose — sans serveur
// ---------------------------------------------------------------------------
const P = paquet();
check(P.length === 108, `le paquet fait ${P.length} cartes au lieu de 108`);
check(new Set(P.map((c) => c.id)).size === 108, 'des cartes partagent le même identifiant');
for (const couleur of COULEURS) {
  check(P.filter((c) => c.couleur === couleur).length === 25,
    `${couleur} : ${P.filter((c) => c.couleur === couleur).length} cartes au lieu de 25`);
}
check(P.filter((c) => c.couleur === 'noir').length === 8, 'il ne devrait y avoir que 8 cartes noires');
check(P.reduce((n, c) => n + points(c), 0) === 1240, 'le total des points du paquet n\'est pas 1240');
check(toutesLesImages().length === 54, 'il devrait y avoir 54 visuels distincts');

const r5 = { id: 'x', couleur: 'rouge', valeur: '5' };
const b5 = { id: 'x', couleur: 'bleu', valeur: '5' };
const b7 = { id: 'x', couleur: 'bleu', valeur: '7' };
const rPasse = { id: 'x', couleur: 'rouge', valeur: 'passe' };
const bPasse = { id: 'x', couleur: 'bleu', valeur: 'passe' };
const joker = { id: 'x', couleur: 'noir', valeur: 'joker' };
const plus4 = { id: 'x', couleur: 'noir', valeur: 'plus4' };
const rPlus2 = { id: 'x', couleur: 'rouge', valeur: 'plus2' };
const bPlus2 = { id: 'x', couleur: 'bleu', valeur: 'plus2' };

const sur = (dessus, couleur, extra = {}) => ({ dessus, couleur, cumul: 0, empiler: false, ...extra });

check(jouable(b5, sur(r5, 'rouge')), 'même chiffre, couleur différente : devrait passer');
check(jouable(rPasse, sur(r5, 'rouge')), 'même couleur : devrait passer');
check(jouable(bPasse, sur(rPasse, 'rouge')), 'même symbole : devrait passer');
check(jouable(joker, sur(r5, 'rouge')), 'un joker se pose sur tout');
check(!jouable(b7, sur(r5, 'rouge')), 'ni la couleur ni le chiffre : ne devrait pas passer');
// Après un joker, c'est la couleur choisie qui compte, pas la carte du dessous.
check(jouable(b7, sur(joker, 'bleu')), 'après un joker, la couleur choisie doit être jouable');
check(!jouable(r5, sur(joker, 'bleu')), 'après un joker bleu, le rouge ne doit pas passer');

// Cumul de +2 : sans la règle maison, on ne peut rien poser.
check(!jouable(bPlus2, sur(rPlus2, 'rouge', { cumul: 2, empiler: false })),
  'sans la règle d\'empilement, un +2 ne doit pas pouvoir être relancé');
check(jouable(bPlus2, sur(rPlus2, 'rouge', { cumul: 2, empiler: true })),
  'avec la règle, un +2 doit pouvoir relancer un +2');
check(jouable(plus4, sur(rPlus2, 'rouge', { cumul: 2, empiler: true })),
  'avec la règle, un +4 doit pouvoir relancer un +2');
check(!jouable(b5, sur(rPlus2, 'rouge', { cumul: 2, empiler: true })),
  'une carte ordinaire ne doit jamais annuler un cumul');

check(identique(b5, { ...b5, id: 'y' }), 'deux cartes identiques devraient permettre le jump-in');
check(!identique(b5, r5), 'des couleurs différentes ne sont pas identiques');
check(!identique(joker, joker), 'un joker ne doit pas permettre le jump-in');

// ---------------------------------------------------------------------------
// 2. Une partie complète
// ---------------------------------------------------------------------------
const mk = (pseudo) => {
  const s = io(URL, { transports: ['websocket'] });
  const c = { s, pseudo, state: null, errors: [] };
  s.on('room:joined', ({ playerId, code }) => { c.id = playerId; c.code = code; });
  s.on('room:state', (st) => { c.state = st; });
  s.on('error:msg', (m) => c.errors.push(m));
  return c;
};
const until = async (fn, l, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(25); }
  problems.push(`timeout : ${l}`); return false;
};

(async () => {
  const menu = await (await fetch(`${URL}/api/games`)).json();
  check(menu.some((g) => g.id === GAME), "UNO n'apparaît pas dans /api/games");

  const a = mk('Alice'); a.s.emit('room:create', { pseudo: 'Alice', gameId: GAME });
  await until(() => a.code, 'création');
  const b = mk('Bob'); b.s.emit('room:join', { code: a.code, pseudo: 'Bob' });
  const c = mk('Cook'); c.s.emit('room:join', { code: a.code, pseudo: 'Cook' });
  await until(() => a.state?.players.length === 3, '3 joueurs');

  a.s.emit('game:start');
  await until(() => gphase(a.state) === 'REGLES', 'écran des règles');

  // --- les règles : l'hôte seul décide -------------------------------------
  check(a.state.view.estHote === true, 'Alice devrait être hôte');
  check(b.state.view.estHote === false, 'Bob ne devrait pas être hôte');

  const avant = JSON.stringify(b.state.view.regles);
  act(b.s, 'regle', { nom: 'jumpIn', actif: true });
  await wait(120);
  check(JSON.stringify(a.state.view.regles) === avant, 'un non-hôte a pu changer une règle');

  act(a.s, 'regle', { nom: 'empiler', actif: true });
  act(a.s, 'regle', { nom: 'penaliteUno', actif: true });
  act(a.s, 'manches', { n: 1 });
  await until(() => a.state.view.regles.empiler === true && a.state.view.manches === 1,
    'les réglages de l\'hôte sont pris en compte');
  check(b.state.view.manches === 1, 'les autres joueurs ne voient pas les réglages');

  act(b.s, 'distribuer');
  await wait(150);
  check(gphase(a.state) === 'REGLES', 'un non-hôte a pu distribuer');

  act(a.s, 'distribuer');
  await until(() => gphase(a.state) === 'JEU', 'distribution');

  // --- secret des mains ----------------------------------------------------
  const maMain = a.state.view.main;
  check(maMain.length === 7, `Alice devrait avoir 7 cartes, elle en a ${maMain.length}`);
  const vueDeBob = JSON.stringify(b.state.view);
  // Comparaison par identifiant entier : « c5 » est contenu dans « c50 », donc
  // une recherche de sous-chaîne donnerait de fausses alertes.
  const idsChezBob = new Set((vueDeBob.match(/"c\d+"/g) || []).map((x) => x.slice(1, -1)));
  const fuites = maMain.filter((carte) => idsChezBob.has(carte.id));
  check(fuites.length === 0,
    `Bob voit ${fuites.length} carte(s) de la main d'Alice : ${fuites.map((c) => c.id).join(', ')}`);
  // Bob doit tout de même voir la carte du dessus : sinon le test ne prouve rien.
  check(idsChezBob.size > 0, 'la vue de Bob ne contient aucune carte, le test ne vérifie rien');
  check(!/"mains"/.test(vueDeBob), 'la structure des mains est envoyée au client');
  check(b.state.view.joueurs.every((j) => typeof j.cartes === 'number'),
    'le nombre de cartes des autres devrait être visible');

  // --- l'invariant des 108 cartes -----------------------------------------
  const compterTout = () => {
    const t = a.state.view.table;
    const mains = [a, b, c].reduce((n, cl) => n + (cl.state?.view?.main?.length || 0), 0);
    // La défausse n'est pas comptée carte par carte côté client : on déduit.
    return { mains, pioche: t.pioche };
  };
  const debut = compterTout();
  check(debut.mains === 21, `21 cartes en main attendues, ${debut.mains} trouvées`);
  check(debut.pioche === 108 - 21 - 1, `pioche : ${debut.pioche} au lieu de ${108 - 22}`);

  // --- les robots jouent ---------------------------------------------------
  let coups = 0;
  const invariants = [];
  const pump = setInterval(() => {
    if (gphase(a.state) === 'MANCHE' || a.state?.phase === 'SCORES') return;
    if (gphase(a.state) !== 'JEU') return;

    // 108 = mains + pioche + défausse. On ne voit pas la défausse en entier,
    // mais elle ne peut que croître : mains + pioche ne doit jamais dépasser 107.
    const t = a.state.view.table;
    const enMain = [a, b, c].reduce((n, cl) => n + (cl.state?.view?.main?.length || 0), 0);
    if (enMain + t.pioche > 107) invariants.push(`${enMain} en main + ${t.pioche} en pioche`);

    for (const cl of [a, b, c]) {
      const v = cl.state?.view;
      if (!v || v.phase !== 'JEU' || !v.monTour) continue;
      coups += 1;
      if (coups > 800) return;

      if (v.peutDireUno && v.main.length === 2) act(cl.s, 'uno');

      if (v.jouables.length) {
        const carte = v.main.find((x) => v.jouables.includes(x.id));
        const data = { carte: carte.id };
        if (carte.couleur === 'noir') data.couleur = COULEURS[coups % 4];
        act(cl.s, 'jouer', data);
      } else if (v.peutPiocher) {
        act(cl.s, 'piocher');
      } else if (v.peutPasser) {
        act(cl.s, 'passer');
      }
    }
  }, 25);

  await until(() => gphase(a.state) === 'MANCHE', 'fin de la manche', 60000);
  clearInterval(pump);

  check(invariants.length === 0, `des cartes apparaissent de nulle part : ${invariants[0]}`);

  const fin = a.state.view.fin;
  check(!!fin, 'pas de récapitulatif de fin de manche');
  check(fin.derniere === true, 'une seule manche était demandée : ça devrait être la dernière');
  check(fin.gagne > 0, 'le gagnant devrait encaisser des points');
  const somme = fin.restes.reduce((n, r) => n + r.points, 0);
  check(somme === fin.gagne,
    `le gagnant encaisse ${fin.gagne} alors que les mains restantes valent ${somme}`);
  check(fin.restes.filter((r) => r.cartes === 0).length === 1,
    'exactement un joueur devrait avoir la main vide');

  // --- classement ----------------------------------------------------------
  act(a.s, 'suivante');
  await until(() => a.state?.phase === 'SCORES', 'classement final');
  const total = a.state.ranking.reduce((n, p) => n + p.score, 0);
  check(total === fin.gagne, `le classement totalise ${total} au lieu de ${fin.gagne}`);

  console.log(`\n${fin.gagnant} remporte la manche (+${fin.gagne} points)`);
  console.log(`Coups joués : ${coups}`);
  console.log('\nClassement final');
  for (const p of a.state.ranking) console.log(`  ${p.pseudo.padEnd(7)} ${p.score} pts`);

  console.log(problems.length
    ? `\n✗ ${problems.length} probleme(s) :`
    : '\n✓ uno : regles de pose, secret des mains, partie complete et score OK');
  problems.forEach((p) => console.log('  - ' + p));
  [a, b, c].forEach((x) => x.s.close());
  process.exit(problems.length ? 1 : 0);
})();
