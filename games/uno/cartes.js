// ---------------------------------------------------------------------------
// Le paquet et les regles de pose.
//
// Separe du serveur pour une raison simple : ce sont les regles qu'on a envie
// de verifier une par une, sans monter une partie entiere. tests/sim8.js les
// prend d'ailleurs en premier, avant de jouer.
//
// Une carte : { id, couleur, valeur }
//   couleur  rouge | bleu | vert | jaune | noir  (noir = joker et +4)
//   valeur   '0'..'9' | 'passe' | 'inverse' | 'plus2' | 'joker' | 'plus4'
// ---------------------------------------------------------------------------

export const COULEURS = ['rouge', 'bleu', 'vert', 'jaune'];
export const SPECIALES = ['passe', 'inverse', 'plus2'];

// Un paquet standard : 108 cartes.
//   par couleur : un 0, deux de chaque 1-9, deux passe, deux inverse, deux +2
//   plus quatre jokers et quatre +4
export function paquet() {
  const cartes = [];
  let n = 0;
  const ajouter = (couleur, valeur) => cartes.push({ id: `c${n++}`, couleur, valeur });

  for (const couleur of COULEURS) {
    ajouter(couleur, '0');
    for (let v = 1; v <= 9; v++) { ajouter(couleur, String(v)); ajouter(couleur, String(v)); }
    for (const s of SPECIALES) { ajouter(couleur, s); ajouter(couleur, s); }
  }
  for (let i = 0; i < 4; i++) { ajouter('noir', 'joker'); ajouter('noir', 'plus4'); }
  return cartes;
}

export const estNoire = (c) => c.couleur === 'noir';
export const estPioche = (c) => c.valeur === 'plus2' || c.valeur === 'plus4';

// Combien de cartes cette carte fait piocher au suivant.
export const combienPiocher = (c) => (c.valeur === 'plus2' ? 2 : c.valeur === 'plus4' ? 4 : 0);

// Score de fin de manche : le gagnant encaisse ce qui reste dans les autres mains.
export function points(carte) {
  if (carte.valeur === 'joker' || carte.valeur === 'plus4') return 50;
  if (SPECIALES.includes(carte.valeur)) return 20;
  return Number(carte.valeur) || 0;
}

// ---------------------------------------------------------------------------
// Peut-on poser cette carte maintenant ?
//
// `cumul` est le nombre de cartes que le joueur courant doit piocher a cause
// des +2/+4 accumules. Tant qu'il est positif, seule une relance est permise,
// et uniquement si la regle d'empilement est active.
// ---------------------------------------------------------------------------
export function jouable(carte, { dessus, couleur, cumul = 0, empiler = false }) {
  if (cumul > 0) {
    if (!empiler) return false;
    // Un +2 relance un +2 ; un +4 relance l'un comme l'autre.
    if (carte.valeur === 'plus4') return true;
    if (carte.valeur === 'plus2') return dessus.valeur === 'plus2';
    return false;
  }
  if (estNoire(carte)) return true;             // joker et +4 se posent sur tout
  if (carte.couleur === couleur) return true;   // meme couleur (celle choisie, apres un joker)
  return carte.valeur === dessus.valeur;        // meme chiffre ou meme symbole
}

// Jump-in : poser hors de son tour une carte strictement identique a celle du
// dessus. Jamais sur un joker, qui n'a plus de couleur une fois pose.
export function identique(carte, dessus) {
  return !estNoire(carte) && !estNoire(dessus)
    && carte.couleur === dessus.couleur
    && carte.valeur === dessus.valeur;
}

// ---------------------------------------------------------------------------
// Nom du fichier image attendu pour une carte, sans extension.
//
//   rouge-7, bleu-passe, vert-inverse, jaune-plus2, joker, joker-plus4
//
// Le client essaie cartes/<nom>.png et retombe sur une carte dessinee en CSS
// si le fichier n'existe pas : on peut donc ajouter ses images une par une.
// ---------------------------------------------------------------------------
export function nomImage(carte) {
  if (carte.valeur === 'joker') return 'joker';
  if (carte.valeur === 'plus4') return 'joker-plus4';
  return `${carte.couleur}-${carte.valeur}`;
}

// La liste complete des images possibles : sert a documenter ce qu'il faut
// dessiner, et au test qui verifie qu'on n'a rien oublie.
export function toutesLesImages() {
  const noms = new Set();
  for (const c of paquet()) noms.add(nomImage(c));
  return [...noms].sort();
}
