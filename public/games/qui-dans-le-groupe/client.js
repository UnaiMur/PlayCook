// ---------------------------------------------------------------------------
// Client de « Qui dans le groupe ? ».
//
// Trois panneaux : ecriture des questions, vote, resultats. Aucune ressource
// externe, aucun son — tout tient dans le DOM et dans ce que la plateforme
// fournit via `api`.
// ---------------------------------------------------------------------------

let ui = null;
let api = null;
let barTimer = null;
let shownRound = -1;      // evite de relancer la barre a chaque etat recu

function build(root, el) {
  const writing = el('section.panel', { id: 'qd-writing' },
    el('h2', { text: 'Vos questions' }),
    el('p.hint', { id: 'qd-hint' }),
    el('input', { id: 'qd-input', placeholder: 'Qui dans le groupe… ?', maxlength: '120', autocomplete: 'off' }),
    el('button', { id: 'qd-add', text: 'Ajouter' }),
    el('ul.mine', { id: 'qd-mine' }),
    el('p.hint', { id: 'qd-pool' }),
    el('button', { id: 'qd-ready', text: 'Je suis prêt' }),
    el('button.primary', { id: 'qd-begin', text: 'Démarrer la partie' }));

  const voting = el('section.panel', { id: 'qd-voting' },
    el('p.hint', { id: 'qd-counter' }),
    el('h2.question', { id: 'qd-question' }),
    el('div.bar', {}, el('div', { id: 'qd-bar' })),
    el('p.hint', { id: 'qd-status' }),
    el('div.suspects', { id: 'qd-options' }));

  const reveal = el('section.panel', { id: 'qd-reveal' },
    el('p.hint', { id: 'qd-rauthor' }),
    el('h2.question', { id: 'qd-rquestion' }),
    el('p.owner', { id: 'qd-rwinner' }),
    el('ul.votes', { id: 'qd-rtally' }),
    el('h3', { text: 'Qui a voté quoi' }),
    el('ul.votes', { id: 'qd-rvotes' }),
    el('h3', { text: 'Points' }),
    el('ul.votes', { id: 'qd-rscores' }),
    el('p.hint', { id: 'qd-rwait' }),
    el('button', { id: 'qd-next', text: 'Suivant' }));

  root.append(writing, voting, reveal);

  const $ = (id) => root.querySelector(`#${id}`);
  return {
    panels: { WRITING: writing, VOTING: voting, REVEAL: reveal },
    hint: $('qd-hint'), input: $('qd-input'), add: $('qd-add'), mine: $('qd-mine'),
    pool: $('qd-pool'), ready: $('qd-ready'), begin: $('qd-begin'),
    counter: $('qd-counter'), question: $('qd-question'), bar: $('qd-bar'),
    status: $('qd-status'), options: $('qd-options'),
    rauthor: $('qd-rauthor'), rquestion: $('qd-rquestion'), rwinner: $('qd-rwinner'),
    rtally: $('qd-rtally'), rvotes: $('qd-rvotes'), rscores: $('qd-rscores'),
    rwait: $('qd-rwait'), next: $('qd-next'),
  };
}

function submitQuestion() {
  const text = ui.input.value.trim();
  if (text.length < 8) return api.toast('Question trop courte');
  api.emit('add', { text });
  ui.input.value = '';
  ui.input.focus();
}

// ---------------------------------------------------------------------------
// Rendu par phase
// ---------------------------------------------------------------------------
function renderWriting(v) {
  const n = v.myQuestions.length;
  ui.hint.textContent = v.myReady
    ? 'Tu es prêt — on attend les autres.'
    : `Ajoute jusqu'à ${v.config.customMax} questions sur le groupe, ou passe directement : la banque complétera.`;
  ui.input.disabled = n >= v.config.customMax || v.myReady;
  ui.add.disabled = ui.input.disabled;

  ui.mine.innerHTML = '';
  for (const q of v.myQuestions) {
    const del = api.el('button', { text: 'Retirer', onclick: () => api.emit('remove', { id: q.id }) });
    del.disabled = v.myReady;
    ui.mine.append(api.el('li', {},
      api.el('div.info', {}, api.el('div.t', { text: q.text })), del));
  }

  // On annonce le volume, jamais le contenu : les questions des autres doivent
  // rester une surprise.
  ui.pool.textContent = v.total
    ? `${v.total} question${v.total > 1 ? 's' : ''} proposée${v.total > 1 ? 's' : ''} par le groupe — la partie en jouera ${v.config.rounds}.`
    : `Aucune question proposée pour l'instant : la partie en tirera ${v.config.rounds} dans la banque.`;

  ui.ready.textContent = v.myReady ? '✓ Prêt — annuler' : 'Je suis prêt';
  ui.ready.classList.toggle('primary', !v.myReady);
  ui.ready.classList.toggle('done', !!v.myReady);

  ui.begin.style.display = api.isHost ? 'block' : 'none';
  ui.begin.disabled = !v.canBegin;
  ui.begin.textContent = v.canBegin
    ? 'Démarrer la partie'
    : `En attente de ${v.waitingFor.join(', ') || '…'}`;
}

function renderVoting(v) {
  const r = v.round;
  if (!r) return;
  ui.counter.textContent = `Question ${r.index} / ${r.total}`;
  ui.question.textContent = r.text;
  ui.status.textContent = r.myVote
    ? `Vote enregistré (${r.votedCount}/${r.expectedVotes}) — on attend les autres`
    : 'Désigne quelqu\'un.';

  ui.options.innerHTML = '';
  for (const p of r.options) {
    const b = api.el(`button${r.myVote === p.id ? '.picked' : ''}`, {
      text: p.you ? `${p.pseudo} (toi)` : p.pseudo,
      disabled: !!r.myVote,
    });
    b.onclick = () => api.emit('vote', { targetId: p.id });
    ui.options.append(b);
  }

  if (shownRound !== r.index) {
    shownRound = r.index;
    clearInterval(barTimer);
    const total = Math.max(1, r.endsAt - api.now());
    barTimer = setInterval(() => {
      const left = r.endsAt - api.now();
      ui.bar.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
    }, 250);
  }
}

function renderReveal(v) {
  const d = v.reveal;
  if (!d) return;
  ui.rauthor.textContent = d.author
    ? `Question ${d.index} / ${d.total} — proposée par ${d.author}`
    : `Question ${d.index} / ${d.total}`;
  ui.rquestion.textContent = d.text;

  if (!d.winners.length) {
    ui.rwinner.textContent = 'Personne n\'a voté.';
  } else if (d.winners.length === 1) {
    ui.rwinner.innerHTML = `C'est <strong>${api.esc(d.winners[0])}</strong>`;
  } else {
    ui.rwinner.innerHTML = `Égalité : <strong>${api.esc(d.winners.join(' et '))}</strong>`;
  }

  ui.rtally.innerHTML = '';
  for (const t of d.tally) {
    ui.rtally.append(api.el(`li${t.winner ? '.picked' : ''}`, {},
      api.el('span', { text: t.pseudo }),
      api.el('span', { text: `${t.count} voix` })));
  }

  ui.rvotes.innerHTML = '';
  for (const x of d.votes) {
    ui.rvotes.append(api.el('li', {},
      api.el('span', { text: `${x.voterPseudo} → ${x.targetPseudo}` }),
      api.el(`span.${x.good ? 'good' : 'wrong'}`, { text: x.good ? '✓' : '✗' })));
  }

  ui.rscores.innerHTML = '';
  for (const p of d.scores) {
    const right = api.el('span', {});
    if (p.delta) right.append(api.el('span.good', { text: `+${p.delta}` }), ' → ');
    right.append(`${p.score} pts`);
    ui.rscores.append(api.el('li', {}, api.el('span', { text: p.pseudo }), right));
  }

  ui.next.style.display = api.isHost ? 'block' : 'none';
  ui.next.textContent = d.isLast ? 'Voir le classement' : 'Question suivante';
  const host = api.players.find((p) => p.isHost);
  ui.rwait.textContent = api.isHost ? '' : `En attente de ${host ? host.pseudo : "l'hôte"}…`;
}

// ---------------------------------------------------------------------------
// Contrat de module
// ---------------------------------------------------------------------------
export default {
  id: 'qui-dans-le-groupe',

  mount(root, initialApi) {
    api = initialApi;
    ui = build(root, api.el);

    ui.add.onclick = submitQuestion;
    ui.input.onkeydown = (e) => { if (e.key === 'Enter') submitQuestion(); };
    ui.ready.onclick = () => api.ready(!ui.ready.classList.contains('done'));
    ui.begin.onclick = () => api.emit('begin');
    ui.next.onclick = () => api.emit('skip');
  },

  render(view, current) {
    api = current;
    if (!view || !ui) return;

    for (const [name, panel] of Object.entries(ui.panels)) {
      panel.classList.toggle('active', name === view.phase);
    }
    if (view.phase !== 'VOTING') {
      clearInterval(barTimer);
      shownRound = -1;
    }

    if (view.phase === 'WRITING') renderWriting(view);
    if (view.phase === 'VOTING') renderVoting(view);
    if (view.phase === 'REVEAL') renderReveal(view);
  },

  unmount() {
    clearInterval(barTimer);
    shownRound = -1;
    ui = null;
  },
};
