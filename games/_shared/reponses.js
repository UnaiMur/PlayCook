// ---------------------------------------------------------------------------
// Comparaison des reponses libres. Partage par les jeux ou l'on tape la
// reponse au clavier : « Devine le craft » et « Devine la musique ».
//
// Le joueur tape au clavier, souvent vite et sur un telephone : « etabli »,
// « Établi », « table de craft », « etablie ». Tout ca doit passer. En
// revanche « four » ne doit pas valider « haut fourneau » : on tolere la
// faute de frappe, pas le mot d'a cote.
// ---------------------------------------------------------------------------

// Articles courants en tete de reponse : « un etabli » vaut « etabli ».
// « the » est la pour les titres et les artistes anglophones : « the weeknd »
// doit valoir « weeknd », comme « les clash » vaut « clash ».
const ARTICLES = /^(un|une|le|la|les|des|du|de la|de l|l|d|the)\s+/;

export function normaliser(texte) {
  return String(texte ?? '')
    .normalize('NFD')                   // sépare les accents de leur lettre
    .replace(/[̀-ͯ]/g, '')    // ...et les retire
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')        // ponctuation, tirets, apostrophes
    .trim()
    .replace(ARTICLES, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Distance de Levenshtein, bornee : au-dela de `max` on arrete, ca suffit pour
// decider et ca evite de calculer toute la matrice pour rien.
export function distance(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let precedente = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const courante = [i];
    let meilleure = i;
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      courante[j] = Math.min(
        precedente[j] + 1,        // suppression
        courante[j - 1] + 1,      // insertion
        precedente[j - 1] + cout  // substitution
      );
      if (courante[j] < meilleure) meilleure = courante[j];
    }
    if (meilleure > max) return max + 1;   // plus aucun espoir de passer sous max
    precedente = courante;
  }
  return precedente[b.length];
}

// Plus le mot est long, plus on pardonne — mais jamais au point de confondre
// deux crafts differents.
function tolerance(longueur) {
  if (longueur <= 4) return 0;
  if (longueur <= 8) return 1;
  return 2;
}

export function correspond(reponse, alias) {
  const essai = normaliser(reponse);
  if (!essai) return false;
  for (const a of alias) {
    const attendu = normaliser(a);
    if (!attendu) continue;
    if (essai === attendu) return true;
    if (distance(essai, attendu, tolerance(attendu.length)) <= tolerance(attendu.length)) {
      return true;
    }
  }
  return false;
}
