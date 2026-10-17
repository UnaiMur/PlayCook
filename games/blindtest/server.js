// ---------------------------------------------------------------------------
// « Qui a mis ca ? » — blind test entre amis.
//
// Phase 1 (PICKING)  : chacun choisit 3 a 5 morceaux, en secret.
// Phase 2 (PLAYING)  : les morceaux passent en aleatoire, il faut deviner qui.
// Phase 3 (REVEAL)   : on devoile, on compte, l'hote enchaine.
//
// Ce module ne connait ni les sockets, ni les salons : il recoit un contexte
// (ctx) et s'en sert pour lire les joueurs, donner des points et demander une
// rediffusion. Voir core/platform.js pour le contrat complet.
// ---------------------------------------------------------------------------
import { num, bool } from '../../core/env.js';
import { routes as deezerRoutes, resolvePreview, PREVIEW_HOST } from './deezer.js';

export const meta = {
  id: 'blindtest',
  name: 'Qui a mis ca ?',
  tagline: 'Chacun met ses morceaux, devinez qui a choisi quoi.',
  minPlayers: 2,
  maxPlayers: 12,
  allowLateJoin: false,
};

// Surchargeables au lancement : LEAD_MS=500 VOTE_MS=15000 npm start
const CONFIG = {
  minTracks: num(process.env.MIN_TRACKS, 3),
  maxTracks: num(process.env.MAX_TRACKS, 5),
  // false : chaque soumission est une entree distincte -> le morceau passe
  //         deux fois si deux joueurs l'ont choisi.
  // true  : les doublons fusionnent -> une seule lecture, plusieurs bonnes
  //         reponses acceptees.
  mergeDuplicates: bool(process.env.MERGE_DUPLICATES, false),
  leadMs: num(process.env.LEAD_MS, 3000),      // prechargement avant le top depart
  voteMs: num(process.env.VOTE_MS, 30000),     // duree du tour
  // 0 = l'hote decide quand passer au morceau suivant (defaut).
  // Une valeur > 0 enchaine automatiquement apres ce delai.
  revealMs: num(process.env.REVEAL_MS, 0),
  pointsCorrect: num(process.env.POINTS_CORRECT, 100),
  pointsPerFooled: num(process.env.POINTS_FOOLED, 50),
};

export const routes = deezerRoutes;

export function create(ctx) {
  // -------------------------------------------------------------------------
  // Etat de la partie.
  // Submission = { id, trackKey, title, artist, artwork, previewUrl, ownerIds }
  //
  // REGLE CENTRALE : ownerIds ne quitte JAMAIS le serveur avant la revelation.
  // -------------------------------------------------------------------------
  let phase = 'PICKING';
  let submissions = [];
  let playlist = [];
  let currentIndex = -1;
  let votes = {};
  let roundStartAt = null;
  let lastReveal = null;

  const current = () => playlist[currentIndex] || null;
  const mine = (playerId) => submissions.filter((s) => s.ownerIds.includes(playerId));

  const expectedVoters = (submission) =>
    ctx.players().filter((p) => p.connected && !submission.ownerIds.includes(p.id));

  // -------------------------------------------------------------------------
  // Boucle de jeu
  // -------------------------------------------------------------------------
  async function startRound() {
    ctx.clearTimer();
    votes = {};
    lastReveal = null;
    phase = 'PLAYING';

    // L'URL signee expire en ~15 min : on la resigne juste avant de la diffuser,
    // sinon les dernieres manches d'une longue partie seraient muettes.
    const track = current();
    if (track) {
      try {
        track.previewUrl = await resolvePreview(track.trackKey);
      } catch (err) {
        console.error('[extrait]', track.trackKey, err.message);
        track.previewUrl = null;   // la manche se joue quand meme, sans son
      }
    }

    roundStartAt = ctx.now() + CONFIG.leadMs;
    ctx.update();

    // Le serveur tranche de toute facon a la fin de la fenetre, meme si des
    // joueurs n'ont pas vote (onglet ferme, deconnexion...).
    ctx.setTimer(CONFIG.leadMs + CONFIG.voteMs, endRound);
  }

  function endRound() {
    ctx.clearTimer();
    const track = current();
    if (!track) return;

    const deltas = {};
    const bump = (id, n) => { deltas[id] = (deltas[id] || 0) + n; };

    const detail = [];
    for (const [voterId, suspectId] of Object.entries(votes)) {
      const correct = track.ownerIds.includes(suspectId);
      if (correct) bump(voterId, CONFIG.pointsCorrect);
      else track.ownerIds.forEach((o) => bump(o, CONFIG.pointsPerFooled));
      detail.push({
        voterId,
        voterPseudo: ctx.pseudo(voterId),
        suspectId,
        suspectPseudo: ctx.pseudo(suspectId),
        correct,
      });
    }

    for (const [id, n] of Object.entries(deltas)) ctx.award(id, n);

    lastReveal = {
      index: currentIndex + 1,
      total: playlist.length,
      title: track.title,
      artist: track.artist,
      artwork: track.artwork,
      owners: track.ownerIds.map((id) => ctx.pseudo(id)),
      votes: detail,
      deltas,
      // Classement apres ce tour, avec ce que chacun vient de gagner
      scores: ctx.players()
        .map((p) => ({ pseudo: p.pseudo, score: p.score, delta: deltas[p.id] || 0 }))
        .sort((a, b) => b.score - a.score),
      isLast: currentIndex >= playlist.length - 1,
    };

    phase = 'REVEAL';
    ctx.update();
    // Par defaut on attend l'hote : il relance quand le groupe a fini de commenter.
    if (CONFIG.revealMs > 0) ctx.setTimer(CONFIG.revealMs, nextRound);
  }

  function nextRound() {
    ctx.clearTimer();
    if (currentIndex >= playlist.length - 1) return ctx.finish();
    currentIndex += 1;
    startRound().catch((e) => console.error('[manche]', e.message));
  }

  // -------------------------------------------------------------------------
  // Actions des joueurs
  // -------------------------------------------------------------------------
  const actions = {
    submit(playerId, track) {
      if (phase !== 'PICKING') return;
      if (!track?.trackKey) return ctx.fail(playerId, 'Morceau invalide');

      // Le client renvoie l'objet piste : on ne le croit pas sur parole. L'URL
      // audio, elle, n'arrive jamais d'ici — le serveur la resigne lui-meme a
      // partir du seul identifiant.
      const okId = /^\d+$/.test(String(track.trackKey));
      const okImage = !track.artwork || PREVIEW_HOST.test(track.artwork)
        || /^https:\/\/[\w.-]+\.dzcdn\.net\//.test(track.artwork);
      if (!okId || !okImage) return ctx.fail(playerId, 'Morceau invalide');

      const clean = (s) => String(s ?? '').slice(0, 200);
      const already = mine(playerId);
      if (already.length >= CONFIG.maxTracks) {
        return ctx.fail(playerId, `Maximum ${CONFIG.maxTracks} morceaux`);
      }
      if (already.some((s) => s.trackKey === String(track.trackKey))) {
        return ctx.fail(playerId, 'Tu as déjà choisi ce morceau');
      }

      const twin = submissions.find((s) => s.trackKey === String(track.trackKey));
      if (CONFIG.mergeDuplicates && twin) {
        twin.ownerIds.push(playerId);
      } else {
        submissions.push({
          id: ctx.uid(),
          trackKey: clean(track.trackKey),
          title: clean(track.title),
          artist: clean(track.artist),
          artwork: clean(track.artwork),
          previewUrl: null,          // resigne a chaque lecture
          ownerIds: [playerId],
        });
      }
      ctx.update();
    },

    remove(playerId, { id } = {}) {
      if (phase !== 'PICKING') return;
      const s = submissions.find((x) => x.id === id && x.ownerIds.includes(playerId));
      if (!s) return;
      s.ownerIds = s.ownerIds.filter((o) => o !== playerId);
      if (s.ownerIds.length === 0) submissions = submissions.filter((x) => x.id !== s.id);

      // Repasser sous le minimum annule automatiquement le "pret"
      if (mine(playerId).length < CONFIG.minTracks) ctx.setReady(playerId, false);
      ctx.update();
    },

    ready(playerId, { ready } = {}) {
      if (phase !== 'PICKING') return;
      if (ready && mine(playerId).length < CONFIG.minTracks) {
        return ctx.fail(playerId, `Il te faut ${CONFIG.minTracks} morceaux`);
      }
      ctx.setReady(playerId, !!ready);
      ctx.update();
    },

    begin(playerId) {
      if (phase !== 'PICKING' || !ctx.isHost(playerId)) return;
      // On n'attend que les joueurs encore la : sinon un onglet ferme pendant
      // la selection bloquerait la partie pour tout le monde.
      const notReady = ctx.players().filter(
        (p) => p.connected && (!p.ready || mine(p.id).length < CONFIG.minTracks)
      );
      if (notReady.length) {
        return ctx.fail(playerId, `En attente de : ${notReady.map((p) => p.pseudo).join(', ')}`);
      }
      playlist = ctx.shuffle(submissions);
      currentIndex = 0;
      startRound().catch((e) => console.error('[manche]', e.message));
    },

    vote(playerId, { suspectId } = {}) {
      if (phase !== 'PLAYING') return;
      const track = current();
      if (!track) return;
      if (track.ownerIds.includes(playerId)) return;   // c'est ton morceau
      if (suspectId === playerId) return;              // pas de vote pour soi
      if (!ctx.has(suspectId)) return;
      if (votes[playerId]) return;                     // un seul vote par tour

      votes[playerId] = suspectId;
      ctx.update();
      // Pas de fin anticipee : le morceau va toujours jusqu'au bout.
    },

    skip(playerId) {
      if (!ctx.isHost(playerId)) return;
      if (phase === 'PLAYING') endRound();
      else if (phase === 'REVEAL') nextRound();
    },
  };

  // -------------------------------------------------------------------------
  // Vue : ce que CE joueur a le droit de voir
  // -------------------------------------------------------------------------
  function view(playerId) {
    const state = {
      phase,
      config: { minTracks: CONFIG.minTracks, maxTracks: CONFIG.maxTracks },
      // Compteur visible par tous : on sait qui traine, pas ce qu'il a mis.
      counts: Object.fromEntries(ctx.players().map((p) => [p.id, mine(p.id).length])),
    };

    if (phase === 'PICKING') {
      state.mySubmissions = mine(playerId).map((s) => ({
        // trackKey inclus : ce sont TES morceaux, tu sais deja ce que tu as mis,
        // et le bouton d'ecoute s'en sert pour demander une URL fraiche.
        id: s.id, trackKey: s.trackKey, title: s.title, artist: s.artist, artwork: s.artwork,
      }));
      state.myReady = ctx.ready(playerId);
      const present = ctx.players().filter((p) => p.connected);
      // L'hote ne peut pas partir avant que chacun se soit declare pret
      state.canBegin =
        present.length >= meta.minPlayers
        && present.every((p) => mine(p.id).length >= CONFIG.minTracks && p.ready);
      state.waitingFor = present.filter((p) => !p.ready).map((p) => p.pseudo);
    }

    const track = current();

    if (phase === 'PLAYING' && track) {
      // Le titre et la pochette sont visibles : le joueur doit deviner QUI,
      // pas QUOI. Les ownerIds, eux, restent cote serveur.
      state.round = {
        index: currentIndex + 1,
        total: playlist.length,
        title: track.title,
        artist: track.artist,
        artwork: track.artwork,
        previewUrl: track.previewUrl,
        startAt: roundStartAt,
        voteEndsAt: roundStartAt + CONFIG.voteMs,
        canVote: !track.ownerIds.includes(playerId),
        myVote: votes[playerId] || null,
        votedCount: Object.keys(votes).length,
        expectedVotes: expectedVoters(track).length,
        suspects: ctx.players()
          .filter((p) => p.id !== playerId)
          .map((p) => ({ id: p.id, pseudo: p.pseudo })),
      };
    }

    if (phase === 'REVEAL') state.reveal = lastReveal;

    return state;
  }

  return {
    start() {
      phase = 'PICKING';
      submissions = [];
      playlist = [];
      currentIndex = -1;
      votes = {};
      lastReveal = null;
    },
    view,
    action(type, playerId, data) {
      const fn = actions[type];
      if (fn) fn(playerId, data);
    },
    onLeave() {
      // Rien a defaire : un partant n'est plus attendu (voir `begin`), et ses
      // morceaux restent dans la partie — il peut revenir avant son tour.
    },
    stop() {
      ctx.clearTimer();
    },
  };
}
