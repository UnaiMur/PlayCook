// ---------------------------------------------------------------------------
// Client du blind test « Qui a mis ça ? ».
//
// Les trois ecrans, la recherche et les votes viennent du moteur partage
// (../_shared/devine-qui.js). Il ne reste ici que ce qui est propre a la
// musique : la pre-ecoute pendant la selection, et le declenchement
// synchronise de l'extrait pendant la manche.
// ---------------------------------------------------------------------------
import { createGuessWhoClient } from '../_shared/devine-qui.js';

const SEARCH = '/api/blindtest/search';
const PREVIEW = '/api/blindtest/preview';

let cueKey = null;        // morceau en pre-ecoute
let cueButtons = [];      // boutons ▶ actuellement a l'ecran

// ---------------------------------------------------------------------------
// Pre-ecoute
//
// Les URL d'extrait sont signees et expirent en ~15 min : on ne les conserve
// jamais, on en demande une fraiche au serveur au moment du clic.
// ---------------------------------------------------------------------------
function stopCue(api) {
  api.sound.cueStop();
  cueKey = null;
  for (const b of cueButtons) b.textContent = '▶';
}

function playButton(trackKey, api) {
  // Les listes sont reconstruites a chaque rendu : on oublie les boutons qui
  // ne sont plus dans la page, sinon la liste enflerait a chaque frappe.
  cueButtons = cueButtons.filter((b) => b.isConnected);

  const b = api.el('button.play', {
    type: 'button',
    'aria-label': 'Écouter un extrait',
    // L'etat est recalcule a chaque rendu : la liste est reconstruite des qu'un
    // joueur ajoute un morceau, et l'extrait en cours doit garder son icone.
    text: cueKey === trackKey ? '⏸' : '▶',
  });
  cueButtons.push(b);
  b.onclick = async (e) => {
    e.stopPropagation();        // sinon un clic sur ▶ ajouterait aussi le morceau
    if (cueKey === trackKey) return stopCue(api);
    stopCue(api);
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
      stopCue(api);
      api.toast('Extrait indisponible');
    }
  };
  return b;
}

// Pas de <img src=""> : un src vide relance une requete sur la page elle-meme.
const cover = (url, api) =>
  (url ? api.el('img', { src: url, alt: '' }) : api.el('span.noart'));

const bigCover = (url, api) =>
  (url ? api.el('img.art', { src: url, alt: '' }) : api.el('div.art'));

export default createGuessWhoClient({
  id: 'blindtest',

  search: {
    url: SEARCH,
    placeholder: 'Titre ou artiste, puis Entrée…',
    minLength: 3,
  },

  texts: {
    pick: 'Choisis tes morceaux',
    mine: 'Ta sélection',
    hint: (config, n) =>
      `Entre ${config.minItems} et ${config.maxItems} morceaux — tu en as ${n}.`,
    counter: (r) => `Morceau ${r.index} / ${r.total}`,
    prompt: 'Qui a mis ça ?',
    yours: "C'est ton morceau — croise les doigts.",
  },

  // Une ligne de resultat ou de selection : pochette, titre, artiste, ▶
  row: (t, api) => [
    cover(t.artwork, api),
    api.el('div.info', {},
      api.el('div.t', { text: t.title }),
      api.el('div.a', { text: t.artist })),
    playButton(t.trackKey, api),
  ],

  stage: (r, api) => [
    bigCover(r.artwork, api),
    api.el('h2.center', { text: r.title }),
    api.el('p.artist.center', { text: r.artist }),
  ],

  reveal: (d, api) => [
    bigCover(d.artwork, api),
    api.el('h2.center', { text: `${d.title} — ${d.artist}` }),
  ],

  hooks: {
    // Un clic sur un resultat ajoute le morceau : on coupe la pre-ecoute.
    beforeSubmit: (api) => stopCue(api),
    beforeRemove: (item, api) => { if (cueKey === item.trackKey) stopCue(api); },

    // Quand l'extrait arrive au bout tout seul, le bouton doit redevenir ▶.
    mounted: (api) => api.sound.onCueEnd(() => stopCue(api)),

    roundStart: (r, api) => {
      // Le serveur n'a pas pu resigner l'URL : la manche se joue sans son
      // plutot que de bloquer la partie.
      if (!r.previewUrl) return api.toast('Extrait indisponible — vote quand même');
      api.sound.playAt(r.previewUrl, r.startAt,
        () => api.toast("Touche l'écran pour activer le son"));
    },
    roundStop: (api) => api.sound.stop(),

    // Un extrait lance pendant la selection ne doit pas couvrir la partie.
    pickingLeft: (api) => stopCue(api),
    cleanup: (api) => { stopCue(api); api.sound.stop(); },
  },
});
