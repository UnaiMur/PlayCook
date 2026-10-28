// ---------------------------------------------------------------------------
// Le fond qui réagit à la musique.
//
// Un canevas en arrière-plan, couvert de particules qui montent doucement et
// réagissent au son : elles enflent et accélèrent sur les coups de grave.
//
// Une seule boucle d'animation pour tout le monde. C'est important : la
// détection des coups garde un état entre deux images (moyenne glissante,
// décroissance), et deux boucles la feraient décroître deux fois trop vite.
// Le jeu qui veut animer autre chose reçoit les valeurs par `surPulsation`.
//
// Service de plateforme : n'importe quel jeu avec du son peut l'allumer. Il
// ne connait pas le lecteur audio — on lui passe une fonction qui rend les
// niveaux. Ainsi il ne traine aucune dependance et se teste tout seul.
// ---------------------------------------------------------------------------

let canvas = null;
let ctx2d = null;
let particules = [];
let boucle = null;
let surPulsation = null;
let lireNiveaux = null;

// Détection des coups : on compare le grave à sa propre moyenne lente. Un
// passage nettement au-dessus = un coup, qui retombe ensuite tout seul.
let moyenneGrave = 0;
let coup = 0;

// Ce module est charge par les tests, qui n'ont pas de `window` : il s'y rend
// alors inerte d'un bloc, plutot que de proteger chaque acces un par un.
const DANS_NAVIGATEUR = typeof window !== 'undefined' && typeof document !== 'undefined';
const doux = DANS_NAVIGATEUR
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function couleurs() {
  // On emprunte la palette du thème : le fond suit la saison sans rien coder.
  const css = getComputedStyle(document.documentElement);
  const lire = (nom, repli) => (css.getPropertyValue(nom).trim() || repli);
  return [lire('--accent', '#7f77dd'), lire('--ok', '#1d9e75'), lire('--text', '#ece9f5')];
}

function dimensionner() {
  if (!canvas) return;
  // On plafonne la densité de pixels : au-delà de 2, on peint quatre fois plus
  // pour une différence invisible, et les téléphones le sentent passer.
  const d = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * d);
  canvas.height = Math.floor(window.innerHeight * d);
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  ctx2d.setTransform(d, 0, 0, d, 0, 0);
}

function semer() {
  const l = window.innerWidth;
  const h = window.innerHeight;
  // Le nombre suit la surface : une poignée sur un téléphone, davantage sur un
  // grand écran, jamais au point de ramer.
  const cible = doux ? 0 : Math.round(Math.min(130, Math.max(34, (l * h) / 11000)));
  const palette = couleurs();
  particules = Array.from({ length: cible }, () => ({
    x: Math.random() * l,
    y: Math.random() * h,
    r: 2.5 + Math.random() * 8,
    vy: 0.12 + Math.random() * 0.5,
    vx: (Math.random() - 0.5) * 0.25,
    phase: Math.random() * Math.PI * 2,
    teinte: palette[Math.floor(Math.random() * palette.length)],
    alpha: 0.5 + Math.random() * 0.5,
  }));
}

function image() {
  const l = window.innerWidth;
  const h = window.innerHeight;

  // --- lecture du son, une seule fois par image ---------------------------
  const n = lireNiveaux?.();
  let grave = 0; let aigu = 0;
  if (n) {
    grave = n.grave;
    aigu = n.aigu;
    moyenneGrave += (grave - moyenneGrave) * 0.04;      // moyenne lente
    if (grave > moyenneGrave * 1.3 && grave > 0.12) coup = 1;
    else coup *= 0.88;                                   // retombée
  } else {
    coup *= 0.88;
  }

  if (surPulsation) surPulsation({ grave, aigu, coup, actif: !!n });

  // --- dessin --------------------------------------------------------------
  ctx2d.clearRect(0, 0, l, h);
  const elan = 1 + grave * 2.6 + coup * 2;
  const enfle = 1 + coup * 1.1 + grave * 0.7;

  for (const p of particules) {
    p.phase += 0.012;
    p.y -= p.vy * elan;
    p.x += p.vx + Math.sin(p.phase) * 0.35;

    // On réapparaît en bas une fois sorti par le haut.
    if (p.y < -14) { p.y = h + 14; p.x = Math.random() * l; }
    if (p.x < -14) p.x = l + 14;
    if (p.x > l + 14) p.x = -14;

    ctx2d.globalAlpha = Math.min(1, p.alpha * (0.8 + aigu * 0.7 + coup * 0.5));
    ctx2d.fillStyle = p.teinte;
    ctx2d.beginPath();
    ctx2d.arc(p.x, p.y, p.r * enfle, 0, Math.PI * 2);
    ctx2d.fill();
  }
  ctx2d.globalAlpha = 1;

  boucle = requestAnimationFrame(image);
}

export const visualiseur = {
  // Deux fonctions à fournir :
  //   niveaux       rend { grave, medium, aigu } ou null si pas d'analyse
  //   surPulsation  appelée à chaque image avec { grave, aigu, coup, actif },
  //                 pour qu'un jeu anime ses propres éléments sans sa propre
  //                 boucle — deux boucles fausseraient la détection des coups.
  demarrer(options = {}) {
    if (!DANS_NAVIGATEUR || canvas) return;
    lireNiveaux = options.niveaux || null;
    surPulsation = options.surPulsation || null;
    moyenneGrave = 0;
    coup = 0;

    canvas = document.createElement('canvas');
    canvas.className = 'fondAnime';
    ctx2d = canvas.getContext('2d');
    // Pas de contexte 2D : navigateur trop ancien, canevas désactivé, ou
    // environnement de test. On renonce au décor, jamais au reste.
    if (!ctx2d) { canvas = null; return; }
    document.body.append(canvas);
    // Le texte du jeu doit rester lisible quand une particule passe derrière.
    document.body.classList.add('avecFond');

    dimensionner();
    semer();
    window.addEventListener('resize', auRedimensionnement);
    boucle = requestAnimationFrame(image);
  },

  arreter() {
    if (!DANS_NAVIGATEUR) return;
    if (boucle) cancelAnimationFrame(boucle);
    boucle = null;
    window.removeEventListener('resize', auRedimensionnement);
    canvas?.remove();
    document.body.classList.remove('avecFond');
    canvas = null;
    ctx2d = null;
    particules = [];
    surPulsation = null;
    lireNiveaux = null;
  },
};

function auRedimensionnement() {
  dimensionner();
  semer();
}
