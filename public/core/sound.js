// ---------------------------------------------------------------------------
// Service audio de la plateforme : deux canaux et un volume commun.
//
//   main : lecture synchronisee entre tous les joueurs (playAt)
//   cue  : ecoutes locales, type pre-ecoute — n'interfere jamais avec main
//
// Pourquoi ici et pas dans le jeu : le deblocage de l'autoplay et le reglage
// de volume sont les memes pour tout jeu qui fait du son, et le curseur vit
// dans l'entete, qui appartient a la plateforme.
// ---------------------------------------------------------------------------
import { $ } from './dom.js';
import { now } from './clock.js';

const main = new Audio();
main.preload = 'auto';
// Pas de crossOrigin : les CDN d'extraits n'envoient pas d'en-tete CORS, et le
// reclamer ferait echouer le chargement. Il ne servirait qu'a analyser le son.

const cue = new Audio();
cue.preload = 'none';

let unlocked = false;
let playTimer = null;

// --- volume ----------------------------------------------------------------
// Reglage purement local : chacun le sien, conserve d'une partie a l'autre.
// iOS ignore audio.volume (le volume y est materiel) : on detecte le cas et on
// masque le curseur plutot que d'afficher une commande qui ne fait rien.
function volumeSupported() {
  const probe = new Audio();
  probe.volume = 0.5;
  return probe.volume === 0.5;
}

function applyVolume(pct) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  main.volume = v / 100;
  cue.volume = v / 100;
  const icon = $('volIcon');
  if (icon) icon.textContent = v === 0 ? '🔇' : v < 50 ? '🔈' : '🔊';
  try { localStorage.setItem('volume', String(v)); } catch { /* mode prive */ }
}

export function initVolume() {
  if (!volumeSupported()) {
    const box = $('volBox');
    if (box) box.style.display = 'none';
    return;
  }
  let saved = 80;
  try {
    const v = localStorage.getItem('volume');
    if (v !== null && !Number.isNaN(Number(v))) saved = Number(v);
  } catch { /* mode prive */ }
  const slider = $('volume');
  if (slider) {
    slider.value = saved;
    slider.oninput = (e) => applyVolume(e.target.value);
  }
  applyVolume(saved);
}

// --- deblocage de l'autoplay ------------------------------------------------
// Les navigateurs refusent de jouer du son tant que l'utilisateur n'a pas
// interagi avec la page. On joue un echantillon silencieux au premier clic.
const SILENCE = 'data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAABAAABSAAA';

export function unlock() {
  if (unlocked) return;
  const a = new Audio(SILENCE);
  a.play().then(() => { unlocked = true; }).catch(() => {});
  main.play().then(() => { main.pause(); unlocked = true; }).catch(() => {});
  // Le canal cue demarre souvent apres un aller-retour reseau, donc hors du
  // geste utilisateur : il doit etre debloque ici, sinon Safari le refusera.
  cue.play().then(() => { cue.pause(); }).catch(() => {});
}

export function listenForUnlock() {
  document.addEventListener('click', unlock, { once: false });
  document.addEventListener('touchstart', unlock, { once: false });
}

// --- canal principal --------------------------------------------------------
export const sound = {
  // Lance `url` a l'instant serveur `at` : tout le monde demarre ensemble.
  playAt(url, at, onBlocked) {
    clearTimeout(playTimer);
    main.src = url;
    main.load();
    const wait = Math.max(0, at - now());
    playTimer = setTimeout(() => {
      main.currentTime = 0;
      main.play().catch(() => onBlocked && onBlocked());
    }, wait);
  },

  stop() {
    clearTimeout(playTimer);
    main.pause();
  },

  // Canal de pre-ecoute : rend une promesse pour pouvoir afficher un etat.
  async cuePlay(url) {
    cue.src = url;
    cue.currentTime = 0;
    await cue.play();
  },

  cueStop() {
    cue.pause();
  },

  onCueEnd(fn) {
    cue.onended = fn;
  },
};
