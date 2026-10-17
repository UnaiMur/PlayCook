// Petits lecteurs de variables d'environnement, partages par la plateforme et
// par les jeux. Chaque jeu declare ses propres reglages avec ces helpers :
// la plateforme n'a pas a connaitre la liste.

export const num = (v, d) => {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  return Number.isNaN(n) ? d : n;
};

export const bool = (v, d = false) => {
  if (v === undefined || v === '') return d;
  return v === 'true' || v === '1';
};

export const str = (v, d = '') => (v === undefined || v === '' ? d : String(v));
