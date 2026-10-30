// ---------------------------------------------------------------------------
// « Devine la musique » — le blind test ou l'on devine le morceau.
//
// A ne pas confondre avec « Qui a mis ça ? » : la-bas on devine QUI a choisi le
// morceau, et la pochette s'affiche. Ici on devine LE MORCEAU, donc la pochette
// et le titre restent caches jusqu'a la revelation — les afficher donnerait la
// reponse avant la premiere note.
//
// Deux modes :
//   aleatoire   les morceaux viennent des tops Deezer. Se joue meme a un.
//   selection   chacun depose 5 a 10 morceaux. Quand le morceau d'un joueur
//               passe, ce joueur ne peut pas repondre — il connait la reponse.
//
// Quatre phases :
//   REGLAGES    l'hote choisit le mode, le nombre de manches, le genre
//   SELECTION   (mode selection) chacun depose ses morceaux, en secret
//   MANCHE      l'extrait tourne, on tape titre et artiste
//   REVELATION  le morceau, qui a trouve quoi, les points
// ---------------------------------------------------------------------------
import { num } from '../../core/env.js';
import {
  routes as deezerRoutes, resolvePreview, chartTracks, listGenres,
  ARTWORK_HOST, cooldownRestant,
} from '../_shared/deezer.js';
import { cible, evaluer } from './titres.js';

export const meta = {
  id: 'devine-la-musique',
  name: 'Devine la musique',
  tagline: 'L\'extrait tourne : titre et artiste, le plus vite possible.',
  icon: '🎧',
  rules: [
    'Un extrait de 30 secondes passe, sans pochette ni titre.',
    'Tape le titre, l\'artiste, ou les deux d\'un coup — autant d\'essais que tu veux.',
    'Le titre vaut 100 points, l\'artiste 60, et les premiers à trouver les deux prennent un bonus.',
    'Mode aléatoire : les morceaux viennent des tops. Mode sélection : chacun dépose 5 à 10 morceaux.',
    'En mode sélection, tu ne réponds pas sur tes propres morceaux.',
  ],
  minPlayers: 1,        // le mode aleatoire se joue tres bien seul
  maxPlayers: 12,
  allowLateJoin: false,
};

const CONFIG = {
  manchesDefaut: num(process.env.DLM_MANCHES, 12),
  manchesMin: num(process.env.DLM_MANCHES_MIN, 3),
  manchesMax: num(process.env.DLM_MANCHES_MAX, 30),
  minMorceaux: num(process.env.DLM_MIN, 5),
  maxMorceaux: num(process.env.DLM_MAX, 10),
  leadMs: num(process.env.DLM_LEAD_MS, 3000),      // prechargement avant le top
  mancheMs: num(process.env.DLM_MANCHE_MS, 32000), // un extrait Deezer fait 30 s
  revealMs: num(process.env.DLM_REVEAL_MS, 0),     // 0 = l'hote enchaine
  pointsTitre: num(process.env.DLM_POINTS_TITRE, 100),
  pointsArtiste: num(process.env.DLM_POINTS_ARTISTE, 60),
  // Bonus aux premiers qui trouvent titre ET artiste.
  bonus: [50, 30, 10],
  maxEssais: num(process.env.DLM_MAX_ESSAIS, 15),
};

const MODES = ['aleatoire', 'selection'];
const propre = (s) => String(s ?? '').slice(0, 200);

export function routes(app) {
  deezerRoutes(app, meta.id);

  // Les genres servent a garnir le menu du mode aleatoire. Si Deezer ne repond
  // pas, le client se rabat sur « tous genres » : le jeu reste jouable.
  app.get(`/api/${meta.id}/genres`, async (req, res) => {
    const reste = cooldownRestant();
    if (reste > 0) return res.status(429).json({ error: 'rate', retryIn: reste });
    try {
      res.json(await listGenres());
    } catch (err) {
      console.error('[genres]', err.status || '-', err.message);
      res.status(502).json({ error: 'down' });
    }
  });
}

// Le client renvoie l'objet piste : on ne le croit pas sur parole. L'URL audio
// n'arrive jamais de la — le serveur la resigne a partir du seul identifiant.
function verifier(track) {
  if (!track || typeof track !== 'object') return null;
  if (!/^\d+$/.test(String(track.trackKey ?? ''))) return null;
  if (track.artwork && !ARTWORK_HOST.test(track.artwork)) return null;
  return {
    trackKey: propre(track.trackKey),
    title: propre(track.title),
    titleShort: propre(track.titleShort),
    artist: propre(track.artist),
    artwork: propre(track.artwork),
  };
}

// ---------------------------------------------------------------------------
// Tirage du mode selection
//
// Deux exigences : que les morceaux de chacun passent (pas seulement ceux du
// plus bavard), et qu'un meme morceau ne passe pas deux fois — le deviner une
// seconde fois n'a aucun interet.
//
// Donc : on fusionne les doublons en gardant TOUS leurs proprietaires (ils
// seront tous prives de reponse), on repartit a tour de role entre joueurs,
// puis on melange l'ordre de passage.
// ---------------------------------------------------------------------------
function tirerSelection(parJoueur, combien, melanger, idsPresents) {
  const uniques = new Map();
  for (const [id, liste] of Object.entries(parJoueur)) {
    for (const t of liste) {
      const vu = uniques.get(t.trackKey);
      if (vu) {
        if (!vu.ownerIds.includes(id)) vu.ownerIds.push(id);
      } else {
        uniques.set(t.trackKey, { track: t, ownerIds: [id], premier: id });
      }
    }
  }

  // Un morceau que tout le monde a choisi ne laisserait personne pour
  // repondre : on l'ecarte du tirage plutot que de jouer une manche vide.
  const jouables = [...uniques.values()].filter(
    (e) => idsPresents.some((id) => !e.ownerIds.includes(id))
  );

  // Une file par proprietaire d'origine, melangee, puis service a tour de role.
  const files = new Map();
  for (const e of jouables) {
    if (!files.has(e.premier)) files.set(e.premier, []);
    files.get(e.premier).push(e);
  }
  const tours = melanger([...files.keys()]);
  for (const id of tours) files.set(id, melanger(files.get(id)));

  const choisis = [];
  let tour = 0;
  while (choisis.length < combien) {
    const restantes = tours.filter((id) => files.get(id).length);
    if (!restantes.length) break;
    const id = restantes[tour % restantes.length];
    choisis.push(files.get(id).shift());
    tour += 1;
  }
  return melanger(choisis);
}

export function create(ctx) {
  let phase = 'REGLAGES';
  let mode = 'aleatoire';
  let genreId = '0';
  let nbManches = CONFIG.manchesDefaut;
  let chargement = false;     // l'hote a lance, on attend Deezer
  let erreur = '';            // ce qui a empeche de demarrer, pour l'hote

  let parJoueur = {};         // playerId -> [piste] (mode selection)
  let manches = [];           // [{ track, ownerIds, cible, previewUrl }]
  let index = -1;
  let trouve = {};            // playerId -> { titre, artiste, msTitre, msArtiste, rang }
  let essais = {};            // playerId -> [{ texte, titre, artiste, abandon }]
  let startAt = 0;
  let endsAt = 0;
  let revelation = null;

  const courante = () => manches[index] || null;
  const presents = () => ctx.players().filter((p) => p.connected);
  const idsPresents = () => presents().map((p) => p.id);
  const mesMorceaux = (id) => parJoueur[id] || [];

  // En mode aleatoire personne n'a choisi : tout le monde repond.
  function peutRepondre(playerId) {
    const m = courante();
    if (!m) return false;
    return !m.ownerIds.includes(playerId);
  }

  // -------------------------------------------------------------------------
  // Manches
  // -------------------------------------------------------------------------
  async function demarrerManche() {
    ctx.clearTimer();
    trouve = {};
    essais = {};
    revelation = null;
    phase = 'MANCHE';

    const m = courante();
    // L'URL signee expire en ~15 min : on la resigne juste avant de la
    // diffuser, sinon les dernieres manches d'une longue partie seraient
    // muettes. Si Deezer refuse, la manche se joue sans son plutot que de
    // bloquer la partie.
    m.previewUrl = null;
    try {
      m.previewUrl = await resolvePreview(m.track.trackKey);
    } catch (err) {
      console.error('[extrait]', m.track.trackKey, err.message);
    }

    startAt = ctx.now() + CONFIG.leadMs;
    endsAt = startAt + CONFIG.mancheMs;
    ctx.update();
    ctx.setTimer(CONFIG.leadMs + CONFIG.mancheMs, finirManche);
  }

  function finirManche() {
    ctx.clearTimer();
    const m = courante();
    if (!m || phase === 'REVELATION') return;

    // Les points ne sont comptes qu'ici : pendant la manche, le tableau ne dit
    // que « untel a trouve le titre », jamais combien ca lui rapporte.
    const detail = [];
    for (const p of ctx.players()) {
      const t = trouve[p.id];
      if (!t) continue;
      let points = (t.titre ? CONFIG.pointsTitre : 0)
        + (t.artiste ? CONFIG.pointsArtiste : 0);
      const bonus = t.rang ? (CONFIG.bonus[t.rang - 1] || 0) : 0;
      points += bonus;
      if (points) ctx.award(p.id, points);
      detail.push({
        pseudo: p.pseudo,
        titre: !!t.titre,
        artiste: !!t.artiste,
        rang: t.rang || null,
        bonus,
        points,
        secondes: t.msComplet != null ? Math.round(t.msComplet / 100) / 10 : null,
      });
    }
    detail.sort((a, b) => b.points - a.points);

    revelation = {
      index: index + 1,
      total: manches.length,
      // C'est ici, et seulement ici, que le titre et la pochette sortent.
      title: m.track.title,
      artist: m.track.artist,
      artwork: m.track.artwork,
      proprietaires: m.ownerIds.map((id) => ctx.pseudo(id)).filter(Boolean),
      detail,
      // Ceux qui n'ont rien trouve, et qui pouvaient repondre.
      bredouilles: presents()
        .filter((p) => peutRepondre(p.id) && !trouve[p.id])
        .map((p) => ctx.pseudo(p.id)),
      scores: ctx.players()
        .map((p) => ({
          pseudo: p.pseudo,
          score: p.score,
          delta: detail.find((d) => d.pseudo === p.pseudo)?.points || 0,
        }))
        .sort((a, b) => b.score - a.score),
      isLast: index >= manches.length - 1,
    };

    phase = 'REVELATION';
    ctx.update();
    if (CONFIG.revealMs > 0) ctx.setTimer(CONFIG.revealMs, mancheSuivante);
  }

  function mancheSuivante() {
    ctx.clearTimer();
    if (index >= manches.length - 1) return ctx.finish();
    index += 1;
    demarrerManche();
  }

  const aAbandonne = (id) => (essais[id] || []).some((e) => e.abandon);
  const aTout = (id) => !!(trouve[id]?.titre && trouve[id]?.artiste);

  // Inutile de laisser tourner l'extrait si plus personne ne cherche.
  function clotureSiPlusPersonne() {
    if (phase !== 'MANCHE') return;
    const concernes = presents().filter((p) => peutRepondre(p.id));
    if (!concernes.length) return finirManche();
    if (concernes.every((p) => aTout(p.id) || aAbandonne(p.id))) finirManche();
  }

  // -------------------------------------------------------------------------
  // Demarrage, selon le mode
  // -------------------------------------------------------------------------
  async function construireAleatoire() {
    const pool = await chartTracks(genreId);
    const combien = Math.min(nbManches, pool.length);
    manches = ctx.shuffle(pool).slice(0, combien).map((track) => ({
      track,
      ownerIds: [],            // personne ne l'a choisi : tout le monde repond
      cible: cible(track),
      previewUrl: null,
    }));
  }

  function construireSelection() {
    const tirees = tirerSelection(parJoueur, nbManches, ctx.shuffle, idsPresents());
    manches = tirees.map((e) => ({
      track: e.track,
      ownerIds: e.ownerIds,
      cible: cible(e.track),
      previewUrl: null,
    }));
  }

  async function lancerPartie() {
    chargement = true;
    erreur = '';
    ctx.update();
    try {
      if (mode === 'aleatoire') await construireAleatoire();
      else construireSelection();

      if (!manches.length) {
        erreur = mode === 'aleatoire'
          ? 'Aucun morceau reçu — réessaie, ou passe en mode sélection.'
          : 'Aucun morceau jouable — il faut des morceaux différents entre joueurs.';
        chargement = false;
        phase = 'REGLAGES';
        return ctx.update();
      }

      chargement = false;
      index = 0;
      await demarrerManche();
    } catch (err) {
      console.error('[devine-la-musique]', err.message);
      const reste = cooldownRestant();
      erreur = reste > 0
        ? `Deezer nous a mis en pause — réessaie dans ${reste} s.`
        : 'Deezer n\'a pas répondu. Réessaie, ou passe en mode sélection.';
      chargement = false;
      phase = 'REGLAGES';
      ctx.update();
    }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const actions = {
    // --- REGLAGES ---------------------------------------------------------
    reglages(playerId, { mode: m, manches: n, genre } = {}) {
      if (phase !== 'REGLAGES' || chargement) return;
      if (!ctx.isHost(playerId)) return;

      if (MODES.includes(m)) mode = m;
      if (n != null) {
        const v = Math.round(Number(n));
        if (Number.isFinite(v)) {
          nbManches = Math.min(CONFIG.manchesMax, Math.max(CONFIG.manchesMin, v));
        }
      }
      if (genre != null && /^\d+$/.test(String(genre))) genreId = String(genre);
      erreur = '';
      ctx.update();
    },

    valider(playerId) {
      if (phase !== 'REGLAGES' || chargement) return;
      if (!ctx.isHost(playerId)) return;

      if (mode === 'selection') {
        if (presents().length < 2) {
          erreur = 'Le mode sélection demande au moins deux joueurs.';
          return ctx.update();
        }
        parJoueur = {};
        phase = 'SELECTION';
        for (const p of ctx.players()) ctx.setReady(p.id, false);
        return ctx.update();
      }
      lancerPartie();
    },

    // --- SELECTION --------------------------------------------------------
    submit(playerId, track) {
      if (phase !== 'SELECTION') return;
      if (ctx.ready(playerId)) return;        // deja pret : liste verrouillee

      const liste = (parJoueur[playerId] ||= []);
      if (liste.length >= CONFIG.maxMorceaux) {
        return ctx.fail(playerId, `${CONFIG.maxMorceaux} morceaux au maximum`);
      }
      const t = verifier(track);
      if (!t) return ctx.fail(playerId, 'Morceau invalide');
      if (liste.some((x) => x.trackKey === t.trackKey)) {
        return ctx.fail(playerId, 'Tu as déjà choisi ce morceau');
      }
      liste.push(t);
      ctx.update();
    },

    // La plateforme route `player:ready` ici : c'est au jeu de dire si on a le
    // droit de se declarer pret, et on ne l'a pas sous le minimum de morceaux.
    ready(playerId, { ready } = {}) {
      if (phase !== 'SELECTION') return;
      if (ready && mesMorceaux(playerId).length < CONFIG.minMorceaux) {
        return ctx.fail(playerId, `Il faut au moins ${CONFIG.minMorceaux} morceaux`);
      }
      ctx.setReady(playerId, !!ready);
      ctx.update();
    },

    remove(playerId, { id } = {}) {
      if (phase !== 'SELECTION' || ctx.ready(playerId)) return;
      const liste = parJoueur[playerId] || [];
      const i = liste.findIndex((x) => x.trackKey === String(id));
      if (i < 0) return;
      liste.splice(i, 1);
      ctx.update();
    },

    commencer(playerId) {
      if (phase !== 'SELECTION' || chargement) return;
      if (!ctx.isHost(playerId)) return;
      if (!pretsEtGarnis()) return;
      lancerPartie();
    },

    // --- MANCHE -----------------------------------------------------------
    guess(playerId, { texte } = {}) {
      if (phase !== 'MANCHE') return;
      // Son propre morceau : il connait la reponse, il ne joue pas celle-la.
      if (!peutRepondre(playerId)) return;
      if (aTout(playerId) || aAbandonne(playerId)) return;

      const m = courante();
      if (!m) return;

      const texteOk = String(texte ?? '').trim().slice(0, 80);
      if (!texteOk) return;

      const mes = (essais[playerId] ||= []);
      if (mes.length >= CONFIG.maxEssais) {
        return ctx.fail(playerId, 'Trop d\'essais pour cette manche');
      }

      const t = (trouve[playerId] ||= { titre: false, artiste: false });
      const verdict = evaluer(texteOk, m.cible);
      // Un essai ne peut rien retirer : ce qui est trouve reste trouve.
      const neufTitre = verdict.titre && !t.titre;
      const neufArtiste = verdict.artiste && !t.artiste;
      const ecoule = Math.max(0, ctx.now() - startAt);

      if (neufTitre) { t.titre = true; t.msTitre = ecoule; }
      if (neufArtiste) { t.artiste = true; t.msArtiste = ecoule; }

      mes.push({
        texte: texteOk,
        titre: neufTitre,
        artiste: neufArtiste,
        // Deja trouve : on le dit, sinon un rappel passerait pour une erreur.
        connu: (verdict.titre && !neufTitre) || (verdict.artiste && !neufArtiste),
      });

      // Le bonus recompense le premier a avoir les deux.
      if (t.titre && t.artiste && !t.rang) {
        t.rang = Object.values(trouve).filter((x) => x.rang).length + 1;
        t.msComplet = ecoule;
      }

      ctx.update();
      clotureSiPlusPersonne();
    },

    abandonner(playerId) {
      if (phase !== 'MANCHE' || !peutRepondre(playerId)) return;
      if (aTout(playerId) || aAbandonne(playerId)) return;
      (essais[playerId] ||= []).push({ texte: '', abandon: true });
      ctx.update();
      clotureSiPlusPersonne();
    },

    skip(playerId) {
      if (!ctx.isHost(playerId)) return;
      if (phase === 'MANCHE') finirManche();
      else if (phase === 'REVELATION') mancheSuivante();
    },
  };

  // Tout le monde pret, et personne en dessous du minimum.
  function pretsEtGarnis() {
    const ici = presents();
    if (ici.length < 2) return false;
    return ici.every((p) => ctx.ready(p.id) && mesMorceaux(p.id).length >= CONFIG.minMorceaux);
  }

  // -------------------------------------------------------------------------
  // Vue
  //
  // REGLE CENTRALE : ni `title`, ni `artist`, ni `artwork`, ni `cible` ne
  // sortent d'ici avant la revelation. La pochette surtout : elle donnerait la
  // reponse avant la premiere note. La seule exception est le proprietaire du
  // morceau, qui le connait deja et ne peut pas repondre.
  // -------------------------------------------------------------------------
  function view(playerId) {
    const state = { phase };

    if (phase === 'REGLAGES') {
      state.reglages = {
        mode,
        genre: genreId,
        manches: nbManches,
        min: CONFIG.manchesMin,
        max: CONFIG.manchesMax,
        minMorceaux: CONFIG.minMorceaux,
        maxMorceaux: CONFIG.maxMorceaux,
        chargement,
        erreur,
        jeSuisHote: ctx.isHost(playerId),
        // Le mode selection n'a pas de sens a un seul joueur.
        selectionPossible: presents().length >= 2,
        joueurs: presents().length,
      };
    }

    if (phase === 'SELECTION') {
      const liste = mesMorceaux(playerId);
      state.selection = {
        minMorceaux: CONFIG.minMorceaux,
        maxMorceaux: CONFIG.maxMorceaux,
        // Seule SA liste lui revient : les choix des autres restent secrets.
        mesMorceaux: liste,
        jePret: !!ctx.ready(playerId),
        jeSuisHote: ctx.isHost(playerId),
        chargement,
        pretAPartir: pretsEtGarnis(),
        // De quoi savoir qui on attend, sans rien devoiler de leurs choix.
        tableau: presents().map((p) => ({
          pseudo: p.pseudo,
          pret: !!ctx.ready(p.id),
          combien: mesMorceaux(p.id).length,
        })),
      };
    }

    if (phase === 'MANCHE') {
      const m = courante();
      if (m) {
        const t = trouve[playerId] || {};
        const aMoi = m.ownerIds.includes(playerId);
        state.manche = {
          index: index + 1,
          total: manches.length,
          startAt,
          endsAt,
          previewUrl: m.previewUrl,
          peutRepondre: peutRepondre(playerId),
          // Le proprietaire voit son morceau : il l'a choisi, il le connait.
          // Ce n'est donc pas une fuite, et ca lui evite d'etre devant un
          // ecran vide pendant trente secondes.
          monMorceau: aMoi
            ? { title: m.track.title, artist: m.track.artist, artwork: m.track.artwork }
            : null,
          jaiTitre: !!t.titre,
          jaiArtiste: !!t.artiste,
          jaiAbandonne: aAbandonne(playerId),
          monRang: t.rang || null,
          mesEssais: (essais[playerId] || [])
            .filter((e) => !e.abandon)
            .map((e) => ({
              texte: e.texte, titre: !!e.titre, artiste: !!e.artiste, connu: !!e.connu,
            })),
          // Le tableau dit qui a trouve quoi, jamais ce qu'il a trouve. Le
          // proprietaire y apparait comme tel : sans ca, les autres ne
          // comprendraient pas pourquoi il ne joue pas.
          tableau: presents().map((p) => ({
            pseudo: p.pseudo,
            proprietaire: m.ownerIds.includes(p.id),
            titre: !!trouve[p.id]?.titre,
            artiste: !!trouve[p.id]?.artiste,
            abandon: aAbandonne(p.id),
          })),
        };
      }
    }

    if (phase === 'REVELATION') state.revelation = revelation;
    return state;
  }

  return {
    start() {
      phase = 'REGLAGES';
      mode = 'aleatoire';
      nbManches = CONFIG.manchesDefaut;
      erreur = '';
      chargement = false;
      index = -1;
      manches = [];
      parJoueur = {};
    },
    view,
    action(type, playerId, data) {
      const fn = actions[type];
      if (fn) fn(playerId, data);
    },
    onLeave() {
      // Un partant ne doit pas bloquer la manche ni la selection.
      if (phase === 'MANCHE') clotureSiPlusPersonne();
      else ctx.update();
    },
    stop() {
      ctx.clearTimer();
    },
  };
}
