// ---------------------------------------------------------------------------
// Ce qui compte comme « j'ai trouve ».
//
// Deezer ne rend pas des titres de blind test, il rend des titres de
// catalogue : « Blinding Lights (Remastered 2021) », « SICKO MODE (feat.
// Drake) », « Starboy - Radio Edit ». Un joueur tape « blinding lights ». Il a
// trouve, et le jeu doit le dire.
//
// D'ou une liste de variantes acceptables par morceau, construite une fois a
// la selection. La comparaison elle-meme (accents, articles, fautes de frappe)
// vient de _shared/reponses.js, deja eprouvee par « Devine le craft ».
//
// Deux choses sont verifiees separement, le titre et l'artiste, parce qu'on
// marque des points pour chacune. Et une seule frappe peut valider les deux :
// « blinding lights the weeknd » compte double, parce que c'est comme ca qu'on
// crie une reponse dans un vrai blind test.
//
// RIEN D'ICI NE PART AU CLIENT : les variantes sont des reponses. Seul le
// serveur les lit, et il n'en renvoie que le verdict.
// ---------------------------------------------------------------------------
import { normaliser, correspond } from '../_shared/reponses.js';

// « (feat. X) », « [Bonus Track] » : une mention entre parentheses n'est
// jamais le titre que le joueur a en tete.
const PARENTHESES = /[([{][^)\]}]*[)\]}]/g;

// « Starboy - Radio Edit », « Thriller – 2015 Remaster » : meme chose, mais
// Deezer l'ecrit parfois apres un tiret plutot qu'entre parentheses.
const SUFFIXE_TIRET = /\s[-–—]\s.*$/;

// « Jay-Z & Alicia Keys », « Calvin Harris feat. Rihanna » : le premier nom
// suffit. On coupe au premier separateur de co-artistes.
const CO_ARTISTES = /\s(?:&|x|feat\.?|ft\.?|avec|with|and|et|vs\.?)\s.*$/i;

// Ajoute un texte et ses declinaisons utiles au jeu de variantes.
function ajouter(jeu, texte) {
  const brut = String(texte ?? '').trim();
  if (!brut) return;
  jeu.add(brut);
  // « Don't Stop » tape « dont stop » : sans ca, l'apostrophe devient un
  // espace et les deux formes ne se ressemblent plus tout a fait.
  if (/['’]/.test(brut)) jeu.add(brut.replace(/['’]/g, ''));
}

// Le titre, puis ce qu'il reste quand on enleve les mentions de catalogue.
// On garde toujours la forme complete : un joueur peut tres bien la taper.
function variantesTitre(titre, titreCourt) {
  const jeu = new Set();
  for (const base of [titre, titreCourt]) {
    const b = String(base ?? '').trim();
    if (!b) continue;
    ajouter(jeu, b);
    ajouter(jeu, b.replace(PARENTHESES, ' ').replace(/\s+/g, ' ').trim());
    ajouter(jeu, b.replace(SUFFIXE_TIRET, '').trim());
    ajouter(jeu, b.replace(PARENTHESES, ' ').replace(SUFFIXE_TIRET, '').replace(/\s+/g, ' ').trim());
  }
  return [...jeu].filter(Boolean);
}

function variantesArtiste(artiste) {
  const jeu = new Set();
  const a = String(artiste ?? '').trim();
  if (!a) return [];
  ajouter(jeu, a);
  ajouter(jeu, a.replace(PARENTHESES, ' ').replace(/\s+/g, ' ').trim());
  ajouter(jeu, a.replace(CO_ARTISTES, '').trim());
  return [...jeu].filter(Boolean);
}

// Construit la cible une fois pour toutes, a la selection du morceau.
export function cible(track) {
  return {
    titre: variantesTitre(track.title, track.titleShort),
    artiste: variantesArtiste(track.artist),
  };
}

// Longueur minimale pour qu'une variante soit cherchee DANS une phrase plus
// longue. « sia » ou « yes » se retrouvent par hasard dans n'importe quoi ;
// « weeknd » ou « blinding lights » non.
const MIN_INCLUSION = 5;

// La variante apparait-elle telle quelle dans l'essai, sur des frontieres de
// mot ? C'est ce qui permet de valider titre ET artiste d'un seul jet. Pas de
// tolerance aux fautes ici : chercher un mot approchant dans une phrase
// produirait des faux positifs a repetition.
function inclus(essaiNorm, variantes) {
  const entoure = ` ${essaiNorm} `;
  for (const v of variantes) {
    const n = normaliser(v);
    if (n.length < MIN_INCLUSION) continue;
    if (entoure.includes(` ${n} `)) return true;
  }
  return false;
}

// Plancher pour RETIRER une variante deja reconnue. Plus bas que
// MIN_INCLUSION, et c'est voulu : on ne cherche plus un mot au hasard dans une
// phrase, on enleve quelque chose dont on sait deja que le joueur l'a trouve.
const MIN_RETRAIT = 3;

// Retire de l'essai la plus longue variante qui s'y trouve, et rend ce qu'il
// reste. La plus longue d'abord : sur « the weeknd », retirer « weeknd »
// laisserait « the », alors que retirer « the weeknd » ne laisse rien.
function retirer(essaiNorm, variantes) {
  let trouvee = null;
  for (const v of variantes) {
    const n = normaliser(v);
    if (n.length < MIN_RETRAIT) continue;
    if (!` ${essaiNorm} `.includes(` ${n} `)) continue;
    if (!trouvee || n.length > trouvee.length) trouvee = n;
  }
  if (!trouvee) return '';
  return ` ${essaiNorm} `.replace(` ${trouvee} `, ' ').trim().replace(/\s+/g, ' ');
}

// Verdict d'un essai : { titre, artiste }, chacun vrai ou faux.
//
// Deux passes par cible. La premiere compare l'essai entier a la variante, avec
// la tolerance aux fautes de frappe : c'est le cas du joueur qui ne tape que le
// titre. La seconde cherche la variante a l'interieur de l'essai : c'est le cas
// du joueur qui tape tout d'un coup.
export function evaluer(essai, cible) {
  const texte = String(essai ?? '').trim();
  if (!texte || !cible) return { titre: false, artiste: false };
  const norm = normaliser(texte);
  if (!norm) return { titre: false, artiste: false };

  const teste = (variantes) => (variantes?.length
    ? correspond(texte, variantes) || inclus(norm, variantes)
    : false);

  let titre = teste(cible.titre);
  let artiste = teste(cible.artiste);

  // Un cote reconnu, l'autre pas : on pele. On enleve de l'essai ce qui est
  // deja identifie, et on compare le reste — cette fois en entier, donc avec
  // la tolerance aux fautes de frappe.
  //
  // C'est ce qui sauve les titres et les noms courts. « numb linkin park » :
  // « numb » fait quatre lettres, trop peu pour etre cherche a l'aveugle dans
  // une phrase sans attraper n'importe quoi. Mais une fois « linkin park »
  // retire, il ne reste que « numb », et la comparaison est sans ambiguite.
  if (artiste && !titre && cible.titre?.length) {
    const reste = retirer(norm, cible.artiste);
    if (reste) titre = correspond(reste, cible.titre);
  } else if (titre && !artiste && cible.artiste?.length) {
    const reste = retirer(norm, cible.titre);
    if (reste) artiste = correspond(reste, cible.artiste);
  }

  return { titre, artiste };
}
