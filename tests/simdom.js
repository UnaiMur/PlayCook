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
    const attendu = view.round?.title || view.reveal?.title || view.round?.text;
    if (attendu) {
      check(texte.includes(attendu),
        `${id} / ${view.phase} : « ${attendu} » n'apparait pas a l'ecran`);
    }
  }

  // Un deuxieme rendu de la meme manche ne doit pas empiler les elements.
  const avant = root.querySelectorAll('img, .noart').length;
  try { mod.render(phases[1], api); } catch { /* deja signale */ }
  const apres = root.querySelectorAll('img, .noart').length;
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
