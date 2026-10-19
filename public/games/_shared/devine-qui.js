// ---------------------------------------------------------------------------
// Moteur « devine qui a mis ça », cote client.
//
// Pendant de games/_shared/devine-qui.js : les trois ecrans (selection, vote,
// revelation), la recherche avec anti-rebond, la liste de sa selection, les
// boutons de vote et la barre de temps sont les memes pour tous les jeux batis
// dessus. Un jeu fournit une SPEC qui dit seulement :
//
//   search    ou chercher, et quoi afficher dans le champ
//   texts     les quelques phrases propres au jeu
//   row       a quoi ressemble une ligne de resultat ou de selection
//   stage     ce qu'on montre pendant la manche (image, titre, sous-titre)
//   reveal    ce qu'on montre a la revelation
//   hooks     ce qu'il faut declencher ou arreter (du son, par exemple)
//
// Aucun identifiant DOM : le moteur garde ses propres references, donc deux
// jeux ne peuvent pas se marcher dessus.
// ---------------------------------------------------------------------------

export function createGuessWhoClient(spec) {
  let ui = null;
  let api = null;
  let searchTimer = null;
  let searchSeq = 0;
  let barTimer = null;
  let stagedRound = -1;     // manche actuellement dessinee
  let stagedReveal = -1;

  // -------------------------------------------------------------------------
  // Construction, une seule fois
  // -------------------------------------------------------------------------
  function build(root, el) {
    const results = el('ul.results');
    const mine = el('ul.mine');
    const hint = el('p.hint');
    const search = el('input', {
      placeholder: spec.search.placeholder,
      maxlength: '80',
      autocomplete: 'off',
    });
    const ready = el('button', { text: 'Je suis prêt' });
    const begin = el('button.primary', { text: 'Démarrer la partie' });

    const picking = el('section.panel', {},
      el('h2', { text: spec.texts.pick }),
      hint, search, results,
      el('h3', { text: spec.texts.mine }),
      mine, ready, begin);

    const stage = el('div');
    const bar = el('div');
    const status = el('p.hint.center');
    const suspects = el('div.suspects');
    const counter = el('p.hint.center');

    const playing = el('section.panel', {},
      counter, stage, el('div.bar', {}, bar), status, suspects);

    const revealStage = el('div');
    const owner = el('p.owner.center');
    const rvotes = el('ul.votes');
    const rscores = el('ul.votes');
    const rwait = el('p.hint');
    const next = el('button', { text: 'Suivant' });

    const reveal = el('section.panel', {},
      revealStage, owner, rvotes,
      el('h3', { text: 'Points' }),
      rscores, rwait, next);

    root.append(picking, playing, reveal);

    return {
      panels: { PICKING: picking, PLAYING: playing, REVEAL: reveal },
      hint, search, results, mine, ready, begin,
      counter, stage, bar, status, suspects,
      revealStage, owner, rvotes, rscores, rwait, next,
    };
  }

  // -------------------------------------------------------------------------
  // Recherche
  //
  // Chaque frappe partait en requete : a plusieurs joueurs, le quota de l'API
  // (partage par tout le serveur, il est par IP) sautait en quelques secondes.
  // D'ou un anti-rebond long, un minimum de caracteres, et Entree pour forcer.
  // -------------------------------------------------------------------------
  async function runSearch(q) {
    const seq = ++searchSeq;
    ui.results.innerHTML = '';
    ui.results.append(api.el('li.loading', { text: 'Recherche…' }));
    try {
      const r = await fetch(`${spec.search.url}?q=${encodeURIComponent(q)}`);
      const body = await r.json();
      if (seq !== searchSeq) return;      // une frappe plus recente a pris la main

      ui.results.innerHTML = '';
      if (!r.ok) return api.toast(searchError(body));
      if (!body.length) return api.toast('Aucun résultat');

      for (const item of body) {
        const li = api.el('li', {}, ...spec.row(item, api));
        li.onclick = () => {
          spec.hooks?.beforeSubmit?.(api);
          api.emit('submit', item);
          ui.search.value = '';
          ui.results.innerHTML = '';
        };
        ui.results.append(li);
      }
    } catch {
      if (seq !== searchSeq) return;
      ui.results.innerHTML = '';
      api.toast('Recherche indisponible');
    }
  }

  function searchError(body) {
    if (body?.error === 'rate' || body?.error === 'busy') {
      return `Trop de recherches en même temps — réessaie dans ${body.retryIn || 10} s`;
    }
    // Un jeu peut expliquer ses propres pannes (une cle d'API absente, par ex.)
    return spec.search.errorMessage?.(body) || 'Recherche indisponible';
  }

  // -------------------------------------------------------------------------
  // Rendu par phase
  // -------------------------------------------------------------------------
  function renderPicking(v) {
    const n = v.mySubmissions.length;
    ui.hint.textContent = spec.texts.hint(v.config, n);
    ui.search.disabled = n >= v.config.maxItems || v.myReady;

    ui.mine.innerHTML = '';
    for (const item of v.mySubmissions) {
      const del = api.el('button', { text: 'Retirer' });
      del.disabled = v.myReady;
      del.onclick = () => {
        spec.hooks?.beforeRemove?.(item, api);
        api.emit('remove', { id: item.id });
      };
      ui.mine.append(api.el('li', {}, ...spec.row(item, api), del));
    }

    ui.ready.disabled = n < v.config.minItems;
    ui.ready.textContent = v.myReady ? '✓ Prêt — annuler' : 'Je suis prêt';
    ui.ready.classList.toggle('primary', !v.myReady && n >= v.config.minItems);
    ui.ready.classList.toggle('done', !!v.myReady);

    ui.begin.style.display = api.isHost ? 'block' : 'none';
    ui.begin.disabled = !v.canBegin;
    ui.begin.textContent = v.canBegin
      ? 'Démarrer la partie'
      : `En attente de ${v.waitingFor.join(', ') || '…'}`;
  }

  function renderPlaying(v) {
    const r = v.round;
    if (!r) return;
    ui.counter.textContent = spec.texts.counter(r);

    // On ne redessine l'element qu'au changement de manche : sinon chaque vote
    // recharcherait l'image et la ferait clignoter.
    if (stagedRound !== r.index) {
      stagedRound = r.index;
      ui.stage.innerHTML = '';
      ui.stage.append(...spec.stage(r, api));
      spec.hooks?.roundStart?.(r, api);
      startBar(r);
    }

    ui.status.textContent = !r.canVote
      ? spec.texts.yours
      : r.myVote
        ? `Vote enregistré (${r.votedCount}/${r.expectedVotes})`
        : spec.texts.prompt;

    ui.suspects.innerHTML = '';
    for (const p of r.suspects) {
      const b = api.el(`button${r.myVote === p.id ? '.picked' : ''}`, {
        text: p.pseudo,
        disabled: !r.canVote || !!r.myVote,
      });
      b.onclick = () => api.emit('vote', { suspectId: p.id });
      ui.suspects.append(b);
    }
  }

  function startBar(r) {
    clearInterval(barTimer);
    const total = Math.max(1, r.voteEndsAt - r.startAt);
    barTimer = setInterval(() => {
      const left = r.voteEndsAt - api.now();
      ui.bar.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
    }, 250);
  }

  function renderReveal(v) {
    const d = v.reveal;
    if (!d) return;
    if (stagedReveal !== d.index) {
      stagedReveal = d.index;
      ui.revealStage.innerHTML = '';
      ui.revealStage.append(...spec.reveal(d, api));
    }
    ui.owner.innerHTML = `C'était <strong>${api.esc(d.owners.join(' et '))}</strong>`;

    ui.rvotes.innerHTML = '';
    if (!d.votes.length) {
      ui.rvotes.append(api.el('li', {},
        api.el('span', { text: "Personne n'a voté" }), api.el('span')));
    }
    for (const x of d.votes) {
      ui.rvotes.append(api.el('li', {},
        api.el('span', { text: `${x.voterPseudo} → ${x.suspectPseudo}` }),
        api.el(`span.${x.correct ? 'good' : 'wrong'}`, { text: x.correct ? '✓' : '✗' })));
    }

    ui.rscores.innerHTML = '';
    for (const p of d.scores) {
      const right = api.el('span', {});
      if (p.delta) right.append(api.el('span.good', { text: `+${p.delta}` }), ' → ');
      right.append(`${p.score} pts`);
      ui.rscores.append(api.el('li', {}, api.el('span', { text: p.pseudo }), right));
    }

    ui.next.style.display = api.isHost ? 'block' : 'none';
    ui.next.textContent = d.isLast ? 'Voir le classement' : 'Suivant';
    const host = api.players.find((p) => p.isHost);
    ui.rwait.textContent = api.isHost ? '' : `En attente de ${host ? host.pseudo : "l'hôte"}…`;
  }

  // -------------------------------------------------------------------------
  // Contrat de module attendu par public/core/app.js
  // -------------------------------------------------------------------------
  return {
    id: spec.id,

    mount(root, initialApi) {
      api = initialApi;
      ui = build(root, api.el);

      const min = spec.search.minLength ?? 3;
      ui.search.oninput = (e) => {
        clearTimeout(searchTimer);
        const q = e.target.value.trim();
        if (q.length < min) return (ui.results.innerHTML = '');
        searchTimer = setTimeout(() => runSearch(q), 700);
      };
      ui.search.onkeydown = (e) => {
        if (e.key !== 'Enter') return;
        clearTimeout(searchTimer);
        const q = e.target.value.trim();
        if (q.length >= 2) runSearch(q);
      };

      ui.ready.onclick = () => api.ready(!ui.ready.classList.contains('done'));
      ui.begin.onclick = () => api.emit('begin');
      ui.next.onclick = () => api.emit('skip');

      spec.hooks?.mounted?.(api);
    },

    render(view, current) {
      api = current;
      if (!view || !ui) return;

      for (const [name, panel] of Object.entries(ui.panels)) {
        panel.classList.toggle('active', name === view.phase);
      }

      if (view.phase !== 'PLAYING') {
        clearInterval(barTimer);
        stagedRound = -1;
        spec.hooks?.roundStop?.(api);
      }
      if (view.phase !== 'REVEAL') stagedReveal = -1;
      if (view.phase !== 'PICKING') spec.hooks?.pickingLeft?.(api);

      if (view.phase === 'PICKING') renderPicking(view);
      if (view.phase === 'PLAYING') renderPlaying(view);
      if (view.phase === 'REVEAL') renderReveal(view);
    },

    unmount() {
      clearTimeout(searchTimer);
      clearInterval(barTimer);
      stagedRound = -1;
      stagedReveal = -1;
      spec.hooks?.cleanup?.(api);
      ui = null;
    },
  };
}
