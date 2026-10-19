// ---------------------------------------------------------------------------
// « Qui a mis ça ? » — blind test entre amis.
//
// Phase 1 (PICKING)  : chacun choisit 3 a 5 morceaux, en secret.
// Phase 2 (PLAYING)  : les morceaux passent en aleatoire, il faut deviner qui.
// Phase 3 (REVEAL)   : on devoile, on compte, l'hote enchaine.
//
// La mecanique vit dans games/_shared/devine-qui.js, partagee avec « Qui
// regarde ça ? ». Ce fichier ne garde que ce qui est propre a la musique :
// la source Deezer, la validation d'un morceau, et la resignature de l'URL
// d'extrait juste avant chaque manche.
// ---------------------------------------------------------------------------
import { num, bool } from '../../core/env.js';
import { createGuessWho } from '../_shared/devine-qui.js';
import { routes as deezerRoutes, resolvePreview, ARTWORK_HOST } from './deezer.js';

export const meta = {
  id: 'blindtest',
  name: 'Qui a mis ça ?',
  tagline: 'Chacun met ses morceaux, devinez qui a choisi quoi.',
  icon: '🎵',
  // Affichees dans le menu : de quoi comprendre le jeu sans l'avoir essaye.
  rules: [
    'Chacun choisit 3 à 5 morceaux en secret.',
    'Les morceaux passent dans un ordre aléatoire, 30 secondes chacun.',
    'À chaque morceau, devine qui l\'a mis : 100 points si tu trouves.',
    'Si personne ne te démasque, tu gagnes 50 points par joueur piégé.',
  ],
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

const clean = (s) => String(s ?? '').slice(0, 200);

export function create(ctx) {
  return createGuessWho(ctx, {
    minPlayers: meta.minPlayers,
    minItems: CONFIG.minTracks,
    maxItems: CONFIG.maxTracks,
    mergeDuplicates: CONFIG.mergeDuplicates,
    leadMs: CONFIG.leadMs,
    roundMs: CONFIG.voteMs,
    revealMs: CONFIG.revealMs,
    pointsCorrect: CONFIG.pointsCorrect,
    pointsPerFooled: CONFIG.pointsPerFooled,

    labels: {
      one: 'morceau',
      many: 'morceaux',
      duplicate: 'Tu as déjà choisi ce morceau',
    },

    // Le client renvoie l'objet piste : on ne le croit pas sur parole. L'URL
    // audio, elle, n'arrive jamais d'ici — le serveur la resigne lui-meme a
    // partir du seul identifiant.
    sanitize(track) {
      if (!/^\d+$/.test(String(track.trackKey ?? ''))) return null;
      if (track.artwork && !ARTWORK_HOST.test(track.artwork)) return null;
      return {
        trackKey: clean(track.trackKey),
        title: clean(track.title),
        artist: clean(track.artist),
        artwork: clean(track.artwork),
        previewUrl: null,        // resigne a chaque lecture
      };
    },

    identity: (t) => t.trackKey,

    // L'URL signee expire en ~15 min : on la resigne juste avant de la
    // diffuser, sinon les dernieres manches d'une longue partie seraient
    // muettes. Si Deezer refuse, la manche se joue sans son.
    async prepare(track) {
      try {
        track.previewUrl = await resolvePreview(track.trackKey);
      } catch (err) {
        console.error('[extrait]', track.trackKey, err.message);
        track.previewUrl = null;
      }
    },

    // trackKey est inclus : pendant la selection, le bouton d'ecoute s'en sert
    // pour demander une URL fraiche, et pendant la manche il ne revele rien de
    // plus que le titre deja affiche.
    fields: (t) => ({
      trackKey: t.trackKey,
      title: t.title,
      artist: t.artist,
      artwork: t.artwork,
      previewUrl: t.previewUrl,
    }),
  });
}
