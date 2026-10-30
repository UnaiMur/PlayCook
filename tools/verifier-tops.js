// ---------------------------------------------------------------------------
// Verifie que le mode « musique aleatoire » a bien une source.
//
//   node tools/verifier-tops.js
//
// Pourquoi cet outil existe : ce mode puise dans les tops Deezer, et ces
// appels n'ont jamais pu etre essayes depuis l'environnement ou le jeu a ete
// ecrit (pas de sortie reseau vers api.deezer.com). Plutot que d'affirmer que
// ca marche, on fournit de quoi le constater en une commande, depuis une
// machine qui a Internet.
//
// Le mode « les joueurs choisissent », lui, ne depend d'aucun top : il n'a
// besoin que de la recherche, deja utilisee par « Qui a mis ça ? ».
//
// Ce que l'outil contrele :
//   1. /genre              la liste des genres, qui garnit le menu
//   2. /chart/0/tracks     le top tous genres, source par defaut
//   3. /chart/<id>/tracks  un top par genre
//   4. la pagination, qui fournit de quoi tirer sans se repeter
//   5. la presence d'extraits jouables, seule chose qui compte vraiment
// ---------------------------------------------------------------------------
import { chartTracks, listGenres } from '../games/_shared/deezer.js';

const soucis = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const ko = (m) => { soucis.push(m); console.log(`  ✗ ${m}`); };

console.log('\n1. La liste des genres');
let genres = [];
try {
  genres = await listGenres();
  ok(`${genres.length} genres reçus`);
  console.log(`    ${genres.slice(0, 8).map((g) => g.name).join(', ')}…`);
} catch (err) {
  ko(`/genre ne répond pas : ${err.message}`);
  console.log('    Le menu se rabattra sur « Tous genres », ce qui reste jouable.');
}

console.log('\n2. Le top tous genres');
let top = [];
try {
  top = await chartTracks('0');
  ok(`${top.length} morceaux avec un extrait jouable`);
  for (const t of top.slice(0, 3)) console.log(`    ${t.title} — ${t.artist}`);
} catch (err) {
  ko(`/chart/0/tracks ne répond pas : ${err.message}`);
  console.log('    Sans ça, le mode aléatoire est inutilisable : seul le mode');
  console.log('    « les joueurs choisissent » fonctionnerait.');
}

console.log('\n3. La taille du vivier');
// Une partie de 12 manches a besoin de bien plus que 12 morceaux, sinon deux
// parties d'affilee rejouent les memes.
if (top.length >= 100) ok(`${top.length} morceaux : de quoi enchaîner les parties`);
else if (top.length) {
  ko(`seulement ${top.length} morceaux : la pagination ne donne qu'une page`);
  console.log('    Jouable, mais les morceaux se répéteront d\'une partie à l\'autre.');
}
if (top.length) {
  const uniques = new Set(top.map((t) => t.trackKey)).size;
  if (uniques === top.length) ok('aucun doublon dans le vivier');
  else ko(`${top.length - uniques} doublons : le même morceau pourrait passer deux fois`);

  const sansTitre = top.filter((t) => !t.title || !t.artist).length;
  if (!sansTitre) ok('tous les morceaux ont un titre et un artiste');
  else ko(`${sansTitre} morceaux sans titre ou sans artiste : ils seraient indevinables`);
}

console.log('\n4. Un top par genre');
const essai = genres.find((g) => g.id !== '0');
if (!essai) console.log('  — pas de genre à essayer (étape 1 en échec)');
else {
  try {
    const parGenre = await chartTracks(essai.id);
    ok(`${essai.name} : ${parGenre.length} morceaux`);
    for (const t of parGenre.slice(0, 3)) console.log(`    ${t.title} — ${t.artist}`);
    // Si tous les genres renvoyaient le meme top, le menu serait decoratif.
    const memes = parGenre.filter((t) => top.some((x) => x.trackKey === t.trackKey)).length;
    const part = parGenre.length ? Math.round((memes / parGenre.length) * 100) : 0;
    if (part > 90) {
      ko(`${part}% de recouvrement avec le top général : le choix du genre ne sert à rien`);
    } else {
      ok(`${part}% de recouvrement avec le top général : le genre change bien la donne`);
    }
  } catch (err) {
    ko(`/chart/${essai.id}/tracks ne répond pas : ${err.message}`);
    console.log('    Le menu des genres serait à retirer, « Tous genres » suffirait.');
  }
}

console.log(soucis.length
  ? `\n✗ ${soucis.length} point(s) à regarder — détails ci-dessus.`
  : '\n✓ Le mode aléatoire a bien une source : tops, genres et pagination répondent.');
process.exit(soucis.length ? 1 : 0);
