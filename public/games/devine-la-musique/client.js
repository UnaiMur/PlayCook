// ---------------------------------------------------------------------------
// Client de « Devine la musique ».
//
// Quatre ecrans : les reglages, la selection (mode selection seulement), la
// manche, la revelation.
//
// La difference visible avec « Qui a mis ça ? » : pendant la manche il n'y a
// RIEN a regarder, et c'est voulu — une pochette donnerait la reponse. A la
// place, un disque qui tourne et qui bat avec la musique, sur le fond anime.
// Le serveur ne nous envoie de toute facon pas le titre, donc meme en
// fouillant la page on ne le trouverait pas.
//
// Seule exception : le proprietaire du morceau, qui ne peut pas repondre. Lui
// voit sa pochette et son titre — il les connait deja.
// ---------------------------------------------------------------------------
import { creerRecherche } from '../_shared/recherche.js';
import { visualiseur } from '../../core/visualiseur.js';

const JEU = 'devine-la-musique';
const SEARCH = `/api/${JEU}/search`;
const PREVIEW = `/api/${JEU}/preview`;
const GENRES = `/api/${JEU}/genres`;

let ui = null;
let api = null;
let recherche = null;
let barTimer = null;
let mancheAffichee = -1;
let revelationAffichee = -1;
let genresCharges = false;

// ---------------------------------------------------------------------------
// Pre-ecoute pendant la selection
//
// Les URL d'extrait sont signees et expirent en ~15 min : on n'en garde jamais,
// on en demande une fraiche au serveur au moment du clic.
// ---------------------------------------------------------------------------
let cueKey = null;
let cueBoutons = [];

function arreterCue() {
  api.sound.cueStop();
  cueKey = null;
  for (const b of cueBoutons) b.textContent = '▶';
}

function boutonEcoute(trackKey) {
  // Les listes sont reconstruites a chaque rendu : on oublie les boutons qui
  // ne sont plus dans la page, sinon la liste enflerait a chaque frappe.
  cueBoutons = cueBoutons.filter((b) => b.isConnected);

  const b = api.el('button.play', {
    type: 'button',
    'aria-label': 'Écouter un extrait',
    text: cueKey === trackKey ? '⏸' : '▶',
  });
  cueBoutons.push(b);
  b.onclick = async (e) => {
    e.stopPropagation();          // sinon le clic ajouterait aussi le morceau
    if (cueKey === trackKey) return arreterCue();
    arreterCue();
    cueKey = trackKey;
    b.textContent = '…';
    try {
      const r = await fetch(`${PREVIEW}?id=${encodeURIComponent(trackKey)}`);
      const corps = await r.json();
      if (cueKey !== trackKey) return;      // un autre bouton a pris la main
      if (!r.ok || !corps.url) throw new Error('ko');
      await api.sound.cuePlay(corps.url);
      b.textContent = '⏸';
    } catch {
      arreterCue();
      api.toast('Extrait indisponible');
    }
  };
  return b;
}

// Pas de <img src=""> : un src vide relance une requete sur la page elle-meme.
const vignette = (url) => (url ? api.el('img', { src: url, alt: '' }) : api.el('span.noart'));

// Une ligne de resultat ou de selection.
const ligne = (t) => [
  vignette(t.artwork),
  api.el('div.info', {},
    api.el('div.t', { text: t.title }),
    api.el('div.a', { text: t.artist })),
  boutonEcoute(t.trackKey),
];

// ---------------------------------------------------------------------------
// Le disque qui bat, et le fond anime
//
// Une seule boucle pour les deux : elle est tenue par le visualiseur, qui nous
// rappelle a chaque image. Deux boucles fausseraient la detection des coups.
// ---------------------------------------------------------------------------
let douceur = 0;

function demarrerPulse() {
  arreterPulse();
  visualiseur.demarrer({
    niveaux: () => api.sound.niveaux?.() || null,
    surPulsation: ({ grave, coup }) => {
      // Le coup donne le punch, le grave le fond : sans le lissage le disque
      // tremblerait au lieu de respirer.
      const vise = Math.min(1, grave * 0.75 + coup * 0.85);
      douceur += (vise - douceur) * 0.3;
      ui?.scene?.style.setProperty('--pulse', douceur.toFixed(3));
    },
  });
}

function arreterPulse() {
  visualiseur.arreter();
  douceur = 0;
  ui?.scene?.style.setProperty('--pulse', '0');
}

// ---------------------------------------------------------------------------
// Construction, une seule fois
// ---------------------------------------------------------------------------
function build(root, el) {
  // --- reglages ------------------------------------------------------------
  const modeAlea = el('button', { text: '🎲 Musique aléatoire' });
  const modeSel = el('button', { text: '🎤 Les joueurs choisissent' });
  const modeAide = el('p.hint');
  const genreLigne = el('label.champ', {});
  const genres = el('select');
  const manches = el('input', { type: 'number', min: '3', max: '30', step: '1' });
  const lancer = el('button.primary', { text: 'Lancer la partie' });
  const attente = el('p.hint.center');
  const erreur = el('p.erreur');

  genreLigne.append(el('span', { text: 'Genre' }), genres);

  const reglages = el('section.panel', {},
    el('h2', { text: 'Comment on joue ?' }),
    el('div.modes', {}, modeAlea, modeSel),
    modeAide,
    genreLigne,
    el('label.champ', {}, el('span', { text: 'Nombre de morceaux' }), manches),
    erreur, lancer, attente);

  // --- selection -----------------------------------------------------------
  const aide = el('p.hint');
  const mienne = el('ul.mine');
  const pret = el('button', { text: 'Je suis prêt' });
  const commencer = el('button.primary', { text: 'Lancer le blind test' });
  const tableauSel = el('ul.players');

  const selection = el('section.panel', {},
    el('h2', { text: 'Choisis tes morceaux' }),
    aide, recherche.champ, recherche.liste,
    el('h3', { text: 'Ta sélection' }),
    mienne, tableauSel, pret, commencer);

  // --- manche --------------------------------------------------------------
  const compteur = el('p.hint.center');
  const disque = el('div.disque');
  const scene = el('div.pochette', {}, disque);
  const barre = el('div');
  const etat = el('p.hint.center');
  const champ = el('input', { placeholder: 'Titre, artiste, ou les deux…', maxlength: '80', autocomplete: 'off' });
  const envoyer = el('button.primary', { text: 'Valider' });
  const saisie = el('div.guessRow', {}, champ, envoyer);
  const marques = el('div.marques');
  const essais = el('ul.tries');
  const passer = el('button', { text: 'Je passe' });
  const tableau = el('ul.players');

  const manche = el('section.panel', {},
    compteur, scene, el('div.bar', {}, barre), etat,
    marques, saisie, essais, passer, tableau);

  // --- revelation ----------------------------------------------------------
  const rcompteur = el('p.hint.center');
  const rpochette = el('div');
  const rtitre = el('h2.center');
  const rproprio = el('p.owner.center');
  const rdetail = el('ul.votes');
  const rscores = el('ul.votes');
  const rattente = el('p.hint');
  const suivant = el('button', { text: 'Suivant' });

  const revelation = el('section.panel', {},
    rcompteur, rpochette, rtitre, rproprio, rdetail,
    el('h3', { text: 'Points' }),
    rscores, rattente, suivant);

  root.append(reglages, selection, manche, revelation);

  return {
    panels: { REGLAGES: reglages, SELECTION: selection, MANCHE: manche, REVELATION: revelation },
    modeAlea, modeSel, modeAide, genreLigne, genres, manches, lancer, attente, erreur,
    aide, mienne, pret, commencer, tableauSel,
    compteur, scene, disque, barre, etat, champ, envoyer, saisie, marques, essais,
    passer, tableau,
    rcompteur, rpochette, rtitre, rproprio, rdetail, rscores, rattente, suivant,
  };
}

// ---------------------------------------------------------------------------
// Reglages
// ---------------------------------------------------------------------------
async function chargerGenres() {
  if (genresCharges) return;
  genresCharges = true;
  // « Tous genres » est toujours la, meme si Deezer ne repond pas : le mode
  // aleatoire reste jouable sans la liste.
  ui.genres.append(api.el('option', { value: '0', text: 'Tous genres' }));
  try {
    const r = await fetch(GENRES);
    if (!r.ok) throw new Error('ko');
    for (const g of await r.json()) {
      if (g.id === '0') continue;
      ui.genres.append(api.el('option', { value: g.id, text: g.name }));
    }
  } catch {
    // Pas de toast : l'hote n'a rien demande, et « tous genres » suffit.
  }
}

function renderReglages(v) {
  const r = v.reglages;
  if (!r) return;

  const alea = r.mode === 'aleatoire';
  ui.modeAlea.classList.toggle('picked', alea);
  ui.modeSel.classList.toggle('picked', !alea);
  ui.modeAide.textContent = alea
    ? 'Les morceaux viennent des tops Deezer. Personne ne les connaît à l\'avance.'
    : `Chacun dépose entre ${r.minMorceaux} et ${r.maxMorceaux} morceaux.`
      + ' Tu ne réponds pas sur les tiens.';

  ui.genreLigne.style.display = alea ? 'flex' : 'none';
  if (alea) chargerGenres();
  if (ui.genres.value !== r.genre) ui.genres.value = r.genre;
  // On ne réécrit pas le champ pendant que l'hôte tape dedans.
  if (document.activeElement !== ui.manches) ui.manches.value = String(r.manches);

  ui.modeSel.disabled = !r.selectionPossible || r.chargement;
  ui.modeSel.title = r.selectionPossible ? '' : 'Il faut au moins deux joueurs';
  ui.modeAlea.disabled = r.chargement;
  ui.manches.disabled = r.chargement;
  ui.genres.disabled = r.chargement;

  ui.erreur.textContent = r.erreur || '';
  ui.erreur.style.display = r.erreur ? 'block' : 'none';

  const aMoi = r.jeSuisHote;
  ui.lancer.style.display = aMoi ? 'block' : 'none';
  ui.lancer.disabled = r.chargement;
  ui.lancer.textContent = r.chargement
    ? 'Préparation…'
    : (alea ? 'Lancer la partie' : 'Passer à la sélection');

  const hote = api.players.find((p) => p.isHost);
  ui.attente.textContent = aMoi
    ? ''
    : `${hote ? hote.pseudo : "L'hôte"} prépare la partie…`;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------
function renderSelection(v) {
  const s = v.selection;
  if (!s) return;
  const n = s.mesMorceaux.length;

  ui.aide.textContent = `Entre ${s.minMorceaux} et ${s.maxMorceaux} morceaux`
    + ` — tu en as ${n}.`;
  recherche.bloquer(n >= s.maxMorceaux || s.jePret);

  ui.mienne.innerHTML = '';
  for (const t of s.mesMorceaux) {
    const del = api.el('button', { text: 'Retirer' });
    del.disabled = s.jePret;
    del.onclick = () => {
      if (cueKey === t.trackKey) arreterCue();
      api.emit('remove', { id: t.trackKey });
    };
    ui.mienne.append(api.el('li', {}, ...ligne(t), del));
  }

  ui.pret.disabled = n < s.minMorceaux;
  ui.pret.textContent = s.jePret ? '✓ Prêt — annuler' : 'Je suis prêt';
  ui.pret.classList.toggle('primary', !s.jePret && n >= s.minMorceaux);
  ui.pret.classList.toggle('done', !!s.jePret);

  ui.tableauSel.innerHTML = '';
  for (const p of s.tableau) {
    ui.tableauSel.append(api.el('li', {},
      api.el('span', { text: p.pseudo }),
      api.el('span.meta', { text: p.pret ? `✓ ${p.combien} morceaux` : `${p.combien}…` })));
  }

  ui.commencer.style.display = s.jeSuisHote ? 'block' : 'none';
  ui.commencer.disabled = !s.pretAPartir || s.chargement;
  ui.commencer.textContent = s.chargement
    ? 'Préparation…'
    : (s.pretAPartir ? 'Lancer le blind test' : 'On attend tout le monde…');
}

// ---------------------------------------------------------------------------
// Manche
// ---------------------------------------------------------------------------
function marque(texte, ok) {
  return api.el(`span.marque${ok ? '.ok' : ''}`, { text: `${ok ? '✓' : '○'} ${texte}` });
}

function renderManche(v) {
  const m = v.manche;
  if (!m) return;
  ui.compteur.textContent = `Morceau ${m.index} / ${m.total}`;

  // On ne redessine la scene qu'au changement de manche : sinon chaque frappe
  // rechargerait l'image et la ferait clignoter.
  if (mancheAffichee !== m.index) {
    mancheAffichee = m.index;
    ui.scene.innerHTML = '';
    if (m.monMorceau) {
      // Le proprietaire : il connait la reponse, autant lui montrer.
      ui.scene.append(m.monMorceau.artwork
        ? api.el('img.art', { src: m.monMorceau.artwork, alt: '' })
        : api.el('div.disque'));
    } else {
      ui.scene.append(api.el('div.disque'));
    }
    ui.champ.value = '';
    demarrerManche(m);
  }

  const fini = (m.jaiTitre && m.jaiArtiste) || m.jaiAbandonne;
  const bloque = !m.peutRepondre;

  ui.saisie.style.display = bloque || fini ? 'none' : 'flex';
  ui.passer.style.display = bloque || fini ? 'none' : 'block';
  ui.marques.innerHTML = '';

  if (bloque) {
    ui.etat.textContent = m.monMorceau
      ? `C'est ton morceau — ${m.monMorceau.title}, ${m.monMorceau.artist}. Tu ne réponds pas sur celui-là.`
      : 'Tu ne peux pas répondre sur ce morceau.';
  } else {
    ui.marques.append(marque('titre', m.jaiTitre), marque('artiste', m.jaiArtiste));
    if (m.jaiTitre && m.jaiArtiste) {
      const rang = m.monRang === 1 ? 'en premier' : `${m.monRang}ᵉ`;
      ui.etat.textContent = `Tout trouvé ${rang} — on attend les autres.`;
    } else if (m.jaiAbandonne) {
      ui.etat.textContent = 'Tu passes cette manche.';
    } else if (!m.previewUrl) {
      ui.etat.textContent = 'Extrait indisponible — demande à quelqu\'un de chanter.';
    } else {
      ui.etat.textContent = 'Titre, artiste, ou les deux d\'un coup.';
    }
  }

  ui.essais.innerHTML = '';
  for (const e of m.mesEssais) {
    const quoi = e.titre && e.artiste ? '✓ titre + artiste'
      : e.titre ? '✓ titre'
        : e.artiste ? '✓ artiste'
          : e.connu ? 'déjà trouvé'
            : '✗';
    const classe = e.titre || e.artiste ? 'good' : e.connu ? 'connu' : 'wrong';
    ui.essais.append(api.el(`li.${classe}`, {},
      api.el('span', { text: e.texte }),
      api.el('span', { text: quoi })));
  }

  ui.tableau.innerHTML = '';
  for (const p of m.tableau) {
    const marqueur = p.proprietaire ? '🔒 son morceau'
      : p.abandon ? '—'
        : `${p.titre ? '✓' : '○'} titre  ${p.artiste ? '✓' : '○'} artiste`;
    ui.tableau.append(api.el('li', {},
      api.el('span', { text: p.pseudo }),
      api.el('span.meta', { text: marqueur })));
  }
}

function demarrerManche(m) {
  // Le serveur n'a pas pu resigner l'URL : la manche se joue sans son plutot
  // que de bloquer la partie.
  if (m.previewUrl) {
    api.sound.playAt(m.previewUrl, m.startAt,
      () => api.toast("Touche l'écran pour activer le son"));
  }
  // Le fond part avec la musique, pas avant : sinon il s'agite dans le silence.
  setTimeout(() => demarrerPulse(), Math.max(0, m.startAt - api.now()));
  startBar(m);
  if (m.peutRepondre) setTimeout(() => ui?.champ.focus?.(), 0);
}

function startBar(m) {
  clearInterval(barTimer);
  const total = Math.max(1, m.endsAt - m.startAt);
  barTimer = setInterval(() => {
    const reste = m.endsAt - api.now();
    ui.barre.style.width = `${Math.max(0, Math.min(100, (reste / total) * 100))}%`;
  }, 250);
}

// ---------------------------------------------------------------------------
// Revelation
// ---------------------------------------------------------------------------
function renderRevelation(v) {
  const d = v.revelation;
  if (!d) return;
  ui.rcompteur.textContent = `Morceau ${d.index} / ${d.total}`;

  if (revelationAffichee !== d.index) {
    revelationAffichee = d.index;
    ui.rpochette.innerHTML = '';
    if (d.artwork) ui.rpochette.append(api.el('img.art', { src: d.artwork, alt: '' }));
  }
  ui.rtitre.textContent = `${d.title} — ${d.artist}`;
  ui.rproprio.innerHTML = d.proprietaires.length
    ? `Choisi par <strong>${api.esc(d.proprietaires.join(' et '))}</strong>`
    : '';

  ui.rdetail.innerHTML = '';
  for (const t of d.detail) {
    const quoi = t.titre && t.artiste ? 'titre + artiste'
      : t.titre ? 'titre' : 'artiste';
    const detail = t.secondes != null ? `${quoi} — ${t.secondes} s` : quoi;
    ui.rdetail.append(api.el('li', {},
      api.el('span', { text: `${t.pseudo} — ${detail}` }),
      api.el('span.good', { text: `+${t.points}` })));
  }
  for (const nom of d.bredouilles) {
    ui.rdetail.append(api.el('li', {},
      api.el('span', { text: nom }),
      api.el('span.wrong', { text: '✗' })));
  }
  if (!d.detail.length && !d.bredouilles.length) {
    ui.rdetail.append(api.el('li', {},
      api.el('span', { text: 'Personne ne cherchait' }), api.el('span')));
  }

  ui.rscores.innerHTML = '';
  for (const p of d.scores) {
    const droite = api.el('span', {});
    if (p.delta) droite.append(api.el('span.good', { text: `+${p.delta}` }), ' → ');
    droite.append(`${p.score} pts`);
    ui.rscores.append(api.el('li', {}, api.el('span', { text: p.pseudo }), droite));
  }

  ui.suivant.style.display = api.isHost ? 'block' : 'none';
  ui.suivant.textContent = d.isLast ? 'Voir le classement' : 'Morceau suivant';
  const hote = api.players.find((p) => p.isHost);
  ui.rattente.textContent = api.isHost ? '' : `En attente de ${hote ? hote.pseudo : "l'hôte"}…`;
}

// ---------------------------------------------------------------------------
export default {
  id: JEU,

  mount(root, initialApi) {
    api = initialApi;
    recherche = creerRecherche(api, {
      url: SEARCH,
      placeholder: 'Titre ou artiste, puis Entrée…',
      minLength: 3,
      ligne: (item) => ligne(item),
      surChoix: (item) => {
        arreterCue();
        api.emit('submit', item);
        recherche.vider();
      },
    });
    ui = build(root, api.el);

    // --- reglages ---
    const reglage = (data) => api.emit('reglages', data);
    ui.modeAlea.onclick = () => reglage({ mode: 'aleatoire' });
    ui.modeSel.onclick = () => reglage({ mode: 'selection' });
    ui.genres.onchange = () => reglage({ genre: ui.genres.value });
    ui.manches.onchange = () => reglage({ manches: ui.manches.value });
    ui.lancer.onclick = () => api.emit('valider');

    // --- selection ---
    ui.pret.onclick = () => api.ready(!ui.pret.classList.contains('done'));
    ui.commencer.onclick = () => api.emit('commencer');
    api.sound.onCueEnd(() => arreterCue());

    // --- manche ---
    const envoyer = () => {
      const texte = ui.champ.value.trim();
      if (!texte) return;
      api.emit('guess', { texte });
      ui.champ.value = '';
    };
    ui.envoyer.onclick = envoyer;
    ui.champ.onkeydown = (e) => { if (e.key === 'Enter') envoyer(); };
    ui.passer.onclick = () => api.emit('abandonner');

    // --- revelation ---
    ui.suivant.onclick = () => api.emit('skip');
  },

  render(view, current) {
    api = current;
    if (!view || !ui) return;

    for (const [nom, panel] of Object.entries(ui.panels)) {
      panel.classList.toggle('active', nom === view.phase);
    }

    // Hors manche, plus de son, plus de fond anime, plus de chrono.
    if (view.phase !== 'MANCHE') {
      clearInterval(barTimer);
      mancheAffichee = -1;
      arreterPulse();
      api.sound.stop();
    }
    if (view.phase !== 'REVELATION') revelationAffichee = -1;
    if (view.phase !== 'SELECTION') arreterCue();

    if (view.phase === 'REGLAGES') renderReglages(view);
    if (view.phase === 'SELECTION') renderSelection(view);
    if (view.phase === 'MANCHE') renderManche(view);
    if (view.phase === 'REVELATION') renderRevelation(view);
  },

  unmount() {
    clearInterval(barTimer);
    recherche?.arreter();
    arreterPulse();
    arreterCue();
    api?.sound.stop();
    mancheAffichee = -1;
    revelationAffichee = -1;
    genresCharges = false;
    ui = null;
  },
};
