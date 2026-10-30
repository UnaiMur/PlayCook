// ---------------------------------------------------------------------------
// Le champ de recherche des jeux qui puisent dans un catalogue.
//
// Extrait de devine-qui.js quand un troisieme jeu en a eu besoin. Ce n'est pas
// l'habillage qui justifie le partage, c'est le reglage : chaque frappe partait
// en requete, et a plusieurs joueurs le quota de l'API — partage par tout le
// serveur, il est par IP — sautait en quelques secondes. D'ou l'anti-rebond
// long, le minimum de caracteres, et Entree pour forcer la recherche.
//
// Ce reglage doit valoir pour tous les jeux a la fois : s'il n'existait qu'en
// double, une copie finirait par deriver et c'est le quota commun qui paierait.
// ---------------------------------------------------------------------------

const DELAI_MS = 700;      // anti-rebond entre deux frappes
const MIN_FORCE = 2;       // en-dessous, meme Entree ne cherche pas

// Rend { champ, liste, vider, bloquer, arreter } : deux elements a poser dans
// la page, et trois commandes pour le jeu qui les heberge.
//
//   url        ou chercher
//   minLength  a partir de combien de caracteres on part tout seul
//   ligne      (item, api) -> les enfants d'un <li> de resultat
//   surChoix   (item) -> appelee quand le joueur clique un resultat
//   surErreur  (corps) -> message propre au jeu, optionnel
export function creerRecherche(api, spec) {
  const liste = api.el('ul.results');
  const champ = api.el('input', {
    placeholder: spec.placeholder || 'Rechercher…',
    maxlength: '80',
    autocomplete: 'off',
  });

  let minuteur = null;
  let sequence = 0;      // pour ignorer la reponse d'une frappe depassee

  function message(corps) {
    if (corps?.error === 'rate' || corps?.error === 'busy') {
      return `Trop de recherches en même temps — réessaie dans ${corps.retryIn || 10} s`;
    }
    return spec.surErreur?.(corps) || 'Recherche indisponible';
  }

  async function lancer(q) {
    const seq = ++sequence;
    liste.innerHTML = '';
    liste.append(api.el('li.loading', { text: 'Recherche…' }));
    try {
      const r = await fetch(`${spec.url}?q=${encodeURIComponent(q)}`);
      const corps = await r.json();
      if (seq !== sequence) return;        // une frappe plus recente a pris la main

      liste.innerHTML = '';
      if (!r.ok) return api.toast(message(corps));
      if (!corps.length) return api.toast('Aucun résultat');

      for (const item of corps) {
        const li = api.el('li', {}, ...spec.ligne(item, api));
        li.onclick = () => spec.surChoix(item);
        liste.append(li);
      }
    } catch {
      if (seq !== sequence) return;
      liste.innerHTML = '';
      api.toast('Recherche indisponible');
    }
  }

  const minimum = spec.minLength ?? 3;

  champ.oninput = (e) => {
    clearTimeout(minuteur);
    const q = e.target.value.trim();
    if (q.length < minimum) return (liste.innerHTML = '');
    minuteur = setTimeout(() => lancer(q), DELAI_MS);
  };

  champ.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    clearTimeout(minuteur);
    const q = e.target.value.trim();
    if (q.length >= MIN_FORCE) lancer(q);
  };

  return {
    champ,
    liste,
    // Apres un choix : le champ se vide, les resultats disparaissent.
    vider() {
      clearTimeout(minuteur);
      sequence += 1;                       // une reponse en vol ne repeuplera rien
      champ.value = '';
      liste.innerHTML = '';
    },
    bloquer(oui) { champ.disabled = !!oui; },
    arreter() { clearTimeout(minuteur); sequence += 1; },
  };
}
