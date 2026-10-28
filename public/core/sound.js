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
// crossOrigin est indispensable pour analyser le son : sans lui, l'analyseur
// ne recevrait que du silence. Deezer envoie bien l'en-tete CORS — verifie
// avec public/diagnostic/audio.html. S'il cessait de le faire, le chargement
// echouerait : d'ou le lecteur de secours plus bas, qui reprend la main sans
// analyse plutot que de laisser la partie muette.
main.crossOrigin = 'anonymous';

// Lecteur de repli, jamais branche sur l'analyseur et sans crossOrigin.
const secours = new Audio();
secours.preload = 'auto';
let enSecours = false;

const cue = new Audio();
cue.preload = 'none';

let unlocked = false;
let playTimer = null;

// --- analyse du spectre -----------------------------------------------------
// Branche une seule fois : createMediaElementSource ne peut pas etre rappele
// sur le meme element, et une fois branche le son passe par le contexte.
let ctx = null;
let analyseur = null;
let spectre = null;
let analysePossible = true;

function brancherAnalyse() {
  if (!analysePossible || analyseur || enSecours) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) { analysePossible = false; return; }
  try {
    ctx = new Ctx();
    const source = ctx.createMediaElementSource(main);
    analyseur = ctx.createAnalyser();
    analyseur.fftSize = 128;
    analyseur.smoothingTimeConstant = 0.75;
    source.connect(analyseur);
    analyseur.connect(ctx.destination);   // sans ca, plus aucun son ne sort
    spectre = new Uint8Array(analyseur.frequencyBinCount);
  } catch (err) {
    // Contexte refuse, element deja branche, navigateur recalcitrant : on
    // abandonne l'analyse, jamais la lecture.
    console.warn('[son] analyse indisponible :', err.message);
    analysePossible = false;
    analyseur = null;
  }
}

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
  secours.volume = v / 100;
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
  // Le contexte audio ne demarre qu'apres un geste : c'est ici, pas avant.
  brancherAnalyse();
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
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
    const lecteur = enSecours ? secours : main;

    // Le chargement a echoue : presque toujours un refus de CORS. On rebascule
    // sur le lecteur de secours, sans analyse, et la manche se joue quand meme.
    lecteur.onerror = () => {
      if (enSecours) return;
      console.warn('[son] chargement refuse, bascule sur le lecteur de secours');
      enSecours = true;
      analysePossible = false;
      analyseur = null;
      secours.volume = main.volume;
      secours.src = url;
      secours.load();
    };

    lecteur.src = url;
    lecteur.load();
    const wait = Math.max(0, at - now());
    playTimer = setTimeout(() => {
      const l = enSecours ? secours : main;
      l.currentTime = 0;
      l.play().catch(() => onBlocked && onBlocked());
    }, wait);
  },

  stop() {
    clearTimeout(playTimer);
    main.pause();
    secours.pause();
  },

  // Niveaux du spectre, 0 a 1, ou null si l'analyse n'est pas disponible.
  // `grave` sert a faire battre le decor : c'est la bande qui suit le rythme.
  niveaux() {
    if (!analyseur || !spectre) return null;
    analyseur.getByteFrequencyData(spectre);
    const n = spectre.length;
    const moyenne = (debut, fin) => {
      let somme = 0;
      for (let i = debut; i < fin; i++) somme += spectre[i];
      return somme / ((fin - debut) * 255);
    };
    return {
      grave: moyenne(0, Math.max(1, Math.floor(n * 0.12))),
      medium: moyenne(Math.floor(n * 0.12), Math.floor(n * 0.45)),
      aigu: moyenne(Math.floor(n * 0.45), n),
    };
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
