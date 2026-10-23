// Monte chaque module de jeu dans un DOM headless et le fait passer par toutes
// ses phases. Ne verifie pas l'apparence : verifie que le module se charge, se
// monte et se redessine sans lever d'erreur, et qu'il affiche bien un panneau.
//
// Les simulations sim*.js couvrent le serveur ; celle-ci couvre le client, le
// seul endroit ou une faute de frappe ne se voit qu'a l'execution.
//
//   npm install --no-save jsdom && npm run simdom
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

const problems = [];
const check = (ok, l) => { if (!ok) problems.push(l); };

const html = readFileSync('public/index.html', 'utf8');
const POSTER = 'https://image.tmdb.org/t/p/w342/abc.jpg';

// Etats de vue representatifs, un par phase, dans l'ordre de la partie.
const SCENARIOS = {
  blindtest: [
    { phase: 'PICKING', config: { minItems: 3, maxItems: 5 }, counts: {},
      mySubmissions: [{ id: 's1', trackKey: '123', title: 'Titre', artist: 'Artiste', artwork: '', previewUrl: null }],
      myReady: false, canBegin: false, waitingFor: ['Bob'] },
    { phase: 'PLAYING', config: {}, counts: {},
      round: { index: 1, total: 3, trackKey: '123', title: 'Titre', artist: 'Artiste', artwork: '',
        previewUrl: null, startAt: Date.now(), voteEndsAt: Date.now() + 5000,
        canVote: true, myVote: null, votedCount: 0, expectedVotes: 2,
        suspects: [{ id: 'b', pseudo: 'Bob' }] } },
    { phase: 'REVEAL', config: {}, counts: {},
      reveal: { index: 1, total: 3, title: 'Titre', artist: 'Artiste', artwork: '',
        owners: ['Bob'], votes: [{ voterPseudo: 'Alice', suspectPseudo: 'Bob', correct: true }],
        deltas: {}, scores: [{ pseudo: 'Alice', score: 100, delta: 100 }], isLast: false } },
  ],

  'qui-regarde-ca': [
    { phase: 'PICKING', config: { minItems: 3, maxItems: 5 }, counts: {},
      mySubmissions: [{ id: 's1', tmdbId: '1396', kind: 'série', title: 'Breaking Bad', year: '2008', poster: POSTER }],
      myReady: false, canBegin: false, waitingFor: ['Bob'] },
    { phase: 'PLAYING', config: {}, counts: {},
      round: { index: 1, total: 3, tmdbId: '1396', kind: 'série', title: 'Breaking Bad', year: '2008',
        poster: POSTER, startAt: Date.now(), voteEndsAt: Date.now() + 5000,
        canVote: true, myVote: null, votedCount: 0, expectedVotes: 2,
        suspects: [{ id: 'b', pseudo: 'Bob' }] } },
    // Sans affiche : le gabarit de remplacement doit tenir aussi.
    { phase: 'REVEAL', config: {}, counts: {},
      reveal: { index: 1, total: 3, tmdbId: '1396', kind: 'film', title: 'Sans affiche', year: '',
        poster: '', owners: ['Bob'],
        votes: [{ voterPseudo: 'Alice', suspectPseudo: 'Bob', correct: false }],
        deltas: {}, scores: [{ pseudo: 'Alice', score: 0, delta: 0 }], isLast: true } },
  ],

  'devine-le-craft': [
    { phase: 'QUESTION',
      round: { index: 1, total: 10, niveau: 1, quantite: 1,
        grille: ['AA.', 'AA.', '...'], legende: { A: 'Planches de chêne' }, vrac: null,
        endsAt: Date.now() + 5000, mesEssais: [{ texte: 'nawak', bon: false, abandon: false }],
        jaiTrouve: false, jaiAbandonne: false, monRang: null, trouves: 0, joueurs: 2,
        tableau: [{ pseudo: 'Alice', trouve: false, abandon: false }] } },
    // Recette « en vrac » : pas de grille, juste des ingrédients.
    { phase: 'QUESTION',
      round: { index: 2, total: 10, niveau: 2, quantite: 1,
        grille: null, legende: null, vrac: [{ nom: 'Papier', nombre: 3 }, { nom: 'Cuir', nombre: 1 }],
        endsAt: Date.now() + 5000, mesEssais: [], jaiTrouve: true, jaiAbandonne: false,
        monRang: 1, trouves: 1, joueurs: 2,
        tableau: [{ pseudo: 'Alice', trouve: true, abandon: false }] } },
    { phase: 'REVEAL',
      reveal: { index: 1, total: 10, niveau: 1, resultat: 'Établi', quantite: 1,
        grille: ['AA.', 'AA.', '...'], legende: { A: 'Planches de chêne' }, vrac: null,
        trouveurs: [{ pseudo: 'Alice', secondes: 4.2, points: 150 }], rates: ['Bob'],
        scores: [{ pseudo: 'Alice', score: 150, delta: 150 }], isLast: false } },
  ],

  uno: [
    { phase: 'REGLES',
      regles: { empiler: true, piocherJusqu: false, penaliteUno: true, jumpIn: false },
      manches: 3, estHote: true, assez: true,
      joueurs: [{ pseudo: 'Alice', connecte: true }, { pseudo: 'Bob', connecte: true }] },
    { phase: 'JEU', manche: 1, manches: 3,
      regles: { empiler: true, piocherJusqu: false, penaliteUno: true, jumpIn: false },
      table: { dessus: { id: 'c1', couleur: 'rouge', valeur: '7' }, couleur: 'rouge',
        cumul: 0, sens: 1, pioche: 80, tourDe: 'a', finTour: Date.now() + 9000,
        journal: ['Bob pose un +2 (cumul : 2)'] },
      joueurs: [
        { id: 'a', pseudo: 'Alice', cartes: 3, uno: false, aDitUno: false, connecte: true, sonTour: true, moi: true, denoncable: false },
        { id: 'b', pseudo: 'Bob', cartes: 1, uno: true, aDitUno: false, connecte: true, sonTour: false, moi: false, denoncable: true },
      ],
      main: [
        { id: 'c10', couleur: 'rouge', valeur: '3' },
        { id: 'c11', couleur: 'bleu', valeur: 'passe' },
        { id: 'c12', couleur: 'noir', valeur: 'plus4' },
      ],
      jouables: ['c10', 'c12'], sautables: [], monTour: true,
      peutPiocher: true, peutPasser: false, doitRamasser: false, peutDireUno: false },
    { phase: 'MANCHE', estHote: true,
      fin: { manche: 1, manches: 3, gagnant: 'Bob', gagne: 42,
        restes: [{ pseudo: 'Bob', cartes: 0, points: 0 }, { pseudo: 'Alice', cartes: 3, points: 42 }],
        scores: [{ pseudo: 'Bob', score: 42, delta: 42 }, { pseudo: 'Alice', score: 0, delta: 0 }],
        derniere: false } },
  ],

  'qui-dans-le-groupe': [
    { phase: 'WRITING', config: { customMax: 2, rounds: 8 }, counts: {},
      myQuestions: [{ id: 'q1', text: 'Qui arrive toujours en retard ?' }],
      myReady: false, total: 3, canBegin: false, waitingFor: ['Bob'] },
    { phase: 'VOTING', config: {}, counts: {},
      round: { index: 1, total: 8, text: 'Qui arrive toujours en retard ?',
        myVote: null, votedCount: 0, expectedVotes: 3, endsAt: Date.now() + 5000,
        options: [{ id: 'a', pseudo: 'Alice', you: true }, { id: 'b', pseudo: 'Bob', you: false }] } },
    { phase: 'REVEAL', config: {}, counts: {},
      reveal: { index: 1, total: 8, text: 'Qui arrive toujours en retard ?', author: 'Alice',
        tally: [{ id: 'b', pseudo: 'Bob', count: 2, winner: true }],
        winners: ['Bob'],
        votes: [{ voterPseudo: 'Alice', targetPseudo: 'Bob', good: true }],
        scores: [{ pseudo: 'Alice', score: 100, delta: 100 }], isLast: false } },
  ],
};

function fakeApi(dom) {
  const { document } = dom.window;
  const el = (spec, props = {}, ...children) => {
    const [tag, ...classes] = String(spec).split('.');
    const node = document.createElement(tag || 'div');
    if (classes.length) node.className = classes.join(' ');
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') node[k.toLowerCase()] = v;
      else if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof dom.window.Node ? c : document.createTextNode(String(c)));
    }
    return node;
  };
  return {
    emit: () => {}, ready: () => {}, toast: () => {},
    me: 'a', isHost: true,
    players: [{ id: 'a', pseudo: 'Alice', isHost: true }, { id: 'b', pseudo: 'Bob', isHost: false }],
    player: (id) => ({ id, pseudo: id }),
    state: {}, now: () => Date.now(),
    sound: {
      playAt: () => {}, stop: () => {},
      cuePlay: async () => {}, cueStop: () => {}, onCueEnd: () => {},
    },
    el,
    esc: (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])),
  };
}

for (const [id, phases] of Object.entries(SCENARIOS)) {
  const dom = new JSDOM(html, { url: 'http://localhost:3000/' });
  // Les modules de jeu parlent au DOM par des globales : on expose celles du
  // document. Surtout pas les minuteries : celles de jsdom delegent aux
  // globales, et les remplacer les fait s'appeler elles-memes a l'infini.
  for (const k of ['document', 'Node', 'HTMLElement']) {
    globalThis[k] = dom.window[k] ?? globalThis[k];
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => ([]) });

  let mod;
  try {
    mod = (await import(pathToFileURL(`public/games/${id}/client.js`).href)).default;
  } catch (err) {
    problems.push(`${id} : le module ne se charge pas — ${err.message}`);
    continue;
  }
  check(mod?.id === id, `${id} : le module n'annonce pas le bon id`);

  const api = fakeApi(dom);
  const root = dom.window.document.getElementById('game-root');
  check(!!root, 'index.html ne contient pas #game-root');

  try {
    mod.mount(root, api);
  } catch (err) {
    problems.push(`${id} : mount() echoue — ${err.message}`);
    continue;
  }
  check(root.children.length > 0, `${id} : mount() n'a rien ajoute dans #game-root`);

  for (const view of phases) {
    try {
      mod.render(view, api);
    } catch (err) {
      problems.push(`${id} / ${view.phase} : render() echoue — ${err.message}`);
      if (process.env.TRACE) console.log(err.stack?.split('\n').slice(0, 12).join('\n'));
      continue;
    }
    const visibles = [...root.querySelectorAll('.panel.active')];
    check(visibles.length === 1,
      `${id} / ${view.phase} : ${visibles.length} panneau(x) affiche(s) au lieu d'un seul`);
    const texte = visibles[0]?.textContent.trim() || '';
    check(texte.length > 0, `${id} / ${view.phase} : le panneau affiche est vide`);

    // Le titre de l'element doit arriver jusqu'a l'ecran : c'est tout l'objet
    // du jeu, et une erreur de nom de champ ne se verrait pas autrement.
    const attendu = view.round?.title || view.reveal?.title || view.round?.text
      || view.reveal?.resultat;
    if (attendu) {
      check(texte.includes(attendu),
        `${id} / ${view.phase} : « ${attendu} » n'apparait pas a l'ecran`);
    }
  }

  // Un deuxieme rendu de la meme manche ne doit pas empiler les elements.
  const avant = root.querySelectorAll('img, .noart, .cell, .carte').length;
  try { mod.render(phases[1], api); } catch { /* deja signale */ }
  const apres = root.querySelectorAll('img, .noart, .cell, .carte').length;
  check(avant === apres, `${id} : un rendu repete duplique le contenu de la manche`);

  try {
    mod.unmount();
  } catch (err) {
    problems.push(`${id} : unmount() echoue — ${err.message}`);
  }
}

console.log(problems.length
  ? `✗ ${problems.length} probleme(s) :`
  : '✓ les modules de jeu se montent et se redessinent dans toutes leurs phases');
problems.forEach((p) => console.log('  - ' + p));
process.exit(problems.length ? 1 : 0);
