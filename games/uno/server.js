// ---------------------------------------------------------------------------
// UNO.
//
// Phase 1 (REGLES)  : l'hote coche les regles maison et le nombre de manches.
// Phase 2 (JEU)     : la table. Chacun joue a son tour, sa main reste a lui.
// Phase 3 (MANCHE)  : fin de manche, le gagnant encaisse les cartes restantes.
//
// C'est le premier jeu de la plateforme qui garde un etat vivant d'un tour a
// l'autre : pioche, defausse, sens de rotation, cumul des +2. Les regles de
// pose, elles, sont dans cartes.js — testables sans monter une partie.
//
// REGLE CENTRALE : `mains` ne sort jamais d'ici. Un joueur ne recoit que la
// sienne ; des autres il ne voit que le nombre de cartes.
// ---------------------------------------------------------------------------
import { readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { num, bool } from '../../core/env.js';
import {
  COULEURS, paquet, jouable, identique, estNoire, combienPiocher, points,
} from './cartes.js';

export const meta = {
  id: 'uno',
  name: 'UNO',
  tagline: 'Le jeu de cartes, autour d\'une table — avec les règles maison que vous voulez.',
  icon: '🃏',
  rules: [
    'Chacun reçoit 7 cartes ; pose une carte de même couleur, même chiffre ou même symbole.',
    'Les cartes noires se posent sur tout et te laissent choisir la couleur.',
    'Pense à annoncer UNO quand il ne t\'en reste qu\'une, sinon tu piochesras.',
    'Le premier à vider sa main empoche les cartes restantes des autres.',
  ],
  minPlayers: 2,
  maxPlayers: 8,
  allowLateJoin: false,
};

const CONFIG = {
  mainDepart: num(process.env.UNO_MAIN, 7),
  manchesDefaut: num(process.env.UNO_MANCHES, 3),
  tourMs: num(process.env.UNO_TOUR_MS, 90000),
  // Valeurs de depart des regles maison ; l'hote les change avant de distribuer.
  empiler: bool(process.env.UNO_EMPILER, true),
  piocherJusqu: bool(process.env.UNO_PIOCHER_JUSQU, false),
  penaliteUno: bool(process.env.UNO_PENALITE, true),
  jumpIn: bool(process.env.UNO_JUMP_IN, false),
};

// ---------------------------------------------------------------------------
// Quelles cartes ont recu une image ?
//
// Le client le demande une fois et n'affiche que celles-la : sans ca, chaque
// carte non dessinee declencherait un 404 dans la console du navigateur. On
// relit le dossier de temps en temps, pour qu'une image deposee soit prise en
// compte sans redemarrer le serveur.
// ---------------------------------------------------------------------------
const DOSSIER_CARTES = join(dirname(fileURLToPath(import.meta.url)), '../../public/games/uno/cartes');
const EXTENSIONS = /\.(png|jpe?g|webp|svg)$/i;
let cacheImages = { a: 0, noms: [] };

function imagesDisponibles() {
  if (Date.now() - cacheImages.a < 10000) return cacheImages.noms;
  let noms = [];
  try {
    if (existsSync(DOSSIER_CARTES)) {
      noms = readdirSync(DOSSIER_CARTES)
        .filter((f) => EXTENSIONS.test(f))
        .map((f) => f.replace(EXTENSIONS, ''));
    }
  } catch (err) {
    console.error('[uno] lecture des cartes', err.message);
  }
  cacheImages = { a: Date.now(), noms };
  return noms;
}

export function routes(app) {
  app.get('/api/uno/cartes', (req, res) => res.json(imagesDisponibles()));
}

export function create(ctx) {
  let phase = 'REGLES';
  const regles = {
    empiler: CONFIG.empiler,
    piocherJusqu: CONFIG.piocherJusqu,
    penaliteUno: CONFIG.penaliteUno,
    jumpIn: CONFIG.jumpIn,
  };
  let manchesVoulues = CONFIG.manchesDefaut;
  let mancheNo = 0;

  let pioche = [];
  let defausse = [];
  let mains = {};
  let ordre = [];          // l'ordre des places autour de la table
  let sens = 1;            // 1 = horaire, -1 = antihoraire
  let tour = 0;            // index dans `ordre`
  let couleur = null;      // couleur active (celle choisie, apres une noire)
  let cumul = 0;           // +2/+4 en attente pour le joueur courant
  let dejaPioche = false;  // le joueur courant a deja pioche ce tour
  let aDitUno = {};
  let journal = [];        // les derniers evenements, affiches sur la table
  let finManche = null;
  let finTour = 0;         // instant limite du tour courant

  const pseudo = (id) => ctx.pseudo(id);
  const courant = () => ordre[tour];
  const connecte = (id) => ctx.players().find((p) => p.id === id)?.connected;
  const dessus = () => defausse[defausse.length - 1];
  const noter = (texte) => { journal.push(texte); if (journal.length > 6) journal.shift(); };

  const contexte = () => ({ dessus: dessus(), couleur, cumul, empiler: regles.empiler });
  const mesJouables = (id) => (mains[id] || []).filter((c) => jouable(c, contexte()));

  // -------------------------------------------------------------------------
  // Tour de table
  // -------------------------------------------------------------------------
  // On saute les joueurs deconnectes : un onglet ferme ne doit pas figer la
  // partie pour tout le monde.
  function avancer(n = 1) {
    const quelquUn = ordre.some((id) => connecte(id));
    for (let k = 0; k < n; k++) {
      let gardeFou = 0;
      do {
        tour = (tour + sens + ordre.length) % ordre.length;
        gardeFou += 1;
      } while (quelquUn && !connecte(ordre[tour]) && gardeFou <= ordre.length);
    }
    armerTimer();
  }

  function armerTimer() {
    finTour = ctx.now() + CONFIG.tourMs;
    ctx.setTimer(CONFIG.tourMs, () => {
      // Personne ne joue : on pioche d'office et on passe, sinon la table
      // reste bloquee sur un joueur parti se faire un cafe.
      const id = courant();
      if (!id || phase !== 'JEU') return;
      noter(`${pseudo(id)} n'a pas joué à temps`);
      if (cumul > 0) { prendre(id, cumul); cumul = 0; } else prendre(id, 1);
      dejaPioche = false;
      avancer();
      ctx.update();
    });
  }

  // -------------------------------------------------------------------------
  // Pioche et defausse
  // -------------------------------------------------------------------------
  // La pioche est vide : on recupere la defausse, sauf la carte du dessus.
  function reapprovisionner() {
    if (pioche.length || defausse.length <= 1) return;
    const haut = defausse.pop();
    pioche = ctx.shuffle(defausse);
    defausse = [haut];
  }

  function prendre(id, n) {
    const prises = [];
    for (let i = 0; i < n; i++) {
      if (!pioche.length) reapprovisionner();
      if (!pioche.length) break;          // paquet entierement en main : cas extreme
      prises.push(pioche.shift());
    }
    mains[id].push(...prises);
    // Reprendre des cartes annule l'annonce : on n'est plus a une carte.
    if (mains[id].length > 1) aDitUno[id] = false;
    return prises.length;
  }

  function nouvelleManche() {
    pioche = ctx.shuffle(paquet());
    defausse = [];
    mains = {};
    aDitUno = {};
    journal = [];
    cumul = 0;
    sens = 1;
    dejaPioche = false;

    ordre = ctx.players().map((p) => p.id);
    for (const id of ordre) {
      mains[id] = [];
      prendre(id, CONFIG.mainDepart);
    }

    // On retourne une carte chiffree pour commencer : demarrer sur un +4 ou un
    // inverse demanderait une regle speciale pour un gain nul.
    const i = pioche.findIndex((c) => !estNoire(c) && /^\d$/.test(c.valeur));
    const [premiere] = pioche.splice(i < 0 ? 0 : i, 1);
    defausse = [premiere];
    couleur = premiere.couleur;

    tour = 0;
    if (!connecte(ordre[0])) avancer();
    else armerTimer();
    phase = 'JEU';
  }

  // -------------------------------------------------------------------------
  // Fin de manche
  // -------------------------------------------------------------------------
  function terminerManche(gagnantId) {
    ctx.clearTimer();
    let total = 0;
    const restes = [];
    for (const id of ordre) {
      if (id === gagnantId) { restes.push({ pseudo: pseudo(id), cartes: 0, points: 0 }); continue; }
      const p = mains[id].reduce((n, c) => n + points(c), 0);
      total += p;
      restes.push({ pseudo: pseudo(id), cartes: mains[id].length, points: p });
    }
    ctx.award(gagnantId, total);

    finManche = {
      manche: mancheNo,
      manches: manchesVoulues,
      gagnant: pseudo(gagnantId),
      gagne: total,
      restes: restes.sort((a, b) => a.points - b.points),
      scores: ctx.players()
        .map((p) => ({ pseudo: p.pseudo, score: p.score, delta: p.id === gagnantId ? total : 0 }))
        .sort((a, b) => b.score - a.score),
      derniere: mancheNo >= manchesVoulues,
    };
    phase = 'MANCHE';
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const actions = {
    // --- avant la distribution ---
    regle(playerId, { nom, actif } = {}) {
      if (phase !== 'REGLES' || !ctx.isHost(playerId)) return;
      if (!(nom in regles)) return;
      regles[nom] = !!actif;
    },

    manches(playerId, { n } = {}) {
      if (phase !== 'REGLES' || !ctx.isHost(playerId)) return;
      const v = Number(n);
      if (![1, 3, 5].includes(v)) return;
      manchesVoulues = v;
    },

    distribuer(playerId) {
      if (phase !== 'REGLES' || !ctx.isHost(playerId)) return;
      if (ctx.players().length < meta.minPlayers) return ctx.fail(playerId, 'Il faut au moins 2 joueurs');
      mancheNo = 1;
      nouvelleManche();
    },

    // --- pendant la partie ---
    jouer(playerId, { carte: carteId, couleur: choisie } = {}) {
      if (phase !== 'JEU') return;
      const main = mains[playerId];
      if (!main) return;
      const i = main.findIndex((c) => c.id === carteId);
      if (i < 0) return;
      const carte = main[i];

      const monTour = courant() === playerId;
      // Pas de jump-in tant qu'un +2/+4 est en attente : ce serait une porte
      // de sortie que la regle n'a jamais prevue.
      const saut = !monTour && regles.jumpIn && cumul === 0 && identique(carte, dessus());

      if (!monTour && !saut) return ctx.fail(playerId, "Ce n'est pas ton tour");
      if (monTour && !jouable(carte, contexte())) {
        return ctx.fail(playerId, cumul > 0
          ? `Tu dois piocher ${cumul} cartes`
          : 'Cette carte ne peut pas être posée');
      }
      if (estNoire(carte) && !COULEURS.includes(choisie)) {
        return ctx.fail(playerId, 'Choisis une couleur');
      }

      main.splice(i, 1);
      defausse.push(carte);
      couleur = estNoire(carte) ? choisie : carte.couleur;
      dejaPioche = false;

      if (saut) {
        // Le jump-in prend la main : le tour repart de celui qui a pose.
        tour = ordre.indexOf(playerId);
        noter(`${pseudo(playerId)} coupe !`);
      }

      // Oublier d'annoncer UNO s'expose a une denonciation, mais seulement si
      // la regle est active ; sinon on annonce pour lui.
      if (main.length === 1 && !regles.penaliteUno) aDitUno[playerId] = true;

      if (main.length === 0) {
        noter(`${pseudo(playerId)} a posé sa dernière carte`);
        terminerManche(playerId);
        return;
      }

      switch (carte.valeur) {
        case 'plus2':
        case 'plus4':
          cumul += combienPiocher(carte);
          noter(`${pseudo(playerId)} pose un +${combienPiocher(carte)} (cumul : ${cumul})`);
          avancer();
          break;
        case 'passe':
          avancer(2);
          break;
        case 'inverse':
          // A deux, inverser revient a rejouer : c'est la regle officielle.
          if (ordre.length === 2) avancer(2);
          else { sens = -sens; avancer(); }
          break;
        default:
          avancer();
      }
    },

    piocher(playerId) {
      if (phase !== 'JEU' || courant() !== playerId) return;

      // Encaisser les +2/+4 accumules fait perdre le tour.
      if (cumul > 0) {
        prendre(playerId, cumul);
        noter(`${pseudo(playerId)} ramasse ${cumul} cartes`);
        cumul = 0;
        dejaPioche = false;
        avancer();
        return;
      }

      if (dejaPioche) return ctx.fail(playerId, 'Tu as déjà pioché');

      if (regles.piocherJusqu) {
        // On pioche jusqu'a tomber sur une carte posable, avec un garde-fou.
        let prises = 0;
        while (prises < 30 && !mesJouables(playerId).length) {
          if (!prendre(playerId, 1)) break;
          prises += 1;
        }
        noter(`${pseudo(playerId)} pioche ${prises} carte${prises > 1 ? 's' : ''}`);
      } else {
        prendre(playerId, 1);
      }
      dejaPioche = true;
    },

    passer(playerId) {
      if (phase !== 'JEU' || courant() !== playerId) return;
      if (!dejaPioche) return ctx.fail(playerId, 'Pioche d\'abord');
      dejaPioche = false;
      avancer();
    },

    uno(playerId) {
      if (phase !== 'JEU') return;
      // On peut l'annoncer juste avant de poser l'avant-derniere carte.
      if ((mains[playerId] || []).length <= 2) {
        aDitUno[playerId] = true;
        noter(`${pseudo(playerId)} : UNO !`);
      }
    },

    denoncer(playerId, { cible } = {}) {
      if (phase !== 'JEU' || !regles.penaliteUno) return;
      if (!mains[cible] || cible === playerId) return;
      if (mains[cible].length === 1 && !aDitUno[cible]) {
        prendre(cible, 2);
        noter(`${pseudo(cible)} a oublié d'annoncer UNO : +2`);
      } else {
        prendre(playerId, 2);
        noter(`${pseudo(playerId)} dénonce à tort : +2`);
      }
    },

    // --- entre deux manches ---
    suivante(playerId) {
      if (phase !== 'MANCHE' || !ctx.isHost(playerId)) return;
      if (finManche?.derniere) return ctx.finish();
      mancheNo += 1;
      finManche = null;
      nouvelleManche();
    },
  };

  // -------------------------------------------------------------------------
  // Vue
  // -------------------------------------------------------------------------
  function view(playerId) {
    if (phase === 'REGLES') {
      return {
        phase,
        regles,
        manches: manchesVoulues,
        estHote: ctx.isHost(playerId),
        joueurs: ctx.players().map((p) => ({ pseudo: p.pseudo, connecte: p.connected })),
        assez: ctx.players().length >= meta.minPlayers,
      };
    }

    if (phase === 'MANCHE') return { phase, fin: finManche, estHote: ctx.isHost(playerId) };

    const main = mains[playerId] || [];
    const monTour = courant() === playerId;
    const haut = dessus();

    return {
      phase: 'JEU',
      manche: mancheNo,
      manches: manchesVoulues,
      regles,
      table: {
        dessus: haut,
        couleur,
        cumul,
        sens,
        pioche: pioche.length,
        tourDe: courant(),
        finTour,
        journal: journal.slice(-4),
      },
      // Les autres mains ne sortent jamais : seulement leur taille.
      joueurs: ordre.map((id) => ({
        id,
        pseudo: pseudo(id),
        cartes: mains[id]?.length ?? 0,
        uno: (mains[id]?.length ?? 0) === 1,
        aDitUno: !!aDitUno[id],
        connecte: !!connecte(id),
        sonTour: id === courant(),
        moi: id === playerId,
        // Denoncable : une seule carte, et il ne l'a pas annoncee.
        denoncable: regles.penaliteUno && id !== playerId
          && (mains[id]?.length ?? 0) === 1 && !aDitUno[id],
      })),
      main,
      jouables: monTour ? mesJouables(playerId).map((c) => c.id) : [],
      sautables: (!monTour && regles.jumpIn && haut)
        ? main.filter((c) => identique(c, haut)).map((c) => c.id)
        : [],
      monTour,
      peutPiocher: monTour && (cumul > 0 || !dejaPioche),
      peutPasser: monTour && dejaPioche && cumul === 0,
      doitRamasser: monTour && cumul > 0 && mesJouables(playerId).length === 0,
      peutDireUno: main.length <= 2 && !aDitUno[playerId],
    };
  }

  return {
    start() {
      phase = 'REGLES';
      mancheNo = 0;
      finManche = null;
    },
    view,
    action(type, playerId, data) {
      const fn = actions[type];
      if (!fn) return;
      fn(playerId, data);
      // Rediffusion systematique : chaque action change la table pour tout le
      // monde, et une action refusee ne coute qu'un envoi de plus.
      ctx.update();
    },
    onJoin() {
      // Un revenant retrouve sa main : elle n'a jamais quitte le serveur.
      ctx.update();
    },
    onLeave(playerId) {
      // Si c'etait son tour, on ne bloque pas la table.
      if (phase === 'JEU' && courant() === playerId) {
        noter(`${pseudo(playerId)} s'est déconnecté`);
        if (cumul > 0) { prendre(playerId, cumul); cumul = 0; }
        dejaPioche = false;
        avancer();
        ctx.update();
      }
    },
    stop() {
      ctx.clearTimer();
    },
  };
}
