// ---------------------------------------------------------------------------
// Moteur « devine qui a mis ça ».
//
// Deux jeux partagent exactement la meme mecanique :
//
//   « Qui a mis ça ? »     chacun soumet des morceaux, on devine qui
//   « Qui regarde ça ? »   chacun soumet des series/films, on devine qui
//
// Seules trois choses les separent : ce qu'est un element valide, ce qu'on en
// montre au client, et un eventuel travail a faire juste avant chaque manche
// (resigner une URL audio, par exemple). Tout le reste — phases, soumissions
// secretes, drapeau « pret », votes, points, revelation — vit ici.
//
// Un jeu fournit une SPEC et recupere l'objet attendu par core/platform.js :
//
//   spec.minItems / maxItems      combien chacun doit en soumettre
//   spec.mergeDuplicates          deux joueurs, meme element : une ou deux manches
//   spec.leadMs                   delai avant le top depart (0 si pas de media)
//   spec.roundMs                  duree d'une manche
//   spec.revealMs                 0 = l'hote enchaine lui-meme
//   spec.pointsCorrect            points pour avoir trouve
//   spec.pointsPerFooled          points au proprietaire, par joueur piege
//   spec.labels                   { one, many, duplicate } pour les messages
//   spec.sanitize(brut)           -> element nettoye, ou null si invalide
//   spec.identity(element)        -> cle d'unicite (id de la source)
//   spec.fields(element)          -> ce que le client a le droit de voir
//   spec.prepare?(element)        -> async, juste avant que la manche commence
//
// REGLE CENTRALE, valable pour tous les jeux batis dessus : `ownerIds` ne
// quitte JAMAIS le serveur avant la revelation.
// ---------------------------------------------------------------------------

export function createGuessWho(ctx, spec) {
  const {
    minPlayers = 2,
    minItems, maxItems, mergeDuplicates = false,
    leadMs = 0, roundMs, revealMs = 0,
    pointsCorrect, pointsPerFooled,
    labels = { one: 'élément', many: 'éléments', duplicate: 'Tu as déjà choisi ça' },
    sanitize, identity, fields, prepare,
  } = spec;

  let phase = 'PICKING';
  let submissions = [];     // { id, ...element, ownerIds: [] }
  let playlist = [];
  let currentIndex = -1;
  let votes = {};
  let roundStartAt = null;
  let lastReveal = null;

  const current = () => playlist[currentIndex] || null;
  const mine = (playerId) => submissions.filter((s) => s.ownerIds.includes(playerId));
  const present = () => ctx.players().filter((p) => p.connected);

  const expectedVoters = (item) =>
    ctx.players().filter((p) => p.connected && !item.ownerIds.includes(p.id));

  // -------------------------------------------------------------------------
  // Boucle de jeu
  // -------------------------------------------------------------------------
  async function startRound() {
    ctx.clearTimer();
    votes = {};
    lastReveal = null;
    phase = 'PLAYING';

    // Le jeu peut avoir besoin de rafraichir quelque chose juste avant la
    // diffusion (une URL signee qui expire, par exemple). Si ca echoue, la
    // manche se joue quand meme : mieux vaut un tour degrade qu'une partie
    // bloquee.
    const item = current();
    if (item && prepare) {
      try {
        await prepare(item);
      } catch (err) {
        console.error('[manche] preparation', err.message);
      }
    }

    roundStartAt = ctx.now() + leadMs;
    ctx.update();

    // Le serveur tranche de toute facon a la fin de la fenetre, meme si des
    // joueurs n'ont pas vote (onglet ferme, deconnexion...).
    ctx.setTimer(leadMs + roundMs, endRound);
  }

  function endRound() {
    ctx.clearTimer();
    const item = current();
    if (!item) return;

    const deltas = {};
    const bump = (id, n) => { deltas[id] = (deltas[id] || 0) + n; };

    const detail = [];
    for (const [voterId, suspectId] of Object.entries(votes)) {
      const correct = item.ownerIds.includes(suspectId);
      if (correct) bump(voterId, pointsCorrect);
      else item.ownerIds.forEach((o) => bump(o, pointsPerFooled));
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
      ...fields(item),
      owners: item.ownerIds.map((id) => ctx.pseudo(id)),
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
    if (revealMs > 0) ctx.setTimer(revealMs, nextRound);
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
    submit(playerId, raw) {
      if (phase !== 'PICKING') return;

      // Le client renvoie l'element : on ne le croit pas sur parole. C'est au
      // jeu de dire ce qui est recevable, et de ne garder que des champs surs.
      const item = raw ? sanitize(raw) : null;
      if (!item) return ctx.fail(playerId, `${cap(labels.one)} invalide`);

      const key = identity(item);
      const already = mine(playerId);
      if (already.length >= maxItems) {
        return ctx.fail(playerId, `Maximum ${maxItems} ${labels.many}`);
      }
      if (already.some((s) => identity(s) === key)) return ctx.fail(playerId, labels.duplicate);

      const twin = submissions.find((s) => identity(s) === key);
      if (mergeDuplicates && twin) {
        twin.ownerIds.push(playerId);
      } else {
        submissions.push({ id: ctx.uid(), ...item, ownerIds: [playerId] });
      }
      ctx.update();
    },

    remove(playerId, { id } = {}) {
      if (phase !== 'PICKING') return;
      const s = submissions.find((x) => x.id === id && x.ownerIds.includes(playerId));
      if (!s) return;
      s.ownerIds = s.ownerIds.filter((o) => o !== playerId);
      if (s.ownerIds.length === 0) submissions = submissions.filter((x) => x.id !== s.id);

      // Repasser sous le minimum annule automatiquement le « pret »
      if (mine(playerId).length < minItems) ctx.setReady(playerId, false);
      ctx.update();
    },

    ready(playerId, { ready } = {}) {
      if (phase !== 'PICKING') return;
      if (ready && mine(playerId).length < minItems) {
        return ctx.fail(playerId, `Il te faut ${minItems} ${labels.many}`);
      }
      ctx.setReady(playerId, !!ready);
      ctx.update();
    },

    begin(playerId) {
      if (phase !== 'PICKING' || !ctx.isHost(playerId)) return;
      // On n'attend que les joueurs encore la : sinon un onglet ferme pendant
      // la selection bloquerait la partie pour tout le monde.
      const notReady = present().filter(
        (p) => !p.ready || mine(p.id).length < minItems
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
      const item = current();
      if (!item) return;
      if (item.ownerIds.includes(playerId)) return;    // c'est le tien
      if (suspectId === playerId) return;              // pas de vote pour soi
      if (!ctx.has(suspectId)) return;
      if (votes[playerId]) return;                     // un seul vote par tour

      votes[playerId] = suspectId;
      ctx.update();
      // Pas de fin anticipee : la manche va toujours au bout de sa fenetre.
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
      config: { minItems, maxItems },
      // Compteur visible par tous : on sait qui traine, pas ce qu'il a mis.
      counts: Object.fromEntries(ctx.players().map((p) => [p.id, mine(p.id).length])),
    };

    if (phase === 'PICKING') {
      // Ce sont TES elements : tu sais deja ce que tu as mis.
      state.mySubmissions = mine(playerId).map((s) => ({ id: s.id, ...fields(s) }));
      state.myReady = ctx.ready(playerId);
      const ici = present();
      // L'hote ne peut pas partir avant que chacun se soit declare pret
      state.canBegin = ici.length >= minPlayers
        && ici.every((p) => mine(p.id).length >= minItems && p.ready);
      state.waitingFor = ici.filter((p) => !p.ready).map((p) => p.pseudo);
    }

    const item = current();

    if (phase === 'PLAYING' && item) {
      // Le titre et l'image sont visibles : le joueur doit deviner QUI, pas
      // QUOI. Les ownerIds, eux, restent cote serveur.
      state.round = {
        index: currentIndex + 1,
        total: playlist.length,
        ...fields(item),
        startAt: roundStartAt,
        voteEndsAt: roundStartAt + roundMs,
        canVote: !item.ownerIds.includes(playerId),
        myVote: votes[playerId] || null,
        votedCount: Object.keys(votes).length,
        expectedVotes: expectedVoters(item).length,
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
      // elements restent dans la partie — il peut revenir avant son tour.
    },
    stop() {
      ctx.clearTimer();
    },
  };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
