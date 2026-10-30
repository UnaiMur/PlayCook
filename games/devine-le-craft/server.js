// ---------------------------------------------------------------------------
// « Devine le craft » — les recettes de Minecraft.
//
// Phase 1 (QUESTION) : la grille s'affiche, chacun tape ce qu'elle fabrique.
//                      Plusieurs essais autorises tant que le temps tourne ;
//                      une bonne reponse verrouille la manche pour ce joueur.
// Phase 2 (REVEAL)   : la reponse, qui l'a trouvee et en combien de temps.
//
// Les manches montent en difficulte : on commence par l'etabli, on finit par
// la balise. Les recettes viennent de recettes.json, fabrique a partir des
// donnees du jeu (voir tools/generer-recettes.js) — aucune n'est ecrite de
// memoire.
// ---------------------------------------------------------------------------
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { num } from '../../core/env.js';
import { correspond } from '../_shared/reponses.js';

const ICI = dirname(fileURLToPath(import.meta.url));
// JSON lu a la main plutot qu'importe : les attributs d'import ne s'ecrivent
// pas pareil selon la version de Node, et on vise Node 20 comme Node 22.
const DONNEES = JSON.parse(readFileSync(join(ICI, 'recettes.json'), 'utf8'));
const RECETTES = DONNEES.recettes;

export const meta = {
  id: 'devine-le-craft',
  name: 'Devine le craft',
  tagline: 'La grille de craft s\'affiche, à toi de dire ce qu\'elle fabrique.',
  icon: '⛏️',
  rules: [
    'Une grille de craft Minecraft s\'affiche, sans le résultat.',
    'Tape ce qu\'elle fabrique — autant d\'essais que tu veux dans le temps imparti.',
    '100 points si tu trouves, plus un bonus de rapidité : +50, +30, +10 aux trois premiers.',
    'Les manches montent en difficulté au fil de la partie.',
  ],
  minPlayers: 1,      // ca se joue tres bien seul, pour s'entrainer
  maxPlayers: 12,
  allowLateJoin: false,
};

const CONFIG = {
  rounds: num(process.env.DLC_ROUNDS, 10),
  roundMs: num(process.env.DLC_ROUND_MS, 45000),
  revealMs: num(process.env.DLC_REVEAL_MS, 0),   // 0 = l'hote enchaine
  points: num(process.env.DLC_POINTS, 100),
  // Bonus pour les premiers a trouver, dans l'ordre.
  bonus: [50, 30, 10],
  maxEssais: num(process.env.DLC_MAX_ESSAIS, 12),
};

// Tirage : on repartit les manches sur les trois niveaux, puis on les joue du
// plus facile au plus difficile. Une partie raconte ainsi une progression.
function tirerRecettes(melanger) {
  const parNiveau = { 1: [], 2: [], 3: [] };
  for (const r of RECETTES) parNiveau[r.niveau]?.push(r);

  const n = Math.min(CONFIG.rounds, RECETTES.length);
  const parts = [Math.round(n * 0.3), Math.round(n * 0.4)];
  parts.push(n - parts[0] - parts[1]);

  const choisies = [];
  [1, 2, 3].forEach((niveau, i) => {
    choisies.push(...melanger(parNiveau[niveau]).slice(0, parts[i]));
  });
  // Si un niveau manquait de recettes, on complete avec le reste.
  if (choisies.length < n) {
    const reste = melanger(RECETTES.filter((r) => !choisies.includes(r)));
    choisies.push(...reste.slice(0, n - choisies.length));
  }
  return choisies.sort((a, b) => a.niveau - b.niveau);
}

export function create(ctx) {
  let phase = 'QUESTION';
  let manches = [];
  let index = -1;
  let trouve = {};       // playerId -> { rang, ms, points }
  let essais = {};       // playerId -> [{ texte, bon }]
  let deadline = 0;
  let debut = 0;
  let lastReveal = null;

  const courante = () => manches[index] || null;
  const presents = () => ctx.players().filter((p) => p.connected);

  // -------------------------------------------------------------------------
  // Manches
  // -------------------------------------------------------------------------
  function startRound() {
    ctx.clearTimer();
    trouve = {};
    essais = {};
    lastReveal = null;
    phase = 'QUESTION';
    debut = ctx.now();
    deadline = debut + CONFIG.roundMs;
    ctx.update();
    ctx.setTimer(CONFIG.roundMs, endRound);
  }

  function endRound() {
    ctx.clearTimer();
    const r = courante();
    if (!r) return;

    for (const [id, t] of Object.entries(trouve)) ctx.award(id, t.points);

    lastReveal = {
      index: index + 1,
      total: manches.length,
      resultat: r.resultat,
      quantite: r.quantite,
      niveau: r.niveau,
      grille: r.grille,
      legende: r.legende,
      vrac: r.vrac,
      // Qui a trouve, dans l'ordre, avec son temps.
      trouveurs: Object.entries(trouve)
        .sort((a, b) => a[1].rang - b[1].rang)
        .map(([id, t]) => ({
          pseudo: ctx.pseudo(id),
          secondes: Math.round(t.ms / 100) / 10,
          points: t.points,
        })),
      rates: presents()
        .filter((p) => !trouve[p.id])
        .map((p) => ctx.pseudo(p.id)),
      scores: ctx.players()
        .map((p) => ({ pseudo: p.pseudo, score: p.score, delta: trouve[p.id]?.points || 0 }))
        .sort((a, b) => b.score - a.score),
      isLast: index >= manches.length - 1,
    };

    phase = 'REVEAL';
    ctx.update();
    if (CONFIG.revealMs > 0) ctx.setTimer(CONFIG.revealMs, nextRound);
  }

  function nextRound() {
    ctx.clearTimer();
    if (index >= manches.length - 1) return ctx.finish();
    index += 1;
    startRound();
  }

  const aAbandonne = (id) => (essais[id] || []).some((e) => e.abandon);

  // Inutile de laisser tourner le chrono si plus personne ne cherche : tout le
  // monde a trouve, ou a jete l'eponge.
  function closeIfNobodyLeft() {
    if (phase !== 'QUESTION') return;
    const ici = presents();
    if (ici.length && ici.every((p) => trouve[p.id] || aAbandonne(p.id))) endRound();
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const actions = {
    guess(playerId, { texte } = {}) {
      if (phase !== 'QUESTION') return;
      if (trouve[playerId]) return;                 // deja trouve, on verrouille
      const r = courante();
      if (!r) return;

      const propre = String(texte ?? '').trim().slice(0, 60);
      if (!propre) return;

      const mes = (essais[playerId] ||= []);
      if (mes.length >= CONFIG.maxEssais) {
        return ctx.fail(playerId, 'Trop d\'essais pour cette manche');
      }

      const bon = correspond(propre, r.alias);
      mes.push({ texte: propre, bon });

      if (bon) {
        const rang = Object.keys(trouve).length + 1;
        const points = CONFIG.points + (CONFIG.bonus[rang - 1] || 0);
        trouve[playerId] = { rang, ms: ctx.now() - debut, points };
      }

      ctx.update();
      if (bon) closeIfNobodyLeft();
    },

    // Rendre les armes : on ne trouvera pas, autant ne pas faire attendre les
    // autres jusqu'au bout du chrono.
    abandonner(playerId) {
      if (phase !== 'QUESTION' || trouve[playerId] || aAbandonne(playerId)) return;
      (essais[playerId] ||= []).push({ texte: '', abandon: true });
      ctx.update();
      closeIfNobodyLeft();
    },

    skip(playerId) {
      if (!ctx.isHost(playerId)) return;
      if (phase === 'QUESTION') endRound();
      else if (phase === 'REVEAL') nextRound();
    },
  };

  // -------------------------------------------------------------------------
  // Vue
  //
  // REGLE CENTRALE : ni `resultat` ni `alias` ne sortent d'ici avant la
  // revelation. Le client ne recoit que la grille.
  // -------------------------------------------------------------------------
  function view(playerId) {
    const state = { phase };
    const r = courante();

    if (phase === 'QUESTION' && r) {
      const mes = essais[playerId] || [];
      state.round = {
        index: index + 1,
        total: manches.length,
        niveau: r.niveau,
        grille: r.grille,
        legende: r.legende,
        vrac: r.vrac,
        quantite: r.quantite,
        endsAt: deadline,
        // Ce que CE joueur a deja tente, pour ne pas se repeter.
        mesEssais: mes.map((e) => ({ texte: e.texte, bon: !!e.bon, abandon: !!e.abandon })),
        jaiTrouve: !!trouve[playerId],
        monRang: trouve[playerId]?.rang || null,
        jaiAbandonne: aAbandonne(playerId),
        // De quoi savoir ou en est le groupe, sans rien reveler.
        trouves: Object.keys(trouve).length,
        joueurs: presents().length,
        tableau: presents().map((p) => ({
          pseudo: p.pseudo,
          trouve: !!trouve[p.id],
          abandon: aAbandonne(p.id),
        })),
      };
    }

    if (phase === 'REVEAL') state.reveal = lastReveal;
    return state;
  }

  return {
    start() {
      manches = tirerRecettes(ctx.shuffle);
      index = 0;
      startRound();
    },
    view,
    action(type, playerId, data) {
      const fn = actions[type];
      if (fn) fn(playerId, data);
    },
    onLeave() {
      // Un partant n'empeche plus la manche de se cloturer.
      closeIfNobodyLeft();
    },
    stop() {
      ctx.clearTimer();
    },
  };
}
