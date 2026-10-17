// ---------------------------------------------------------------------------
// Client du blind test « Qui a mis ca ? ».
//
// Tout ce qui est ici est propre a ce jeu : la recherche de morceaux, la
// pre-ecoute, le declenchement synchronise, l'ecran de vote et la revelation.
// Le salon, le classement, l'identite, le volume et l'horloge appartiennent a
// la plateforme — ce module ne les reimplemente pas, il les utilise via `api`.
// ---------------------------------------------------------------------------

const SEARCH = '/api/blindtest/search';
const PREVIEW = '/api/blindtest/preview';

let ui = null;              // references DOM, construites une fois
let api = null;
let cueKey = null;          // morceau en pre-ecoute
let searchTimer = null;
let searchSeq = 0;
let scheduledIndex = -1;    // evite de reprogrammer la meme manche
let barTimer = null;

// ---------------------------------------------------------------------------
// Construction de l'interface
// ---------------------------------------------------------------------------
function build(root, el) {
  const picking = el('section.panel', { id: 'bt-picking' },
    el('h2', { text: 'Choisis tes morceaux' }),
    el('p.hint', { id: 'bt-hint' }),
    el('input', { id: 'bt-search', placeholder: 'Titre ou artiste, puis Entrée…', autocomplete: 'off' }),
    el('ul.results', { id: 'bt-results' }),
    el('h3', { text: 'Ta sélection' }),
    el('ul.mine', { id: 'bt-mine' }),
    el('button', { id: 'bt-ready', text: 'Je suis prêt' }),
    el('button.primary', { id: 'bt-begin', text: 'Démarrer la partie' }));

  const playing = el('section.panel', { id: 'bt-playing' },
    el('p.hint.center', { id: 'bt-counter' }),
    el('img.art', { id: 'bt-art', alt: '' }),
    el('h2.center', { id: 'bt-title' }),
    el('p.artist.center', { id: 'bt-artist' }),
    el('div.bar', {}, el('div', { id: 'bt-bar' })),
    el('p.hint.center', { id: 'bt-status' }),
    el('div.suspects', { id: 'bt-suspects' }));

  const reveal = el('section.panel', { id: 'bt-reveal' },
    el('img.art', { id: 'bt-rart', alt: '' }),
    el('h2.center', { id: 'bt-rtitle' }),
    el('p.owner.center', { id: 'bt-rowner' }),
    el('ul.votes', { id: 'bt-rvotes' }),
    el('h3', { text: 'Points' }),
    el('ul.votes', { id: 'bt-rscores' }),
    el('p.hint', { id: 'bt-rwait' }),
    el('button', { id: 'bt-next', text: 'Suivant' }));

  root.append(picking, playing, reveal);

  const $ = (id) => root.querySelector(`#${id}`);
  return {
    panels: { PICKING: picking, PLAYING: playing, REVEAL: reveal },
    hint: $('bt-hint'), search: $('bt-search'), results: $('bt-results'),
    mine: $('bt-mine'), ready: $('bt-ready'), begin: $('bt-begin'),
    counter: $('bt-counter'), art: $('bt-art'), title: $('bt-title'),
    artist: $('bt-artist'), bar: $('bt-bar'), status: $('bt-status'),
    suspects: $('bt-suspects'),
    rart: $('bt-rart'), rtitle: $('bt-rtitle'), rowner: $('bt-rowner'),
    rvotes: $('bt-rvotes'), rscores: $('bt-rscores'), rwait: $('bt-rwait'),
    next: $('bt-next'),
  };
}

// ---------------------------------------------------------------------------
// Pre-ecoute
//
// Les URL d'extrait sont signees et expirent en ~15 min : on ne les conserve
// jamais, on en demande une fraiche au serveur au moment du clic.
// ---------------------------------------------------------------------------
function stopCue() {
  api.sound.cueStop();
  cueKey = null;
  ui && ui.panels.PICKING.querySelectorAll('.play').forEach((b) => { b.textContent = '▶'; });
}

function playButton(trackKey) {
  const b = api.el('button.play', {
    type: 'button',
    'aria-label': 'Écouter un extrait',
    // L'etat est recalcule a chaque rendu : la liste est reconstruite des qu'un
    // joueur ajoute un morceau, et l'extrait en cours doit garder son icone.
    text: cueKey === trackKey ? '⏸' : '▶',
  });
  b.onclick = async (e) => {
    e.stopPropagation();          // sinon un clic sur ▶ ajouterait aussi le morceau
    if (cueKey === trackKey) return stopCue();
    stopCue();
    cueKey = trackKey;
    b.textContent = '…';
    try {
      const r = await fetch(`${PREVIEW}?id=${encodeURIComponent(trackKey)}`);
      const body = await r.json();
      if (cueKey !== trackKey) return;    // un autre bouton a pris la main
      if (!r.ok || !body.url) throw new Error(body.error || 'ko');
      await api.sound.cuePlay(body.url);
      b.textContent = '⏸';
    } catch {
      stopCue();
      api.toast('Extrait indisponible');
    }
  };
  return b;
}

function trackRow(t, extra) {
  const row = api.el('li', {},
    // Pas de <img src=""> : un src vide relance une requete sur la page elle-meme.
    t.artwork ? api.el('img', { src: t.artwork, alt: '' }) : api.el('span.noart'),
    api.el('div.info', {},
      api.el('div.t', { text: t.title }),
      api.el('div.a', { text: t.artist })),
    playButton(t.trackKey));
  if (extra) row.append(extra);
  return row;
}

// ---------------------------------------------------------------------------
// Recherche
//
// Chaque frappe partait en requete : a plusieurs joueurs, le quota de l'API
// (partage par tout le serveur, il est par IP) sautait en quelques secondes.
// D'ou un anti-rebond long, un minimum de 3 caracteres, et Entree pour forcer.
// ---------------------------------------------------------------------------
async function runSearch(q) {
  const seq = ++searchSeq;
  ui.results.innerHTML = '<li class="loading">Recherche…</li>';
  try {
    const r = await fetch(`${SEARCH}?q=${encodeURIComponent(q)}`);
    const body = await r.json();
    if (seq !== searchSeq) return;        // une frappe plus recente a pris la main

    ui.results.innerHTML = '';
    if (!r.ok) {
      if (body.error === 'rate' || body.error === 'busy') {
        api.toast(`Trop de recherches en même temps — réessaie dans ${body.retryIn || 10} s`);
      } else {
        api.toast('Recherche indisponible');
      }
      return;
    }
    if (!body.length) return api.toast('Aucun résultat');

    for (const t of body) {
      const row = trackRow(t);
      row.onclick = () => {
        stopCue();
        api.emit('submit', t);
        ui.search.value = '';
        ui.results.innerHTML = '';
      };
      ui.results.append(row);
    }
  } catch {
    if (seq !== searchSeq) return;
    ui.results.innerHTML = '';
    api.toast('Recherche indisponible');
  }
}

// ---------------------------------------------------------------------------
// Rendu par phase
// ---------------------------------------------------------------------------
function renderPicking(v) {
  const n = v.mySubmissions.length;
  ui.hint.textContent =
    `Entre ${v.config.minTracks} et ${v.config.maxTracks} morceaux — tu en as ${n}.`;
  ui.search.disabled = n >= v.config.maxTracks || v.myReady;

  ui.mine.innerHTML = '';
  for (const m of v.mySubmissions) {
    const del = api.el('button', { text: 'Retirer' });
    del.onclick = () => {
      if (cueKey === m.trackKey) stopCue();
      api.emit('remove', { id: m.id });
    };
    ui.mine.append(trackRow(m, del));
  }

  ui.ready.disabled = n < v.config.minTracks;
  ui.ready.textContent = v.myReady ? '✓ Prêt — annuler' : 'Je suis prêt';
  ui.ready.classList.toggle('primary', !v.myReady && n >= v.config.minTracks);

  ui.begin.style.display = api.isHost ? 'block' : 'none';
  ui.begin.disabled = !v.canBegin;
  ui.begin.textContent = v.canBegin
    ? 'Démarrer la partie'
    : `En attente de ${v.waitingFor.join(', ') || '…'}`;
}

function renderPlaying(v) {
  const r = v.round;
  if (!r) return;
  ui.counter.textContent = `Morceau ${r.index} / ${r.total}`;
  ui.art.src = r.artwork || '';
  ui.title.textContent = r.title;
  ui.artist.textContent = r.artist;

  if (!r.canVote) {
    ui.status.textContent = "C'est ton morceau — croise les doigts.";
  } else if (r.myVote) {
    ui.status.textContent = `Vote enregistré (${r.votedCount}/${r.expectedVotes}) — on écoute la fin`;
  } else {
    ui.status.textContent = 'Qui a mis ça ?';
  }

  ui.suspects.innerHTML = '';
  for (const p of r.suspects) {
    const b = api.el(`button${r.myVote === p.id ? '.picked' : ''}`, {
      text: p.pseudo,
      disabled: !r.canVote || !!r.myVote,
    });
    b.onclick = () => api.emit('vote', { suspectId: p.id });
    ui.suspects.append(b);
  }

  schedulePlayback(r);
}

function schedulePlayback(r) {
  if (scheduledIndex === r.index) return;     // deja programme pour ce tour
  scheduledIndex = r.index;

  // Le serveur n'a pas pu resigner l'URL : la manche se joue sans son plutot
  // que de bloquer la partie.
  if (!r.previewUrl) {
    ui.status.textContent = 'Extrait indisponible — vote quand même';
  } else {
    api.sound.playAt(r.previewUrl, r.startAt, () => api.toast("Touche l'écran pour activer le son"));
  }

  clearInterval(barTimer);
  barTimer = setInterval(() => {
    const left = r.voteEndsAt - api.now();
    const total = r.voteEndsAt - r.startAt;
    ui.bar.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
  }, 250);
}

function renderReveal(v) {
  const d = v.reveal;
  if (!d) return;
  ui.rart.src = d.artwork || '';
  ui.rtitle.textContent = `${d.title} — ${d.artist}`;
  ui.rowner.innerHTML = `C'était <strong>${api.esc(d.owners.join(' et '))}</strong>`;

  ui.rvotes.innerHTML = '';
  if (!d.votes.length) {
    ui.rvotes.append(api.el('li', {}, api.el('span', { text: "Personne n'a voté" }), api.el('span')));
  }
  for (const x of d.votes) {
    ui.rvotes.append(api.el('li', {},
      api.el('span', { text: `${x.voterPseudo} → ${x.suspectPseudo}` }),
      api.el(`span.${x.correct ? 'good' : 'wrong'}`, { text: x.correct ? '+100' : '✗' })));
  }

  ui.rscores.innerHTML = '';
  for (const p of d.scores) {
    const right = api.el('span', {});
    if (p.delta) right.append(api.el('span.good', { text: `+${p.delta}` }), ' → ');
    right.append(`${p.score} pts`);
    ui.rscores.append(api.el('li', {}, api.el('span', { text: p.pseudo }), right));
  }

  ui.next.style.display = api.isHost ? 'block' : 'none';
  ui.next.textContent = d.isLast ? 'Voir le classement' : 'Morceau suivant';
  const host = api.players.find((p) => p.isHost);
  ui.rwait.textContent = api.isHost ? '' : `En attente de ${host ? host.pseudo : "l'hôte"}…`;
}

// ---------------------------------------------------------------------------
// Contrat de module
// ---------------------------------------------------------------------------
export default {
  id: 'blindtest',

  mount(root, initialApi) {
    api = initialApi;
    ui = build(root, api.el);

    ui.search.oninput = (e) => {
      clearTimeout(searchTimer);
      const q = e.target.value.trim();
      if (q.length < 3) return (ui.results.innerHTML = '');
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
    api.sound.onCueEnd(stopCue);
  },

  render(view, current) {
    api = current;
    if (!view || !ui) return;

    for (const [name, panel] of Object.entries(ui.panels)) {
      panel.classList.toggle('active', name === view.phase);
    }

    // Un extrait lance pendant la selection ne doit pas couvrir la partie.
    if (view.phase !== 'PICKING') stopCue();
    if (view.phase !== 'PLAYING') {
      clearInterval(barTimer);
      scheduledIndex = -1;
      api.sound.stop();
    }

    if (view.phase === 'PICKING') {
      renderPicking(view);
      // Le bouton porte son propre etat : le clic doit connaitre l'etat courant.
      ui.ready.classList.toggle('done', !!view.myReady);
    }
    if (view.phase === 'PLAYING') renderPlaying(view);
    if (view.phase === 'REVEAL') renderReveal(view);
  },

  unmount() {
    clearTimeout(searchTimer);
    clearInterval(barTimer);
    stopCue();
    api.sound.stop();
    scheduledIndex = -1;
    ui = null;
  },
};
