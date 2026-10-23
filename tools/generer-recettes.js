// ---------------------------------------------------------------------------
// Fabrique games/devine-le-craft/recettes.json.
//
// Pourquoi un generateur plutot qu'une liste ecrite a la main : les grilles de
// craft sont faciles a se rappeler de travers (combien de batons pour un arc ?
// la torche, c'est le charbon au-dessus ou en dessous ?). Ici, les grilles
// sortent de `minecraft-data`, donc du jeu lui-meme. On ne fournit a la main
// que deux choses : la liste des crafts qu'on juge interessants, et leurs noms
// francais.
//
//   npm install --no-save minecraft-data
//   node tools/generer-recettes.js
//
// Le JSON produit est commite : le serveur n'a aucune dependance a Minecraft,
// et le jeu tourne meme si ce script n'est jamais relance.
// ---------------------------------------------------------------------------
import { writeFileSync } from 'fs';
import mcDataLoader from 'minecraft-data';

const VERSION = '1.20.4';
const SORTIE = 'games/devine-le-craft/recettes.json';

// ---------------------------------------------------------------------------
// Les crafts retenus, par niveau.
//
// On evite deux pieges : les conversions sans interet (un bloc de fer = neuf
// lingots) et les variantes en serie (clotures en chene, en epicea, en
// bouleau...) qui donneraient dix fois la meme question. Une seule essence de
// bois est gardee a chaque fois.
// ---------------------------------------------------------------------------
const CURATION = {
  1: [
    'crafting_table', 'stick', 'torch', 'chest', 'furnace', 'ladder',
    'bowl', 'bucket', 'oak_door', 'oak_boat', 'oak_sign', 'bread',
    'stone_sword', 'stone_pickaxe', 'stone_axe', 'stone_shovel',
    'glass_bottle', 'flower_pot', 'paper', 'book', 'bookshelf',
    'iron_helmet', 'iron_chestplate', 'iron_boots', 'glass_pane',
  ],
  2: [
    'bow', 'arrow', 'shield', 'shears', 'flint_and_steel', 'fishing_rod',
    'cake', 'cookie', 'pumpkin_pie', 'golden_apple', 'golden_carrot',
    'tnt', 'clock', 'compass', 'map', 'painting', 'item_frame',
    'jukebox', 'note_block', 'piston', 'sticky_piston', 'dispenser',
    'hopper', 'rail', 'powered_rail', 'detector_rail', 'minecart',
    'iron_bars', 'lantern', 'campfire', 'barrel', 'smoker',
    'blast_furnace', 'anvil', 'cauldron', 'brewing_stand',
    'enchanting_table', 'ender_chest', 'armor_stand', 'lead',
    'redstone_torch', 'repeater', 'comparator', 'lever', 'tripwire_hook',
    'daylight_detector', 'observer', 'target', 'scaffolding', 'chain',
  ],
  3: [
    'beacon', 'conduit', 'end_crystal', 'respawn_anchor', 'spyglass',
    'lightning_rod', 'crossbow', 'loom', 'lectern', 'grindstone',
    'stonecutter', 'cartography_table', 'smithing_table', 'composter',
    'beehive', 'trapped_chest', 'shulker_box', 'ender_eye',
    'fire_charge', 'blaze_powder', 'magma_cream', 'fermented_spider_eye',
    'writable_book', 'candle', 'soul_torch', 'hay_block', 'jack_o_lantern',
  ],
};

// ---------------------------------------------------------------------------
// Noms francais. Cle = identifiant Minecraft, valeur = nom tel qu'il s'affiche
// dans le jeu en francais. Sert aussi bien aux resultats qu'aux ingredients.
// ---------------------------------------------------------------------------
const FR = {
  // Bois et bases
  oak_planks: 'Planches de chêne', oak_log: 'Bûche de chêne', stick: 'Bâton',
  crafting_table: 'Établi', chest: 'Coffre', furnace: 'Four', ladder: 'Échelle',
  bowl: 'Bol', bucket: 'Seau', oak_door: 'Porte en chêne', oak_boat: 'Bateau en chêne',
  oak_sign: 'Pancarte en chêne', oak_slab: 'Dalle de chêne',
  cobblestone: 'Pierre', stone: 'Pierre taillée', smooth_stone: 'Pierre lisse',
  // Minerais et lingots
  coal: 'Charbon', charcoal: 'Charbon de bois', iron_ingot: 'Lingot de fer',
  gold_ingot: 'Lingot d\'or', diamond: 'Diamant', emerald: 'Émeraude',
  redstone: 'Poudre de redstone', quartz: 'Quartz du Nether', copper_ingot: 'Lingot de cuivre',
  netherite_ingot: 'Lingot de netherite', amethyst_shard: 'Éclat d\'améthyste',
  // Outils, armes, armures
  stone_sword: 'Épée en pierre', stone_pickaxe: 'Pioche en pierre',
  stone_axe: 'Hache en pierre', stone_shovel: 'Pelle en pierre',
  iron_helmet: 'Casque en fer', iron_chestplate: 'Plastron en fer',
  iron_boots: 'Bottes en fer', bow: 'Arc', arrow: 'Flèche', shield: 'Bouclier',
  shears: 'Cisailles', flint_and_steel: 'Briquet', fishing_rod: 'Canne à pêche',
  crossbow: 'Arbalète', flint: 'Silex', feather: 'Plume', string: 'Ficelle',
  // Nourriture
  wheat: 'Blé', bread: 'Pain', cake: 'Gâteau', cookie: 'Cookie',
  pumpkin_pie: 'Tarte à la citrouille', golden_apple: 'Pomme dorée',
  golden_carrot: 'Carotte dorée', apple: 'Pomme', carrot: 'Carotte',
  egg: 'Œuf', sugar: 'Sucre', milk_bucket: 'Seau de lait', pumpkin: 'Citrouille',
  cocoa_beans: 'Fèves de cacao', gold_nugget: 'Pépite d\'or', hay_block: 'Botte de foin',
  // Redstone et mécanismes
  tnt: 'TNT', sand: 'Sable', gunpowder: 'Poudre à canon',
  clock: 'Horloge', compass: 'Boussole', map: 'Carte vierge',
  piston: 'Piston', sticky_piston: 'Piston collant', slime_ball: 'Boule de slime',
  dispenser: 'Distributeur', hopper: 'Entonnoir', rail: 'Rail',
  powered_rail: 'Rail propulseur', detector_rail: 'Rail détecteur',
  minecart: 'Wagonnet', redstone_torch: 'Torche de redstone',
  repeater: 'Répéteur de redstone', comparator: 'Comparateur de redstone',
  lever: 'Levier', tripwire_hook: 'Crochet', daylight_detector: 'Capteur de lumière du jour',
  observer: 'Observateur', target: 'Cible', note_block: 'Bloc musical',
  jukebox: 'Juke-box', trapped_chest: 'Coffre piégé', torch: 'Torche',
  // Décoration et rangement
  painting: 'Tableau', item_frame: 'Cadre', glass: 'Verre', glass_pane: 'Vitre',
  iron_bars: 'Barreaux de fer', lantern: 'Lanterne', campfire: 'Feu de camp',
  barrel: 'Tonneau', smoker: 'Fumoir', blast_furnace: 'Haut fourneau',
  anvil: 'Enclume', cauldron: 'Chaudron', brewing_stand: 'Alambic',
  enchanting_table: 'Table d\'enchantement', ender_chest: 'Coffre de l\'Ender',
  armor_stand: 'Porte-armure', lead: 'Laisse', scaffolding: 'Échafaudage',
  chain: 'Chaîne', flower_pot: 'Pot de fleurs', glass_bottle: 'Fiole en verre',
  paper: 'Papier', book: 'Livre', bookshelf: 'Bibliothèque',
  loom: 'Métier à tisser', lectern: 'Pupitre', grindstone: 'Meule',
  stonecutter: 'Tailleur de pierre', cartography_table: 'Table de cartographie',
  smithing_table: 'Table de forge', composter: 'Composteur', beehive: 'Ruche',
  shulker_box: 'Boîte de Shulker', candle: 'Bougie', soul_torch: 'Torche des âmes',
  jack_o_lantern: 'Citrouille-lanterne', writable_book: 'Livre et plume',
  // Fin de jeu
  beacon: 'Balise', conduit: 'Conduit', end_crystal: 'Cristal de l\'Ender',
  respawn_anchor: 'Ancre de réapparition', spyglass: 'Longue-vue',
  lightning_rod: 'Paratonnerre', ender_eye: 'Œil de l\'Ender',
  fire_charge: 'Boule de feu', blaze_powder: 'Poudre de Blaze',
  magma_cream: 'Crème de magma', fermented_spider_eye: 'Œil d\'araignée fermenté',
  ender_pearl: 'Perle de l\'Ender', blaze_rod: 'Bâton de Blaze',
  spider_eye: 'Œil d\'araignée', brown_mushroom: 'Champignon brun',
  nether_star: 'Étoile du Nether', obsidian: 'Obsidienne', glowstone: 'Pierre lumineuse',
  ghast_tear: 'Larme de Ghast', nautilus_shell: 'Coquille de nautile',
  heart_of_the_sea: 'Cœur de la mer', crying_obsidian: 'Obsidienne pleureuse',
  shulker_shell: 'Carapace de Shulker', leather: 'Cuir', honeycomb: 'Rayon de miel',
  soul_sand: 'Sable des âmes', soul_soil: 'Terre des âmes',
  tripwire: 'Fil de détection', wheat_seeds: 'Graines de blé',
  bamboo: 'Bambou', white_wool: 'Laine blanche', vine: 'Liane', ink_sac: 'Poche d\'encre',
  brick: 'Brique', carved_pumpkin: 'Citrouille sculptée',
  dark_oak_log: 'Bûche de chêne noir', iron_block: 'Bloc de fer',
  iron_nugget: 'Pépite de fer', smooth_stone_slab: 'Dalle de pierre lisse',
  stone_pressure_plate: 'Plaque de pression en pierre', stone_slab: 'Dalle de pierre',
  sugar_cane: 'Canne à sucre',
  dried_kelp: 'Varech séché', slime_block: 'Bloc de slime',
};

// Reponses supplementaires acceptees, en plus du nom francais et du nom
// anglais : les mots que le groupe emploie vraiment.
const ALIAS = {
  crafting_table: ['table de craft', 'table de craftage', 'craft'],
  furnace: ['fourneau'],
  oak_boat: ['bateau', 'barque'],
  oak_door: ['porte'],
  oak_sign: ['pancarte', 'panneau'],
  jukebox: ['jukebox', 'juke box'],
  note_block: ['bloc de note', 'bloc note'],
  minecart: ['wagon', 'chariot'],
  repeater: ['repeteur', 'repeater'],
  comparator: ['comparateur'],
  glass_pane: ['panneau de verre', 'vitres'],
  ender_chest: ['coffre ender', 'coffre de l ender'],
  end_crystal: ['cristal de l end', 'cristal ender'],
  ender_eye: ['oeil de l ender', 'oeil ender', 'eye of ender'],
  respawn_anchor: ['ancre de respawn', 'ancre'],
  writable_book: ['livre et plume', 'livre vierge'],
  golden_apple: ['pomme d or'],
  golden_carrot: ['carotte d or'],
  hay_block: ['bloc de foin', 'botte de foin'],
  jack_o_lantern: ['citrouille lanterne', 'lanterne citrouille'],
  soul_torch: ['torche d ame', 'torche des ames'],
  blast_furnace: ['haut fourneau', 'fourneau'],
  armor_stand: ['porte armure', 'support armure'],
  tripwire_hook: ['crochet de fil', 'crochet'],
  daylight_detector: ['capteur de jour', 'detecteur de lumiere'],
  shulker_box: ['boite de shulker', 'shulker'],
  cartography_table: ['table de carto'],
  smithing_table: ['table de forgeron'],
  stonecutter: ['tailleuse de pierre', 'scie'],
  spyglass: ['lunette', 'telescope'],
  fire_charge: ['charge de feu', 'boule de feu'],
};

// ---------------------------------------------------------------------------
const mcd = mcDataLoader(VERSION);
const parNom = {};
for (const it of Object.values(mcd.items)) parNom[it.name] = it;
const nomDe = (id) => mcd.items[id]?.name;

const manquants = [];
const sansTraduction = new Set();

function traduire(mcName) {
  if (!mcName) return null;
  if (FR[mcName]) return FR[mcName];
  sansTraduction.add(mcName);
  // Repli lisible plutot qu'un plantage : « oak_planks » -> « Oak planks »
  const brut = mcName.replace(/_/g, ' ');
  return brut.charAt(0).toUpperCase() + brut.slice(1);
}

// Une case de grille : null, un identifiant, ou { id, metadata }
const idDeCase = (c) => (c === null || c === undefined || c === -1
  ? null
  : (typeof c === 'object' ? c.id : c));

function grilleDe(recette) {
  if (!recette.inShape) return null;
  const lignes = recette.inShape.map((ligne) => ligne.map(idDeCase));
  const largeur = Math.max(...lignes.map((l) => l.length));
  // On normalise en 3x3 : le client affiche toujours une grille complete.
  const carre = [];
  for (let y = 0; y < 3; y++) {
    const ligne = [];
    for (let x = 0; x < 3; x++) ligne.push(lignes[y]?.[x] ?? null);
    carre.push(ligne);
  }
  return { carre, hauteur: lignes.length, largeur };
}

const recettes = [];

for (const [niveau, noms] of Object.entries(CURATION)) {
  for (const nom of noms) {
    const item = parNom[nom];
    if (!item) { manquants.push(`${nom} : item inconnu`); continue; }
    const liste = mcd.recipes[item.id];
    if (!liste?.length) { manquants.push(`${nom} : aucune recette`); continue; }

    // Deux formes existent dans Minecraft : avec grille (la position compte)
    // et « en vrac » (le livre, le briquet...). On garde les deux, le client
    // les presente differemment.
    const recette = liste.find((r) => r.inShape) || liste.find((r) => r.ingredients);
    if (!recette) { manquants.push(`${nom} : ni grille ni ingrédients`); continue; }

    const g = recette.inShape ? grilleDe(recette) : null;
    const idsVrac = recette.inShape
      ? []
      : (recette.ingredients || []).map(idDeCase).filter(Boolean);
    const idsUtilises = g
      ? [...new Set(g.carre.flat().filter(Boolean))]
      : [...new Set(idsVrac)];

    // Legende : une lettre par ingredient distinct, dans l'ordre d'apparition.
    const lettres = 'ABCDEFGHI';
    const legende = {};
    const parId = {};
    idsUtilises.forEach((id, i) => {
      const lettre = lettres[i];
      parId[id] = lettre;
      legende[lettre] = traduire(nomDe(id));
    });

    const nomFr = traduire(nom);
    // En vrac : on compte les exemplaires de chaque ingredient.
    const vrac = [];
    if (!g) {
      for (const id of idsUtilises) {
        vrac.push({ nom: traduire(nomDe(id)), nombre: idsVrac.filter((x) => x === id).length });
      }
    }

    recettes.push({
      id: nom,
      niveau: Number(niveau),
      resultat: nomFr,
      quantite: recette.result?.count ?? 1,
      // Avec grille : trois chaines de trois caracteres, une lettre ou un
      // point pour une case vide. En vrac : grille nulle et liste d'ingredients.
      grille: g ? g.carre.map((l) => l.map((id) => (id ? parId[id] : '.')).join('')) : null,
      legende: g ? legende : null,
      vrac: g ? null : vrac,
      // Reponses acceptees, normalisees plus tard par le serveur.
      alias: [...new Set([
        nomFr,
        nom.replace(/_/g, ' '),
        ...(ALIAS[nom] || []),
      ])],
    });
  }
}

recettes.sort((a, b) => a.niveau - b.niveau || a.resultat.localeCompare(b.resultat, 'fr'));

const sortie = {
  _source: `minecraft-data ${VERSION} — régénérer avec : node tools/generer-recettes.js`,
  version: VERSION,
  recettes,
};
writeFileSync(SORTIE, `${JSON.stringify(sortie, null, 2)}\n`);

console.log(`${recettes.length} recettes écrites dans ${SORTIE}`);
for (const n of [1, 2, 3]) {
  console.log(`  niveau ${n} : ${recettes.filter((r) => r.niveau === n).length}`);
}
if (manquants.length) {
  console.log(`\n${manquants.length} craft(s) écarté(s) :`);
  manquants.forEach((m) => console.log('  - ' + m));
}
if (sansTraduction.size) {
  console.log(`\n${sansTraduction.size} nom(s) sans traduction française :`);
  console.log('  ' + [...sansTraduction].sort().join(', '));
  console.log('  (ajoute-les dans la table FR de ce script)');
}
