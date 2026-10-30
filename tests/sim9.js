// « Devine la musique » : d'abord le moteur seul avec un ctx factice (rapide et
// reproductible), puis une partie entière en mode sélection jouée par trois
// robots à travers de vraies websockets.
//
// L'invariant qui compte ici est le secret : pendant la manche, aucun joueur
// qui a le droit de répondre ne doit voir passer le titre, l'artiste ou la
// pochette. On garde donc la liste de tous les titres du test et on vérifie, à
// CHAQUE état reçu, qu'aucun n'apparaît dans la vue de ceux qui cherchent. Un
// champ oublié dans la vue se voit immédiatement.
//
// Le mode aléatoire n'est pas joué ici : il demande les tops Deezer, que le
// bac à sable ne peut pas joindre. Il se vérifie avec `npm run deezer`.
import { io } from 'socket.io-client';
import { create as creerJeu } from '../games/devine-la-musique/server.js';
import { cible, evaluer } from '../games/devine-la-musique/titres.js';

const URL = 'http://localhost:3000';
const GAME = 'devine-la-musique';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const check = (ok, l) => { if (!ok) problems.push(l); };
const act = (s, type, data) => s.emit('game:action', { type, data });
const gphase = (st) => (st?.phase === 'GAME' ? st.view?.phase : st?.phase);

// Des titres et des artistes volontairement très différents les uns des
// autres : avec « Titre 1 » et « Titre 2 », la tolérance aux fautes de frappe
// les confondrait et le test mesurerait n'importe quoi.
const MOTS = [
  ['Comete', 'Hirondelle'], ['Sable', 'Pivot'], ['Brume', 'Tangente'],
  ['Fleuve', 'Cardamome'], ['Orage', 'Zephyr'], ['Lanterne', 'Baobab'],
  ['Zinc', 'Mistral'], ['Cercle', 'Pampa'], ['Grenat', 'Oursin'],
  ['Vertige', 'Tourmaline'], ['Nacre', 'Fjord'], ['Silex', 'Cannelle'],
  ['Alizé', 'Gravier'], ['Pollen', 'Cobalt'], ['Varech', 'Tilleul'],
  ['Basalte', 'Poivre'], ['Jonquille', 'Granit'],
];
let compteur = 1000;
function piste(i) {
  const [titre, artiste] = MOTS[i % MOTS.length];
  return {
    trackKey: String(compteur++),
    title: titre,
    titleShort: titre,
    artist: artiste,
    artwork: '',
  };
}
// Tout ce qui ne doit jamais fuiter, titres et artistes confondus.
const SECRETS = MOTS.flat();

// ---------------------------------------------------------------------------
// 1. Le moteur seul, avec un ctx factice
//
// shuffle vaut l'identité : le tirage devient reproductible, donc on peut
// affirmer exactement quels morceaux sortent et à qui ils appartiennent.
// ---------------------------------------------------------------------------
function faireCtx(pseudos) {
  const joueurs = pseudos.map((pseudo, i) => (
    { id: `p${i + 1}`, pseudo, score: 0, connected: true }
  ));
  const prets = {};
  const echecs = [];
  let horloge = 100000;
  let timer = null;
  let fini = false;

  const ctx = {
    players: () => joueurs,
    connected: () => joueurs.filter((p) => p.connected),
    pseudo: (id) => joueurs.find((p) => p.id === id)?.pseudo || '',
    has: (id) => joueurs.some((p) => p.id === id),
    isHost: (id) => id === joueurs[0].id,
    hostId: () => joueurs[0].id,
    award: (id, n) => { const p = joueurs.find((x) => x.id === id); if (p) p.score += n; },
    ready: (id) => !!prets[id],
    setReady: (id, v) => { prets[id] = !!v; },
    allReady: () => ctx.connected().every((p) => prets[p.id]),
    notReady: () => ctx.connected().filter((p) => !prets[p.id]).map((p) => p.pseudo),
    now: () => horloge,
    setTimer: (ms, fn) => { timer = { ms, fn }; },
    clearTimer: () => { timer = null; },
    update: () => {},
    fail: (id, msg) => echecs.push({ id, msg }),
    finish: () => { fini = true; },
    uid: () => String(compteur++),
    shuffle: (a) => [...a],
  };
  return {
    ctx,
    joueurs,
    echecs,
    declencher: () => { const t = timer; timer = null; t?.fn(); },
    aUnTimer: () => !!timer,
    avancer: (ms) => { horloge += ms; },
    estFini: () => fini,
  };
}

const [ALICE, BOB, COOK] = ['p1', 'p2', 'p3'];

// --- les bornes de la sélection --------------------------------------------
{
  const h = faireCtx(['Alice', 'Bob', 'Cook']);
  const jeu = creerJeu(h.ctx);
  jeu.start();
  check(jeu.view(ALICE).phase === 'REGLAGES', 'la partie devrait ouvrir sur les réglages');

  // Un joueur ordinaire ne règle rien.
  jeu.action('reglages', BOB, { mode: 'selection', manches: 4 });
  check(jeu.view(ALICE).reglages.mode === 'aleatoire',
    'un joueur non-hôte a pu changer le mode');

  jeu.action('reglages', ALICE, { mode: 'selection', manches: 4 });
  jeu.action('valider', ALICE);
  check(jeu.view(ALICE).phase === 'SELECTION', 'le mode sélection devrait ouvrir la sélection');

  // Dix maximum.
  for (let i = 0; i < 12; i++) jeu.action('submit', ALICE, piste(i));
  const v = jeu.view(ALICE).selection;
  check(v.mesMorceaux.length === 10,
    `${v.mesMorceaux.length} morceaux acceptés au lieu de 10 au maximum`);
  check(h.echecs.some((e) => e.id === ALICE && /maximum/.test(e.msg)),
    'le onzième morceau devrait être refusé avec un message');

  // Pas deux fois le même. Il faut d'abord faire de la place : à dix morceaux
  // c'est le plafond qui répondrait, pas le contrôle de doublon.
  const dejaLa = v.mesMorceaux[0];
  jeu.action('remove', ALICE, { id: v.mesMorceaux[9].trackKey });
  check(jeu.view(ALICE).selection.mesMorceaux.length === 9, 'le retrait d\'un morceau a échoué');
  const avant = h.echecs.length;
  jeu.action('submit', ALICE, dejaLa);
  check(h.echecs.length > avant && /déjà/.test(h.echecs[h.echecs.length - 1].msg),
    'un morceau déjà choisi devrait être refusé');
  check(jeu.view(ALICE).selection.mesMorceaux.length === 9,
    'le doublon a quand même été ajouté');

  // Cinq minimum : en dessous, on ne peut même pas se déclarer prêt. C'est le
  // jeu qui tranche, pas la plateforme — elle lui transmet la demande.
  for (let i = 0; i < 4; i++) jeu.action('submit', BOB, piste(i + 20));   // Bob : 4
  jeu.action('submit', COOK, piste(40));                                  // Cook : 1
  const avantPret = h.echecs.length;
  jeu.action('ready', BOB, { ready: true });
  check(h.ctx.ready(BOB) === false, 'un joueur à 4 morceaux a pu se déclarer prêt');
  check(h.echecs.length > avantPret, 'le refus de se déclarer prêt devrait être expliqué');

  jeu.action('submit', BOB, piste(24));                                   // Bob : 5
  jeu.action('ready', ALICE, { ready: true });
  jeu.action('ready', BOB, { ready: true });
  check(h.ctx.ready(BOB) === true, 'à 5 morceaux, Bob devrait pouvoir se déclarer prêt');
  check(jeu.view(ALICE).selection.pretAPartir === false,
    'Cook n\'a qu\'un morceau : la partie ne devrait pas pouvoir démarrer');

  jeu.action('commencer', ALICE);
  check(jeu.view(ALICE).phase === 'SELECTION',
    'la partie a démarré alors qu\'un joueur était sous le minimum');

  // La liste se verrouille quand on est prêt.
  const n = jeu.view(BOB).selection.mesMorceaux.length;
  jeu.action('submit', BOB, piste(60));
  check(jeu.view(BOB).selection.mesMorceaux.length === n,
    'un joueur déclaré prêt a pu modifier sa liste');
}

// --- le tirage : doublons fusionnés, morceau de tout le monde écarté --------
{
  const h = faireCtx(['Alice', 'Bob', 'Cook']);
  const jeu = creerJeu(h.ctx);
  jeu.start();
  jeu.action('reglages', ALICE, { mode: 'selection', manches: 20 });
  jeu.action('valider', ALICE);

  const partage = piste(1);      // Bob et Cook
  const tous = piste(2);         // les trois
  const propres = {
    [ALICE]: [piste(3), piste(4), piste(5), piste(6), piste(7)],
    [BOB]: [piste(8), piste(9), piste(10), piste(11), piste(12)],
    [COOK]: [piste(13), piste(14), piste(15), piste(16), piste(0)],
  };
  for (const id of [ALICE, BOB, COOK]) {
    for (const t of propres[id]) jeu.action('submit', id, t);
    jeu.action('submit', id, tous);
    if (id !== ALICE) jeu.action('submit', id, partage);
    jeu.action('ready', id, { ready: true });
  }

  jeu.action('commencer', ALICE);
  check(jeu.view(ALICE).phase === 'MANCHE', 'la partie devrait avoir démarré');

  // On parcourt toutes les manches en les forçant, pour inspecter le tirage.
  const vues = [];
  for (let tour = 0; tour < 25; tour++) {
    const v = jeu.view(ALICE);
    if (v.phase !== 'MANCHE') break;
    vues.push({
      index: v.manche.index,
      total: v.manche.total,
      proprietaires: v.manche.tableau.filter((x) => x.proprietaire).map((x) => x.pseudo),
      aMoi: !!v.manche.monMorceau,
    });
    jeu.action('skip', ALICE);                       // -> REVELATION
    const r = jeu.view(ALICE).revelation;
    if (r) {
      vues[vues.length - 1].titre = r.title;
      vues[vues.length - 1].proprios = r.proprietaires;
    }
    if (r?.isLast) break;
    jeu.action('skip', ALICE);                       // -> manche suivante
  }

  const titres = vues.map((v) => v.titre);
  check(titres.length === 16,
    `${titres.length} manches tirées au lieu de 16 (17 morceaux uniques, 1 écarté)`);
  check(new Set(titres).size === titres.length,
    'un morceau passe deux fois : les doublons ne sont pas fusionnés');
  check(!titres.includes(tous.title),
    'le morceau choisi par tout le monde devrait être écarté : personne ne pourrait répondre');

  const vuePartage = vues.find((v) => v.titre === partage.title);
  check(!!vuePartage, 'le morceau choisi par deux joueurs devrait être joué une fois');
  check(vuePartage && vuePartage.proprietaires.length === 2
    && vuePartage.proprietaires.includes('Bob') && vuePartage.proprietaires.includes('Cook'),
    `le morceau partagé devrait bloquer Bob et Cook, pas ${vuePartage?.proprietaires}`);

  // Le tirage doit servir tout le monde, pas seulement le premier.
  for (const [id, liste] of Object.entries(propres)) {
    const sortis = liste.filter((t) => titres.includes(t.title)).length;
    check(sortis === 5,
      `${h.ctx.pseudo(id)} : ${sortis} de ses 5 morceaux tirés — le tirage n'est pas équilibré`);
  }
}

// --- le verrou du propriétaire, et le secret de la vue ---------------------
{
  const h = faireCtx(['Alice', 'Bob']);
  const jeu = creerJeu(h.ctx);
  jeu.start();
  jeu.action('reglages', ALICE, { mode: 'selection', manches: 1 });
  jeu.action('valider', ALICE);

  const aAlice = [piste(0), piste(1), piste(2), piste(3), piste(4)];
  const aBob = [piste(5), piste(6), piste(7), piste(8), piste(9)];
  for (const t of aAlice) jeu.action('submit', ALICE, t);
  for (const t of aBob) jeu.action('submit', BOB, t);
  jeu.action('ready', ALICE, { ready: true });
  jeu.action('ready', BOB, { ready: true });
  jeu.action('commencer', ALICE);

  const v = jeu.view(ALICE);
  check(v.phase === 'MANCHE', 'la manche devrait avoir commencé');

  // Avec shuffle = identité, la première manche est le premier morceau
  // d'Alice : c'est donc elle qui est privée de réponse.
  const proprio = v.manche.monMorceau ? ALICE : BOB;
  const chercheur = proprio === ALICE ? BOB : ALICE;
  const morceau = [...aAlice, ...aBob].find((t) => t.title === jeu.view(proprio).manche.monMorceau?.title);
  check(!!morceau, 'le propriétaire devrait voir son propre morceau');

  // Le propriétaire ne peut pas répondre, même en tapant la bonne réponse.
  check(jeu.view(proprio).manche.peutRepondre === false,
    'le propriétaire ne devrait pas pouvoir répondre sur son morceau');
  jeu.action('guess', proprio, { texte: morceau.title });
  const vp = jeu.view(proprio).manche;
  check(vp.jaiTitre === false && vp.mesEssais.length === 0,
    'la réponse du propriétaire sur son propre morceau a été prise en compte');

  // Le chercheur, lui, ne voit rien du morceau.
  const vc = jeu.view(chercheur).manche;
  check(vc.peutRepondre === true, 'l\'autre joueur devrait pouvoir répondre');
  check(vc.monMorceau === null, 'le chercheur ne doit pas recevoir le morceau');
  const texte = JSON.stringify(vc);
  const fuites = SECRETS.filter((s) => texte.includes(s));
  check(fuites.length === 0, `le titre ou l'artiste fuite dans la vue : ${fuites.join(', ')}`);
  check(!/artwork|cover|dzcdn/.test(texte), 'la pochette fuite dans la vue de la manche');

  // Titre puis artiste, et le barème.
  jeu.action('guess', chercheur, { texte: morceau.title });
  let vch = jeu.view(chercheur).manche;
  check(vch.jaiTitre === true && vch.jaiArtiste === false,
    'le titre seul devrait être validé, pas l\'artiste');
  check(vch.mesEssais[0].titre === true, 'l\'essai devrait être marqué comme bon pour le titre');

  // Redire le titre : reconnu, mais ce n'est pas une erreur.
  jeu.action('guess', chercheur, { texte: morceau.title });
  vch = jeu.view(chercheur).manche;
  check(vch.mesEssais[1].connu === true,
    'un titre déjà trouvé et redonné devrait être marqué comme connu');

  // L'artiste à son tour. Ici Bob est le SEUL à pouvoir répondre : dès qu'il a
  // tout trouvé, plus personne ne cherche et la manche se clôt d'elle-même. On
  // lit donc la suite dans la révélation, pas dans la vue de la manche.
  h.avancer(4000);
  jeu.action('guess', chercheur, { texte: morceau.artist });
  check(jeu.view(chercheur).phase === 'REVELATION',
    'la manche devrait se clore quand plus personne ne cherche');

  const r = jeu.view(chercheur).revelation;
  check(r.title === morceau.title, 'la révélation devrait donner le titre');
  check(r.artwork !== undefined, 'la révélation devrait porter la pochette');
  const moi = r.detail.find((d) => d.pseudo === h.ctx.pseudo(chercheur));
  check(moi && moi.titre && moi.artiste, 'le chercheur devrait avoir titre et artiste');
  check(moi && moi.rang === 1, `le premier à tout trouver devrait avoir le rang 1, pas ${moi?.rang}`);
  check(moi && moi.secondes >= 4,
    `le temps relevé devrait être d'au moins 4 s, pas ${moi?.secondes}`);
  check(moi && moi.points === 100 + 60 + 50,
    `le chercheur devrait marquer 210 (100 titre + 60 artiste + 50 bonus), pas ${moi?.points}`);
  const score = h.joueurs.find((p) => p.id === chercheur).score;
  check(score === 210, `le score devrait être 210, pas ${score}`);
  check(!r.detail.some((d) => d.pseudo === h.ctx.pseudo(proprio)),
    'le propriétaire ne devrait pas apparaître parmi ceux qui ont trouvé');
}

// --- une seule bonne frappe peut valider les deux -------------------------
{
  const c = cible({ title: 'Comete', titleShort: 'Comete', artist: 'Hirondelle' });
  const r = evaluer('comete hirondelle', c);
  check(r.titre && r.artiste, 'titre et artiste dans la même frappe devraient compter double');
}

// ---------------------------------------------------------------------------
// 2. Une partie entière, en vraies websockets
// ---------------------------------------------------------------------------
const mk = (pseudo) => {
  const s = io(URL, { transports: ['websocket'] });
  const c = { s, pseudo, state: null, errors: [], fuites: [] };
  s.on('room:joined', ({ playerId, code }) => { c.id = playerId; c.code = code; });
  s.on('room:state', (st) => {
    c.state = st;
    // L'invariant, verifie a chaque etat recu : celui qui cherche ne doit
    // jamais voir passer un titre ni un artiste.
    const v = st?.phase === 'GAME' ? st.view : null;
    if (v?.phase === 'MANCHE' && v.manche && !v.manche.monMorceau) {
      // `mesEssais` est l'echo de ce que CE joueur vient de taper : s'il a
      // trouve le titre, il s'y trouve forcement, et ce n'est pas une fuite.
      // On verifie donc tout le reste, c'est-a-dire tout ce que le serveur
      // ajoute de lui-meme.
      const { mesEssais, ...reste } = v.manche;
      const texte = JSON.stringify(reste);
      for (const secret of SECRETS) {
        if (texte.includes(secret)) c.fuites.push(`${secret} (manche ${v.manche.index})`);
      }
    }
  });
  s.on('error:msg', (m) => c.errors.push(m));
  return c;
};

async function until(cond, quoi, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return;
    await wait(60);
  }
  problems.push(`délai dépassé : ${quoi}`);
  throw new Error(`délai dépassé : ${quoi}`);
}

(async () => {
  const a = mk('Alice'); a.s.emit('room:create', { pseudo: 'Alice', gameId: GAME });
  await until(() => a.code, 'création du salon');
  const b = mk('Bob'); b.s.emit('room:join', { code: a.code, pseudo: 'Bob' });
  const c = mk('Cook'); c.s.emit('room:join', { code: a.code, pseudo: 'Cook' });
  await until(() => a.state?.players.length === 3, '3 joueurs');

  a.s.emit('game:start');
  await until(() => gphase(a.state) === 'REGLAGES', 'écran des réglages');

  // Le mode sélection a besoin de deux joueurs : ici on en a trois.
  check(a.state.view.reglages.selectionPossible === true,
    'à trois joueurs, le mode sélection devrait être proposé');
  check(b.state.view.reglages.jeSuisHote === false, 'Bob ne devrait pas être hôte');

  act(a.s, 'reglages', { mode: 'selection', manches: 3 });
  act(a.s, 'valider');
  await until(() => gphase(a.state) === 'SELECTION', 'écran de sélection');

  // Chacun dépose cinq morceaux bien distincts.
  const listes = { Alice: [], Bob: [], Cook: [] };
  [a, b, c].forEach((cl, j) => {
    for (let i = 0; i < 5; i++) {
      const t = piste(j * 5 + i);
      listes[cl.pseudo].push(t);
      act(cl.s, 'submit', t);
    }
  });
  await until(() => a.state.view.selection.mesMorceaux.length === 5, 'les 5 morceaux d\'Alice');

  // Un joueur ne voit que sa propre liste.
  const vueA = JSON.stringify(a.state.view.selection);
  const ailleurs = [...listes.Bob, ...listes.Cook].filter((t) => vueA.includes(t.title));
  check(ailleurs.length === 0,
    `Alice voit les morceaux des autres pendant la sélection : ${ailleurs.map((t) => t.title)}`);
  check(a.state.view.selection.tableau.every((x) => x.combien === 5),
    'le tableau devrait montrer que chacun a 5 morceaux, sans dire lesquels');

  [a, b, c].forEach((cl) => cl.s.emit('player:ready', { ready: true }));
  await until(() => a.state.view.selection.pretAPartir === true, 'tout le monde prêt');

  act(a.s, 'commencer');
  await until(() => gphase(a.state) === 'MANCHE', 'première manche');

  // Deezer est injoignable depuis le bac à sable : la manche doit se jouer
  // quand même, sans son, plutôt que de bloquer la partie.
  check(a.state.view.manche.previewUrl === null,
    'sans Deezer, previewUrl devrait valoir null et la manche continuer');
  check(a.state.view.manche.total === 3, `3 manches demandées, ${a.state.view.manche.total} tirées`);

  let manchesJouees = 0;
  const tousLesTitres = [...listes.Alice, ...listes.Bob, ...listes.Cook];

  for (let tour = 0; tour < 5; tour++) {
    if (gphase(a.state) !== 'MANCHE') break;
    manchesJouees += 1;

    // Qui est bloqué sur cette manche ?
    const bloques = [a, b, c].filter((cl) => cl.state.view.manche.monMorceau);
    check(bloques.length >= 1, 'en mode sélection, chaque manche a un propriétaire');
    const proprio = bloques[0];
    const titre = proprio.state.view.manche.monMorceau.title;
    const morceau = tousLesTitres.find((t) => t.title === titre);

    // Le propriétaire tape la bonne réponse : elle doit être ignorée.
    const avant = proprio.errors.length;
    act(proprio.s, 'guess', { texte: morceau.title });
    await wait(150);
    check(proprio.state.view.manche.jaiTitre === false,
      `${proprio.pseudo} a marqué le titre de son propre morceau`);
    check(proprio.errors.length === avant,
      'le propriétaire ne devrait pas recevoir d\'erreur, juste être ignoré');

    // Les autres cherchent, et l'un d'eux trouve tout d'un coup.
    const chercheurs = [a, b, c].filter((cl) => !cl.state.view.manche.monMorceau);
    act(chercheurs[0].s, 'guess', { texte: `${morceau.title} ${morceau.artist}` });
    await wait(150);
    check(chercheurs[0].state.view.manche.jaiTitre
      && chercheurs[0].state.view.manche.jaiArtiste,
      'titre et artiste dans la même frappe devraient compter double');

    // Les autres abandonnent : la manche se clôt sans attendre le chrono.
    for (const cl of chercheurs.slice(1)) act(cl.s, 'abandonner');
    await until(() => gphase(a.state) === 'REVELATION', 'révélation', 40000);

    const r = a.state.view.revelation;
    check(r.title === morceau.title, `la révélation annonce ${r.title} au lieu de ${morceau.title}`);
    check(r.proprietaires.includes(proprio.pseudo),
      'la révélation devrait nommer qui avait choisi le morceau');

    if (r.isLast) break;
    act(a.s, 'skip');
    await until(() => gphase(a.state) === 'MANCHE', 'manche suivante');
  }

  check(manchesJouees === 3, `${manchesJouees} manches jouées au lieu de 3`);

  act(a.s, 'skip');
  await until(() => a.state?.phase === 'SCORES', 'classement final');

  // L'invariant du secret, sur tout ce qui a circulé.
  for (const cl of [a, b, c]) {
    check(cl.fuites.length === 0,
      `${cl.pseudo} a reçu un titre pendant qu'il cherchait : ${cl.fuites.slice(0, 3).join(', ')}`);
  }

  const total = a.state.ranking.reduce((n, p) => n + p.score, 0);
  check(total > 0, 'personne n\'a marqué de points');

  console.log('\nClassement final');
  for (const p of a.state.ranking) console.log(`  ${p.pseudo.padEnd(7)} ${p.score} pts`);

  console.log(problems.length
    ? `\n✗ ${problems.length} probleme(s) :`
    : '\n✓ devine-la-musique : bornes 5/10, tirage équilibré, verrou du propriétaire,'
      + ' secret du titre, barème, partie complète OK');
  problems.forEach((p) => console.log('  - ' + p));
  [a, b, c].forEach((x) => x.s.close());
  process.exit(problems.length ? 1 : 0);
})().catch((e) => {
  console.log(`\n✗ ${problems.length} probleme(s) :`);
  problems.forEach((p) => console.log('  - ' + p));
  console.log('  - ' + e.message);
  process.exit(1);
});
