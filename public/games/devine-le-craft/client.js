// ---------------------------------------------------------------------------
// Client de « Devine le craft ».
//
// Deux ecrans : la grille a deviner, puis la revelation. Pas de moteur partage
// ici — ce jeu n'est pas un « devine qui » : il a une bonne reponse, on tape
// au clavier, et la manche se termine quand tout le monde a trouve.
//
// Les textures de Minecraft appartiennent a Mojang : la grille est donc
// dessinee en CSS, chaque ingredient represente par une lettre et rappele dans
// une legende sous la grille.
// ---------------------------------------------------------------------------

let ui = null;
let api = null;
let barTimer = null;
let shownRound = -1;

function build(root, el) {
  const question = el('section.panel', {},
    el('p.hint.center', { id: 'dlc-counter' }),
    el('div.craft', { id: 'dlc-craft' }),
    el('div.bar', {}, el('div', { id: 'dlc-bar' })),
    el('p.hint.center', { id: 'dlc-status' }),
    el('div.guessRow', {},
      el('input', { id: 'dlc-input', placeholder: 'Ça fabrique quoi ?', maxlength: '60', autocomplete: 'off' }),
      el('button.primary', { id: 'dlc-send', text: 'Valider' })),
    el('ul.tries', { id: 'dlc-tries' }),
    el('button', { id: 'dlc-giveup', text: 'Je donne ma langue au chat' }),
    el('ul.players', { id: 'dlc-board' }));

  const reveal = el('section.panel', {},
    el('p.hint.center', { id: 'dlc-rcounter' }),
    el('div.craft', { id: 'dlc-rcraft' }),
    el('p.owner.center', { id: 'dlc-answer' }),
    el('ul.votes', { id: 'dlc-finders' }),
    el('h3', { text: 'Points' }),
    el('ul.votes', { id: 'dlc-scores' }),
    el('p.hint', { id: 'dlc-wait' }),
    el('button', { id: 'dlc-next', text: 'Suivant' }));

  root.append(question, reveal);
  const $ = (id) => root.querySelector(`#${id}`);
  return {
    panels: { QUESTION: question, REVEAL: reveal },
    counter: $('dlc-counter'), craft: $('dlc-craft'), bar: $('dlc-bar'),
    status: $('dlc-status'), input: $('dlc-input'), send: $('dlc-send'),
    tries: $('dlc-tries'), giveup: $('dlc-giveup'), board: $('dlc-board'),
    rcounter: $('dlc-rcounter'), rcraft: $('dlc-rcraft'), answer: $('dlc-answer'),
    finders: $('dlc-finders'), scores: $('dlc-scores'), wait: $('dlc-wait'),
    next: $('dlc-next'),
  };
}

// ---------------------------------------------------------------------------
// La grille de craft
//
// `grille` est faite de trois chaines de trois caracteres : une lettre pour un
// ingredient, un point pour une case vide. `legende` dit ce que vaut chaque
// lettre. Les recettes « en vrac » n'ont pas de grille : la position n'y compte
// pas, on liste simplement les ingredients.
// ---------------------------------------------------------------------------
function dessinerCraft(data, el) {
  const bloc = el('div');

  if (data.grille) {
    const grille = el('div.grid');
    for (const ligne of data.grille) {
      for (const c of ligne) {
        grille.append(c === '.'
          ? el('div.cell.empty')
          : el(`div.cell.ing-${c}`, { text: c }));
      }
    }
    bloc.append(grille);

    const legende = el('ul.legend');
    for (const [lettre, nom] of Object.entries(data.legende || {})) {
      legende.append(el('li', {},
        el(`span.chip.ing-${lettre}`, { text: lettre }),
        el('span', { text: nom })));
    }
    bloc.append(legende);
  } else if (data.vrac) {
    bloc.append(el('p.hint.center', { text: 'Sans ordre particulier :' }));
    const liste = el('ul.legend');
    for (const i of data.vrac) {
      liste.append(el('li', {},
        el('span.chip', { text: `${i.nombre}×` }),
        el('span', { text: i.nom })));
    }
    bloc.append(liste);
  }

  if (data.quantite > 1) {
    bloc.append(el('p.hint.center', { text: `Donne ${data.quantite} exemplaires.` }));
  }
  return bloc;
}

const etoiles = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

// ---------------------------------------------------------------------------
function renderQuestion(v) {
  const r = v.round;
  if (!r) return;
  ui.counter.textContent = `Craft ${r.index} / ${r.total} — difficulté ${etoiles(r.niveau)}`;

  // On ne redessine la grille qu'au changement de manche.
  if (shownRound !== r.index) {
    shownRound = r.index;
    ui.craft.innerHTML = '';
    ui.craft.append(dessinerCraft(r, api.el));
    ui.input.value = '';
    startBar(r);
    // Le champ reprend la main a chaque nouvelle grille, sans voler le focus
    // au joueur en train de taper.
    if (!r.jaiTrouve) setTimeout(() => ui.input.focus?.(), 0);
  }

  const fini = r.jaiTrouve || r.jaiAbandonne;
  ui.input.disabled = fini;
  ui.send.disabled = fini;
  ui.giveup.style.display = fini ? 'none' : 'block';

  if (r.jaiTrouve) {
    const rang = r.monRang === 1 ? 'en premier' : `${r.monRang}ᵉ`;
    ui.status.textContent = `Trouvé ${rang} — on attend les autres (${r.trouves}/${r.joueurs})`;
  } else if (r.jaiAbandonne) {
    ui.status.textContent = `Tu passes — ${r.trouves}/${r.joueurs} ont trouvé`;
  } else {
    ui.status.textContent = `${r.trouves}/${r.joueurs} ont trouvé`;
  }

  ui.tries.innerHTML = '';
  for (const e of r.mesEssais) {
    if (e.abandon) continue;
    ui.tries.append(api.el(`li.${e.bon ? 'good' : 'wrong'}`, {},
      api.el('span', { text: e.texte }),
      api.el('span', { text: e.bon ? '✓' : '✗' })));
  }

  ui.board.innerHTML = '';
  for (const p of r.tableau) {
    ui.board.append(api.el('li', {},
      api.el('span', { text: p.pseudo }),
      api.el('span.meta', { text: p.trouve ? '✓' : p.abandon ? '—' : '…' })));
  }
}

function startBar(r) {
  clearInterval(barTimer);
  const total = Math.max(1, r.endsAt - api.now());
  barTimer = setInterval(() => {
    const left = r.endsAt - api.now();
    ui.bar.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
  }, 250);
}

function renderReveal(v) {
  const d = v.reveal;
  if (!d) return;
  ui.rcounter.textContent = `Craft ${d.index} / ${d.total} — difficulté ${etoiles(d.niveau)}`;
  ui.rcraft.innerHTML = '';
  ui.rcraft.append(dessinerCraft(d, api.el));
  ui.answer.innerHTML = `C'était <strong>${api.esc(d.resultat)}</strong>`;

  ui.finders.innerHTML = '';
  if (!d.trouveurs.length) {
    ui.finders.append(api.el('li', {},
      api.el('span', { text: 'Personne n\'a trouvé' }), api.el('span')));
  }
  for (const t of d.trouveurs) {
    ui.finders.append(api.el('li', {},
      api.el('span', { text: `${t.pseudo} — ${t.secondes} s` }),
      api.el('span.good', { text: `+${t.points}` })));
  }
  for (const nom of d.rates) {
    ui.finders.append(api.el('li', {},
      api.el('span', { text: nom }),
      api.el('span.wrong', { text: '✗' })));
  }

  ui.scores.innerHTML = '';
  for (const p of d.scores) {
    const droite = api.el('span', {});
    if (p.delta) droite.append(api.el('span.good', { text: `+${p.delta}` }), ' → ');
    droite.append(`${p.score} pts`);
    ui.scores.append(api.el('li', {}, api.el('span', { text: p.pseudo }), droite));
  }

  ui.next.style.display = api.isHost ? 'block' : 'none';
  ui.next.textContent = d.isLast ? 'Voir le classement' : 'Craft suivant';
  const hote = api.players.find((p) => p.isHost);
  ui.wait.textContent = api.isHost ? '' : `En attente de ${hote ? hote.pseudo : "l'hôte"}…`;
}

// ---------------------------------------------------------------------------
export default {
  id: 'devine-le-craft',

  mount(root, initialApi) {
    api = initialApi;
    ui = build(root, api.el);

    const envoyer = () => {
      const texte = ui.input.value.trim();
      if (!texte) return;
      api.emit('guess', { texte });
      ui.input.value = '';
    };
    ui.send.onclick = envoyer;
    ui.input.onkeydown = (e) => { if (e.key === 'Enter') envoyer(); };
    ui.giveup.onclick = () => api.emit('abandonner');
    ui.next.onclick = () => api.emit('skip');
  },

  render(view, current) {
    api = current;
    if (!view || !ui) return;

    for (const [nom, panel] of Object.entries(ui.panels)) {
      panel.classList.toggle('active', nom === view.phase);
    }
    if (view.phase !== 'QUESTION') {
      clearInterval(barTimer);
      shownRound = -1;
    }

    if (view.phase === 'QUESTION') renderQuestion(view);
    if (view.phase === 'REVEAL') renderReveal(view);
  },

  unmount() {
    clearInterval(barTimer);
    shownRound = -1;
    ui = null;
  },
};
