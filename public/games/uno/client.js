// ---------------------------------------------------------------------------
// Client UNO.
//
// Trois ecrans : les regles maison, la table, la fin de manche.
//
// La table est un ovale au centre — pioche et defausse — avec les autres
// joueurs disposes tout autour par un calcul d'angle, et ta main en bas.
// Ta main est la seule que tu recois : des autres, le serveur n'envoie que le
// nombre de cartes.
//
// Les cartes sont dessinees en CSS. Si public/games/uno/cartes/<nom>.png
// existe, l'image prend la place du dessin, carte par carte — voir le README.
// ---------------------------------------------------------------------------

const DOSSIER = '/games/uno/cartes';
const SYMBOLES = { passe: '⃠', inverse: '⇄', plus2: '+2', plus4: '+4', joker: '★' };
const NOM_COULEUR = { rouge: 'Rouge', bleu: 'Bleu', vert: 'Vert', jaune: 'Jaune' };

// Le serveur dit quelles cartes ont recu une image ; on ne demande que
// celles-la. Sans cette liste, chaque carte non dessinee ferait un 404 dans la
// console du joueur.
let avecImage = new Set();

async function chargerListeImages() {
  try {
    const r = await fetch('/api/uno/cartes');
    if (r.ok) avecImage = new Set(await r.json());
  } catch {
    avecImage = new Set();      // tant pis : tout reste dessine en CSS
  }
}

let ui = null;
let api = null;
let barTimer = null;
let choixEnCours = null;   // carte noire en attente d'une couleur

// ---------------------------------------------------------------------------
// Une carte
// ---------------------------------------------------------------------------
function nomImage(c) {
  if (c.valeur === 'joker') return 'joker';
  if (c.valeur === 'plus4') return 'joker-plus4';
  return `${c.couleur}-${c.valeur}`;
}

function carteNode(c, { petite = false, dos = false } = {}) {
  const el = api.el;
  if (dos) {
    // Le dos suit la même règle que les faces : ton image si elle existe,
    // le motif dessiné en CSS sinon.
    const node = el(`div.carte.dos${petite ? '.petite' : ''}`);
    if (avecImage.has('dos')) {
      const img = el('img.face', { src: `${DOSSIER}/dos.png`, alt: '' });
      img.onerror = () => { avecImage.delete('dos'); img.remove(); };
      node.append(img);
    }
    return node;
  }

  const node = el(`div.carte.c-${c.couleur}${petite ? '.petite' : ''}`);
  const texte = SYMBOLES[c.valeur] || c.valeur;
  node.append(el('span.valeur', { text: texte }));

  const nom = nomImage(c);
  if (avecImage.has(nom)) {
    // L'image recouvre le dessin. Si elle echoue quand meme (fichier corrompu),
    // on la retire et le dessin reste visible dessous.
    const img = el('img.face', { src: `${DOSSIER}/${nom}.png`, alt: '' });
    img.onerror = () => { avecImage.delete(nom); img.remove(); };
    node.append(img);
  }
  return node;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------
function build(root, el) {
  // --- ecran des regles ---
  const listeRegles = el('div.reglesListe');
  const manchesBtns = el('div.manches');
  const joueursRegles = el('ul.players');
  const btnDistribuer = el('button.primary', { text: 'Distribuer' });
  const attenteRegles = el('p.hint');

  const regles = el('section.panel', {},
    el('h2', { text: 'Règles de la partie' }),
    el('p.hint', { text: 'À cocher avant de distribuer — tout le monde les voit.' }),
    listeRegles,
    el('h3', { text: 'Manches' }), manchesBtns,
    el('h3', { text: 'Joueurs' }), joueursRegles,
    btnDistribuer, attenteRegles);

  // --- table ---
  const table = el('div.table');
  const sieges = el('div.sieges');
  const pioche = el('div.pile.pioche');
  const defausse = el('div.pile.defausse');
  const couleurActive = el('div.couleurActive');
  const infoTable = el('p.hint.center');
  const journal = el('ul.journal');
  const main = el('div.main');
  const actions = el('div.actionsUno');
  const barre = el('div');

  table.append(sieges, el('div.centre', {}, pioche, defausse), couleurActive);

  const jeu = el('section.panel', {},
    el('p.hint.center', {}, el('span', { id: 'uno-manche' })),
    table,
    el('div.bar', {}, barre),
    infoTable, journal, main, actions);

  // --- fin de manche ---
  const finTitre = el('p.owner.center');
  const finRestes = el('ul.votes');
  const finScores = el('ul.votes');
  const btnSuivante = el('button.primary', { text: 'Manche suivante' });
  const attenteFin = el('p.hint');

  const manche = el('section.panel', {},
    el('h2.center', { text: 'Fin de manche' }),
    finTitre,
    el('h3', { text: 'Cartes restantes' }), finRestes,
    el('h3', { text: 'Scores' }), finScores,
    btnSuivante, attenteFin);

  root.append(regles, jeu, manche);

  return {
    panels: { REGLES: regles, JEU: jeu, MANCHE: manche },
    listeRegles, manchesBtns, joueursRegles, btnDistribuer, attenteRegles,
    sieges, pioche, defausse, couleurActive, infoTable, journal, main, actions,
    barre, mancheTexte: jeu.querySelector('#uno-manche'),
    finTitre, finRestes, finScores, btnSuivante, attenteFin,
  };
}

// ---------------------------------------------------------------------------
// Écran des règles
// ---------------------------------------------------------------------------
const LIBELLES = {
  empiler: ['Empiler les +2 et +4', 'Renvoyer un +2 au suivant au lieu de ramasser.'],
  piocherJusqu: ['Piocher jusqu\'à pouvoir jouer', 'Sinon : une seule carte, puis on passe.'],
  penaliteUno: ['Pénalité si on oublie UNO', 'Les autres peuvent te dénoncer : +2 cartes.'],
  jumpIn: ['Jouer hors de son tour', 'Poser une carte strictement identique, à tout moment.'],
};

function renderRegles(v) {
  ui.listeRegles.innerHTML = '';
  for (const [nom, [titre, detail]] of Object.entries(LIBELLES)) {
    const actif = !!v.regles[nom];
    const ligne = api.el(`button.regle${actif ? '.on' : ''}`, {
      disabled: !v.estHote,
    },
    api.el('span.coche', { text: actif ? '✓' : '' }),
    api.el('span.texte', {},
      api.el('strong', { text: titre }),
      api.el('span.hint', { text: detail })));
    ligne.onclick = () => api.emit('regle', { nom, actif: !actif });
    ui.listeRegles.append(ligne);
  }

  ui.manchesBtns.innerHTML = '';
  for (const n of [1, 3, 5]) {
    const b = api.el(`button${v.manches === n ? '.primary' : ''}`, {
      text: `${n} manche${n > 1 ? 's' : ''}`,
      disabled: !v.estHote,
    });
    b.onclick = () => api.emit('manches', { n });
    ui.manchesBtns.append(b);
  }

  ui.joueursRegles.innerHTML = '';
  for (const j of v.joueurs) {
    ui.joueursRegles.append(api.el(`li.${j.connecte ? '' : 'off'}`, {},
      api.el('span', { text: j.pseudo }), api.el('span.meta', { text: '' })));
  }

  ui.btnDistribuer.style.display = v.estHote ? 'block' : 'none';
  ui.btnDistribuer.disabled = !v.assez;
  ui.btnDistribuer.textContent = v.assez ? 'Distribuer' : 'Il faut au moins 2 joueurs';
  ui.attenteRegles.textContent = v.estHote ? '' : "L'hôte règle la partie…";
}

// ---------------------------------------------------------------------------
// La table
// ---------------------------------------------------------------------------
function placerSieges(joueurs) {
  ui.sieges.innerHTML = '';
  // Je suis toujours en bas : on fait tourner la liste pour me mettre en
  // premier, puis on repartit les autres sur l'ovale.
  const moi = joueurs.findIndex((j) => j.moi);
  const ordonnes = moi < 0 ? joueurs : [...joueurs.slice(moi), ...joueurs.slice(0, moi)];
  const autres = ordonnes.filter((j) => !j.moi);

  autres.forEach((j, i) => {
    // Repartis sur l'arc du haut, de la gauche vers la droite — le bas de la
    // table est ma place. Les rayons sont volontairement courts : un siege
    // mesure pres d'un cinquieme de la largeur, il deborderait sinon.
    const t = autres.length === 1 ? 0.5 : i / (autres.length - 1);
    const deg = 165 - 150 * t;
    const rad = (deg * Math.PI) / 180;
    const x = 50 + Math.cos(rad) * 34;
    const y = 44 - Math.sin(rad) * 30;

    const siege = api.el(`div.siege${j.sonTour ? '.actif' : ''}${j.connecte ? '' : '.off'}`);
    siege.style.left = `${x}%`;
    siege.style.top = `${y}%`;
    siege.append(
      api.el('div.dosPile', {}, carteNode(null, { dos: true, petite: true })),
      api.el('div.nom', { text: j.pseudo }),
      api.el('div.compte', { text: `${j.cartes}` }));

    if (j.uno) {
      const badge = api.el(`span.badgeUno${j.denoncable ? '.denoncable' : ''}`, {
        text: j.denoncable ? 'UNO ?' : 'UNO',
      });
      if (j.denoncable) {
        badge.onclick = (e) => { e.stopPropagation(); api.emit('denoncer', { cible: j.id }); };
      }
      siege.append(badge);
    }
    ui.sieges.append(siege);
  });
}

function renderJeu(v) {
  const t = v.table;
  ui.mancheTexte.textContent = `Manche ${v.manche} / ${v.manches}`
    + (t.sens === 1 ? ' — sens horaire ↻' : ' — sens antihoraire ↺');

  placerSieges(v.joueurs);

  ui.pioche.innerHTML = '';
  ui.pioche.append(carteNode(null, { dos: true }),
    api.el('span.compte', { text: `${t.pioche}` }));
  ui.pioche.onclick = () => { if (v.peutPiocher) api.emit('piocher'); };
  ui.pioche.classList.toggle('actif', !!v.peutPiocher);

  ui.defausse.innerHTML = '';
  if (t.dessus) ui.defausse.append(carteNode(t.dessus));

  ui.couleurActive.className = `couleurActive c-${t.couleur}`;
  ui.couleurActive.textContent = NOM_COULEUR[t.couleur] || '';

  // Ce qu'on attend de moi, en une phrase.
  if (v.doitRamasser) {
    ui.infoTable.textContent = `Tu dois ramasser ${t.cumul} cartes.`;
  } else if (t.cumul > 0 && v.monTour) {
    ui.infoTable.textContent = `${t.cumul} cartes en attente — relance ou ramasse.`;
  } else if (v.monTour) {
    ui.infoTable.textContent = v.peutPasser ? 'Joue la carte piochée ou passe.' : 'À toi.';
  } else {
    const qui = v.joueurs.find((j) => j.id === t.tourDe);
    ui.infoTable.textContent = qui ? `${qui.pseudo} joue…` : '';
  }

  ui.journal.innerHTML = '';
  for (const ligne of t.journal) ui.journal.append(api.el('li', { text: ligne }));

  // --- ma main ---
  ui.main.innerHTML = '';
  const jouables = new Set(v.jouables);
  const sautables = new Set(v.sautables);
  for (const c of v.main) {
    const posable = jouables.has(c.id) || sautables.has(c.id);
    const node = carteNode(c);
    node.classList.toggle('posable', posable);
    node.classList.toggle('grisee', !posable);
    if (posable) node.onclick = () => poser(c);
    ui.main.append(node);
  }

  // --- boutons ---
  ui.actions.innerHTML = '';
  if (v.peutPiocher) {
    ui.actions.append(api.el('button', {
      text: t.cumul > 0 ? `Ramasser ${t.cumul}` : 'Piocher',
      onclick: () => api.emit('piocher'),
    }));
  }
  if (v.peutPasser) {
    ui.actions.append(api.el('button', { text: 'Passer', onclick: () => api.emit('passer') }));
  }
  if (v.peutDireUno) {
    ui.actions.append(api.el('button.primary', { text: 'UNO !', onclick: () => api.emit('uno') }));
  }

  startBar(t);
}

// Poser une carte : les noires demandent d'abord une couleur.
function poser(c) {
  if (c.couleur !== 'noir') return api.emit('jouer', { carte: c.id });
  choixEnCours = c;
  ouvrirChoixCouleur();
}

function ouvrirChoixCouleur() {
  fermerChoixCouleur();
  const boite = api.el('div.choixCouleur', { id: 'uno-choix' },
    api.el('p.hint.center', { text: 'Choisis la couleur' }));
  const grille = api.el('div.couleurs');
  for (const couleur of ['rouge', 'bleu', 'vert', 'jaune']) {
    grille.append(api.el(`button.pastille.c-${couleur}`, {
      text: NOM_COULEUR[couleur],
      onclick: () => {
        api.emit('jouer', { carte: choixEnCours.id, couleur });
        choixEnCours = null;
        fermerChoixCouleur();
      },
    }));
  }
  const annuler = api.el('button', { text: 'Annuler', onclick: () => {
    choixEnCours = null;
    fermerChoixCouleur();
  } });
  boite.append(grille, annuler);
  ui.actions.parentNode.append(boite);
}

function fermerChoixCouleur() {
  const vieux = document.getElementById('uno-choix');
  if (vieux) vieux.remove();
}

function startBar(t) {
  clearInterval(barTimer);
  const total = Math.max(1, t.finTour - api.now());
  barTimer = setInterval(() => {
    const reste = t.finTour - api.now();
    ui.barre.style.width = `${Math.max(0, Math.min(100, (reste / total) * 100))}%`;
  }, 250);
}

// ---------------------------------------------------------------------------
function renderManche(v) {
  const f = v.fin;
  if (!f) return;
  ui.finTitre.innerHTML = `<strong>${api.esc(f.gagnant)}</strong> remporte la manche ${f.manche} — +${f.gagne} points`;

  ui.finRestes.innerHTML = '';
  for (const r of f.restes) {
    ui.finRestes.append(api.el('li', {},
      api.el('span', { text: r.pseudo }),
      api.el('span.meta', { text: r.cartes ? `${r.cartes} cartes — ${r.points} pts` : 'main vide' })));
  }

  ui.finScores.innerHTML = '';
  for (const p of f.scores) {
    const droite = api.el('span', {});
    if (p.delta) droite.append(api.el('span.good', { text: `+${p.delta}` }), ' → ');
    droite.append(`${p.score} pts`);
    ui.finScores.append(api.el('li', {}, api.el('span', { text: p.pseudo }), droite));
  }

  ui.btnSuivante.style.display = v.estHote ? 'block' : 'none';
  ui.btnSuivante.textContent = f.derniere ? 'Voir le classement' : 'Manche suivante';
  ui.attenteFin.textContent = v.estHote ? '' : "En attente de l'hôte…";
}

// ---------------------------------------------------------------------------
export default {
  id: 'uno',

  mount(root, initialApi) {
    api = initialApi;
    ui = build(root, api.el);
    ui.btnDistribuer.onclick = () => api.emit('distribuer');
    ui.btnSuivante.onclick = () => api.emit('suivante');
    // On redessine une fois la liste connue : les cartes deja a l'ecran
    // prendront leur image au rendu suivant, qui arrive au premier coup joue.
    chargerListeImages();
  },

  render(view, current) {
    api = current;
    if (!view || !ui) return;

    for (const [nom, panel] of Object.entries(ui.panels)) {
      panel.classList.toggle('active', nom === view.phase);
    }
    if (view.phase !== 'JEU') {
      clearInterval(barTimer);
      fermerChoixCouleur();
      choixEnCours = null;
    }

    if (view.phase === 'REGLES') renderRegles(view);
    if (view.phase === 'JEU') renderJeu(view);
    if (view.phase === 'MANCHE') renderManche(view);
  },

  unmount() {
    clearInterval(barTimer);
    fermerChoixCouleur();
    choixEnCours = null;
    ui = null;
  },
};
