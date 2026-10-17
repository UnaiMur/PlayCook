// ---------------------------------------------------------------------------
// « Qui dans le groupe ? »
//
// Phase 1 (WRITING) : chacun peut ajouter ses propres questions (facultatif).
// Phase 2 (VOTING)  : une question, tout le monde vote pour un joueur.
// Phase 3 (REVEAL)  : on montre le decompte et qui a vote pour qui.
//
// Les points recompensent ceux qui ont vu venir la majorite, pas le joueur
// designe : etre elu « celui qui rate son train » ne doit pas rapporter des
// points, sinon le classement recompense le fait d'etre moque.
//
// Comme le blind test, ce module ne connait ni les sockets ni les salons : il
// recoit un ctx. Voir core/platform.js pour le contrat.
// ---------------------------------------------------------------------------
import { num } from '../../core/env.js';
import { QUESTIONS } from './questions.js';

export const meta = {
  id: 'qui-dans-le-groupe',
  name: 'Qui dans le groupe ?',
  tagline: 'Une question, tout le monde désigne quelqu\'un. La majorité l\'emporte.',
  icon: '👉',
  rules: [
    'Avant de commencer, chacun peut ajouter ses propres questions.',
    'À chaque manche, une question : tu désignes un joueur (toi compris).',
    'Le joueur le plus désigné remporte la manche.',
    'Tu gagnes 100 points si tu avais voté pour lui — l\'intérêt est de deviner le groupe, pas d\'être élu.',
  ],
  // A deux, la majorite ne veut rien dire : il faut un vrai groupe.
  minPlayers: 3,
  maxPlayers: 12,
  allowLateJoin: false,
};

const CONFIG = {
  rounds: num(process.env.QDG_ROUNDS, 8),
  customMax: num(process.env.QDG_CUSTOM_MAX, 2),
  voteMs: num(process.env.QDG_VOTE_MS, 25000),
  // 0 = l'hote enchaine lui-meme, comme sur le blind test.
  revealMs: num(process.env.QDG_REVEAL_MS, 0),
  points: num(process.env.QDG_POINTS, 100),
  minLength: 8,
  maxLength: 120,
};

export function create(ctx) {
  let phase = 'WRITING';
  let custom = [];        // { id, text, authorId }
  let questions = [];     // idem, melangees, completees par la banque
  let index = -1;
  let votes = {};         // voterId -> targetId
  let deadline = 0;       // instant serveur de fin de vote, pour la barre
  let lastReveal = null;

  const current = () => questions[index] || null;
  const mine = (playerId) => custom.filter((q) => q.authorId === playerId);
  const voters = () => ctx.players().filter((p) => p.connected);

  // -------------------------------------------------------------------------
  // Manches
  // -------------------------------------------------------------------------
  function startRound() {
    ctx.clearTimer();
    votes = {};
    lastReveal = null;
    phase = 'VOTING';
    deadline = ctx.now() + CONFIG.voteMs;
    ctx.update();
    // Filet de securite : si quelqu'un ferme son onglet sans voter, la manche
    // se termine quand meme au bout de la fenetre.
    ctx.setTimer(CONFIG.voteMs, endRound);
  }

  function endRound() {
    ctx.clearTimer();
    const question = current();
    if (!question) return;

    // Decompte
    const counts = new Map();
    for (const targetId of Object.values(votes)) {
      counts.set(targetId, (counts.get(targetId) || 0) + 1);
    }
    const best = Math.max(0, ...counts.values());
    const winners = [...counts.entries()]
      .filter(([, n]) => n === best && n > 0)
      .map(([id]) => id);

    // Points a ceux qui ont vote comme la majorite (ex aequo compris).
    const deltas = {};
    for (const [voterId, targetId] of Object.entries(votes)) {
      if (winners.includes(targetId)) {
        deltas[voterId] = (deltas[voterId] || 0) + CONFIG.points;
      }
    }
    for (const [id, n] of Object.entries(deltas)) ctx.award(id, n);

    lastReveal = {
      index: index + 1,
      total: questions.length,
      text: question.text,
      // On ne devoile l'auteur d'une question qu'ici : pendant le vote, savoir
      // qui l'a ecrite oriente les reponses.
      author: question.authorId ? ctx.pseudo(question.authorId) : null,
      tally: [...counts.entries()]
        .map(([id, n]) => ({ id, pseudo: ctx.pseudo(id), count: n, winner: winners.includes(id) }))
        .sort((a, b) => b.count - a.count),
      winners: winners.map((id) => ctx.pseudo(id)),
      votes: Object.entries(votes).map(([voterId, targetId]) => ({
        voterPseudo: ctx.pseudo(voterId),
        targetPseudo: ctx.pseudo(targetId),
        good: winners.includes(targetId),
      })),
      scores: ctx.players()
        .map((p) => ({ pseudo: p.pseudo, score: p.score, delta: deltas[p.id] || 0 }))
        .sort((a, b) => b.score - a.score),
      isLast: index >= questions.length - 1,
    };

    phase = 'REVEAL';
    ctx.update();
    if (CONFIG.revealMs > 0) ctx.setTimer(CONFIG.revealMs, nextRound);
  }

  function nextRound() {
    ctx.clearTimer();
    if (index >= questions.length - 1) return ctx.finish();
    index += 1;
    startRound();
  }

  // Rien ne sert d'attendre la fin du chrono si tout le monde a repondu.
  function closeIfEveryoneVoted() {
    if (phase !== 'VOTING') return;
    const attendus = voters();
    if (attendus.length && attendus.every((p) => votes[p.id])) endRound();
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const actions = {
    add(playerId, { text } = {}) {
      if (phase !== 'WRITING') return;
      const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, CONFIG.maxLength);
      if (clean.length < CONFIG.minLength) return ctx.fail(playerId, 'Question trop courte');
      if (mine(playerId).length >= CONFIG.customMax) {
        return ctx.fail(playerId, `Maximum ${CONFIG.customMax} questions`);
      }
      custom.push({ id: ctx.uid(), text: clean, authorId: playerId });
      ctx.update();
    },

    remove(playerId, { id } = {}) {
      if (phase !== 'WRITING') return;
      custom = custom.filter((q) => !(q.id === id && q.authorId === playerId));
      ctx.update();
    },

    // Ecrire est facultatif : se declarer pret suffit, meme sans question.
    ready(playerId, { ready } = {}) {
      if (phase !== 'WRITING') return;
      ctx.setReady(playerId, !!ready);
      ctx.update();
    },

    begin(playerId) {
      if (phase !== 'WRITING' || !ctx.isHost(playerId)) return;
      const attente = voters().filter((p) => !p.ready);
      if (attente.length) {
        return ctx.fail(playerId, `En attente de : ${attente.map((p) => p.pseudo).join(', ')}`);
      }
      // Les questions des joueurs passent en premier dans le tirage, la banque
      // complete : une partie fait toujours le meme nombre de manches.
      const perso = ctx.shuffle(custom).slice(0, CONFIG.rounds);
      const reste = CONFIG.rounds - perso.length;
      const banque = ctx.shuffle(QUESTIONS)
        .slice(0, Math.max(0, reste))
        .map((text) => ({ id: ctx.uid(), text, authorId: null }));
      questions = ctx.shuffle([...perso, ...banque]);
      index = 0;
      startRound();
    },

    vote(playerId, { targetId } = {}) {
      if (phase !== 'VOTING') return;
      if (!ctx.has(targetId)) return;
      if (votes[playerId]) return;          // un seul vote par manche
      // Se designer soi-meme est autorise : c'est souvent la bonne reponse.
      votes[playerId] = targetId;
      ctx.update();
      closeIfEveryoneVoted();
    },

    skip(playerId) {
      if (!ctx.isHost(playerId)) return;
      if (phase === 'VOTING') endRound();
      else if (phase === 'REVEAL') nextRound();
    },
  };

  // -------------------------------------------------------------------------
  // Vue
  // -------------------------------------------------------------------------
  function view(playerId) {
    const state = {
      phase,
      config: { customMax: CONFIG.customMax, rounds: CONFIG.rounds },
      counts: Object.fromEntries(ctx.players().map((p) => [p.id, mine(p.id).length])),
    };

    if (phase === 'WRITING') {
      // Chacun ne voit que ses propres questions : lire celles des autres
      // avant la partie gacherait l'effet de surprise.
      state.myQuestions = mine(playerId).map((q) => ({ id: q.id, text: q.text }));
      state.myReady = ctx.ready(playerId);
      state.total = custom.length;
      const present = voters();
      state.canBegin = present.length >= meta.minPlayers && present.every((p) => p.ready);
      state.waitingFor = present.filter((p) => !p.ready).map((p) => p.pseudo);
    }

    const question = current();
    if (phase === 'VOTING' && question) {
      state.round = {
        index: index + 1,
        total: questions.length,
        text: question.text,
        myVote: votes[playerId] || null,
        votedCount: Object.keys(votes).length,
        expectedVotes: voters().length,
        endsAt: deadline,
        options: ctx.players().map((p) => ({ id: p.id, pseudo: p.pseudo, you: p.id === playerId })),
      };
    }

    if (phase === 'REVEAL') state.reveal = lastReveal;

    return state;
  }

  return {
    start() {
      phase = 'WRITING';
      custom = [];
      questions = [];
      index = -1;
      votes = {};
      lastReveal = null;
    },
    view,
    action(type, playerId, data) {
      const fn = actions[type];
      if (fn) fn(playerId, data);
    },
    onLeave() {
      // Le partant n'est plus attendu : sa manche peut se cloturer sans lui.
      closeIfEveryoneVoted();
    },
    stop() {
      ctx.clearTimer();
    },
  };
}
