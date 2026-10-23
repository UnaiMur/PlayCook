// ---------------------------------------------------------------------------
// Fait le point sur les images de cartes du jeu « Unai », deposees dans
// public/games/uno/cartes/.
//
//   node tools/verifier-cartes-uno.js
//
// Le jeu n'en a pas besoin pour tourner — les cartes manquantes restent
// dessinees en CSS. Ce script sert a repondre a « qu'est-ce qu'il me reste a
// dessiner ? » et a reperer un fichier mal nomme, qui serait sinon ignore en
// silence.
// ---------------------------------------------------------------------------
import { readdirSync, existsSync } from 'fs';
import { toutesLesImages } from '../games/uno/cartes.js';

const DOSSIER = 'public/games/uno/cartes';
const EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

const attendues = toutesLesImages();

if (!existsSync(DOSSIER)) {
  console.log(`Le dossier ${DOSSIER} n'existe pas encore.`);
  console.log(`${attendues.length} images à dessiner. Voir ${DOSSIER}/LISEZMOI.md`);
  process.exit(0);
}

const fichiers = readdirSync(DOSSIER).filter((f) => EXTENSIONS.some((e) => f.toLowerCase().endsWith(e)));
const presentes = new Map();   // nom de carte -> fichier
const inconnues = [];

for (const f of fichiers) {
  const base = f.replace(/\.[^.]+$/, '');
  if (attendues.includes(base)) presentes.set(base, f);
  else inconnues.push(f);
}

const manquantes = attendues.filter((n) => !presentes.has(n));

console.log(`${presentes.size} / ${attendues.length} cartes en image.`);

if (manquantes.length) {
  console.log(`\nIl manque ${manquantes.length} image(s) — elles restent dessinées en CSS :`);
  // Groupees par couleur, c'est plus lisible quand il en reste beaucoup.
  const parPrefixe = {};
  for (const n of manquantes) {
    const prefixe = n.startsWith('joker') ? 'noires' : n.split('-')[0];
    (parPrefixe[prefixe] ||= []).push(n);
  }
  for (const [prefixe, liste] of Object.entries(parPrefixe)) {
    console.log(`  ${prefixe.padEnd(7)} ${liste.join(' ')}`);
  }
}

if (inconnues.length) {
  console.log(`\n${inconnues.length} fichier(s) dont le nom ne correspond à aucune carte :`);
  inconnues.forEach((f) => console.log(`  - ${f}`));
  console.log('  (vérifie l\'orthographe : couleur-valeur, par ex. rouge-plus2.png)');
}

if (!manquantes.length && !inconnues.length) {
  console.log('\nTout y est — le jeu utilisera tes images partout.');
}
