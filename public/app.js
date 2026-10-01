const socket = io();
const $ = (id) => document.getElementById(id);

// --- identite persistante : permet de retrouver sa place apres un F5 --------
let playerId = localStorage.getItem('playerId');
if (!playerId) {
  playerId = Math.random().toString(36).slice(2, 10);
  localStorage.setItem('playerId', playerId);
}
const savedPseudo = localStorage.getItem('pseudo') || '';
$('pseudo').value = savedPseudo;

let state = null;
let audioReady = false;
let scheduledIndex = -1;
let playTimer = null;
let barTimer = null;

const audio = new Audio();
audio.preload = 'auto';
// Pas de crossOrigin ici : les previews iTunes n'envoient pas d'en-tete CORS,
// et le reclamer ferait echouer le chargement. Il ne serait utile que pour
// analyser le son via la Web Audio API.

// Lecteur distinct pour les ecoutes de la phase de selection : il ne doit
// jamais entrer en conflit avec celui de la partie.
const preview = new Audio();
preview.preload = 'none';
let previewKey = null;

// --- volume -----------------------------------------------------------------
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
  audio.volume = v / 100;
  preview.volume = v / 100;
  $('volIcon').textContent = v === 0 ? '🔇' : v < 50 ? '🔈' : '🔊';
  try { localStorage.setItem('volume', String(v)); } catch {}
}

if (volumeSupported()) {
  let saved = 80;
  try {
    const v = localStorage.getItem('volume');
    if (v !== null && !Number.isNaN(Number(v))) saved = Number(v);
  } catch {}
  $('volume').value = saved;
  applyVolume(saved);
  $('volume').oninput = (e) => applyVolume(e.target.value);
} else {
  $('volBox').style.display = 'none';
}

// --- synchronisation d'horloge ---------------------------------------------
// Chaque navigateur a sa propre heure. On estime le decalage avec le serveur
// pour que tout le monde demarre le son au meme instant reel.
let clockOffset = 0;
function serverNow() { return Date.now() + clockOffset; }

async function syncClock() {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const serverTime = await new Promise((res) => socket.emit('time:sync', res));
    const t1 = Date.now();
    samples.push(serverTime + (t1 - t0) / 2 - t1);
  }
  samples.sort((a, b) => a - b);
  clockOffset = samples[2]; // mediane : ignore les aller-retours anormaux
}

// --- deblocage de l'autoplay ------------------------------------------------
// Les navigateurs refusent de jouer du son tant que l'utilisateur n'a pas
// interagi avec la page. On joue un echantillon silencieux sur le premier clic.
const SILENCE = 'data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAABAAABSAAA';
function unlockAudio() {
  if (audioReady) return;
  const a = new Audio(SILENCE);
  a.play().then(() => { audioReady = true; }).catch(() => {});
  audio.play().then(() => { audio.pause(); audioReady = true; }).catch(() => {});
}
document.addEventListener('click', unlockAudio, { once: false });

// --- ecoute pendant la selection --------------------------------------------
// La cle est l'URL : un meme morceau present dans les resultats ET dans ta
// selection affiche donc l'etat lecture sur les deux boutons, ce qui est juste.
function stopPreview() {
  preview.pause();
  previewKey = null;
  document.querySelectorAll('.play').forEach((b) => { b.textContent = '▶'; });
}
preview.onended = stopPreview;

function makePlayButton(url) {
  const b = document.createElement('button');
  b.className = 'play';
  b.type = 'button';
  b.setAttribute('aria-label', 'Écouter un extrait');
  // L'etat est recalcule a chaque rendu : la liste est reconstruite des qu'un
  // joueur ajoute un morceau, et l'extrait en cours doit garder son icone.
  b.textContent = previewKey === url ? '⏸' : '▶';
  b.onclick = (e) => {
    e.stopPropagation();   // sinon un clic sur ▶ ajouterait aussi le morceau
    if (previewKey === url) return stopPreview();
    stopPreview();
    previewKey = url;
    preview.src = url;
    preview.currentTime = 0;
    preview.play()
      .then(() => { b.textContent = '⏸'; })
      .catch(() => { stopPreview(); toast('Extrait indisponible'); });
  };
  return b;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 3000);
}

function show(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
}

// --- accueil ----------------------------------------------------------------
$('btnCreate').onclick = () => {
  const pseudo = $('pseudo').value.trim();
  if (!pseudo) return toast('Choisis un pseudo');
  localStorage.setItem('pseudo', pseudo);
  socket.emit('room:create', { pseudo, playerId });
};

$('btnJoin').onclick = () => {
  const pseudo = $('pseudo').value.trim();
  const code = $('joinCode').value.trim().toUpperCase();
  if (!pseudo) return toast('Choisis un pseudo');
  if (code.length !== 4) return toast('Code à 4 lettres');
  localStorage.setItem('pseudo', pseudo);
  socket.emit('room:join', { code, pseudo, playerId });
};

$('btnPicking').onclick = () => socket.emit('phase:picking');
$('btnReady').onclick = () => socket.emit('player:ready', { ready: !state?.myReady });
$('btnStart').onclick = () => socket.emit('game:start');
$('btnSkip').onclick = () => socket.emit('round:skip');

// --- recherche (debounce : l'API iTunes plafonne vers 20 appels/minute) -----
let searchTimer = null;
$('search').oninput = (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) return ($('results').innerHTML = '');
  searchTimer = setTimeout(() => runSearch(q), 350);
};

async function runSearch(q) {
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const tracks = await r.json();
    if (!Array.isArray(tracks)) throw new Error();
    $('results').innerHTML = '';
    for (const t of tracks) {
      const li = document.createElement('li');
      li.innerHTML = `<img src="${t.artwork}" alt="">
        <div class="info"><div class="t"></div><div class="a"></div></div>`;
      li.querySelector('.t').textContent = t.title;
      li.querySelector('.a').textContent = t.artist;
      li.appendChild(makePlayButton(t.previewUrl));
      li.onclick = () => {
        stopPreview();
        socket.emit('track:submit', t);
        $('search').value = '';
        $('results').innerHTML = '';
      };
      $('results').appendChild(li);
    }
  } catch {
    toast('Recherche indisponible');
  }
}

// --- rendu ------------------------------------------------------------------
socket.on('room:joined', ({ code, playerId: id }) => {
  playerId = id;
  localStorage.setItem('playerId', id);
  $('roomCode').textContent = code;
  $('lobbyCode').textContent = code;
  syncClock();
});

socket.on('error:msg', toast);

socket.on('room:state', (s) => {
  state = s;
  $('roomCode').textContent = s.code;
  $('lobbyCode').textContent = s.code;

  if (s.phase !== 'PLAYING') stopAudio();
  // Sans ca, un extrait lance pendant la selection continuerait par-dessus le
  // premier morceau de la partie.
  if (s.phase !== 'PICKING') stopPreview();

  if (s.phase === 'LOBBY') renderLobby(s);
  if (s.phase === 'PICKING') renderPicking(s);
  if (s.phase === 'PLAYING') renderPlaying(s);
  if (s.phase === 'REVEAL') renderReveal(s);
  if (s.phase === 'SCORES') renderScores(s);
});

function playerList(s, withCount) {
  return s.players
    .map((p) => `<li class="${p.connected ? '' : 'off'}">
      <span>${esc(p.pseudo)}${p.isHost ? ' 👑' : ''}</span>
      <span class="meta">${withCount ? `${p.trackCount}/${s.config.maxTracks}${p.ready ? ' ✓' : ''}` : `${p.score} pts`}</span>
    </li>`)
    .join('');
}

const esc = (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function renderLobby(s) {
  show('lobby');
  $('lobbyPlayers').innerHTML = playerList(s, false);
  $('btnPicking').style.display = s.youAreHost ? 'block' : 'none';
  $('btnPicking').disabled = s.players.length < 2;
}

function renderPicking(s) {
  show('picking');
  const n = s.mySubmissions.length;
  $('pickHint').textContent = `Entre ${s.config.minTracks} et ${s.config.maxTracks} morceaux — tu en as ${n}.`;
  $('search').disabled = n >= s.config.maxTracks || s.myReady;

  $('mine').innerHTML = '';
  for (const m of s.mySubmissions) {
    const li = document.createElement('li');
    li.innerHTML = `<img src="${m.artwork}" alt="">
      <div class="info"><div class="t"></div><div class="a"></div></div>`;
    li.querySelector('.t').textContent = m.title;
    li.querySelector('.a').textContent = m.artist;
    li.appendChild(makePlayButton(m.previewUrl));

    const del = document.createElement('button');
    del.textContent = 'Retirer';
    del.onclick = () => {
      if (previewKey === m.previewUrl) stopPreview();
      socket.emit('track:remove', { id: m.id });
    };
    li.appendChild(del);
    $('mine').appendChild(li);
  }

  $('pickPlayers').innerHTML = playerList(s, true);

  $('btnReady').disabled = n < s.config.minTracks;
  $('btnReady').textContent = s.myReady ? '✓ Prêt — annuler' : 'Je suis prêt';
  $('btnReady').classList.toggle('primary', !s.myReady && n >= s.config.minTracks);

  $('btnStart').style.display = s.youAreHost ? 'block' : 'none';
  $('btnStart').disabled = !s.canStart;
  $('btnStart').textContent = s.canStart
    ? 'Démarrer la partie'
    : `En attente de ${s.waitingFor.join(', ') || '…'}`;
}

function renderPlaying(s) {
  show('playing');
  const r = s.round;
  $('roundCounter').textContent = `Morceau ${r.index} / ${r.total}`;
  $('art').src = r.artwork;
  $('trackTitle').textContent = r.title;
  $('trackArtist').textContent = r.artist;

  if (!r.canVote) {
    $('voteStatus').textContent = "C'est ton morceau — croise les doigts.";
  } else if (r.myVote) {
    $('voteStatus').textContent = `Vote enregistré (${r.votedCount}/${r.expectedVotes}) — on écoute la fin`;
  } else {
    $('voteStatus').textContent = 'Qui a mis ça ?';
  }

  $('suspects').innerHTML = '';
  for (const p of r.suspects) {
    const b = document.createElement('button');
    b.textContent = p.pseudo;
    b.disabled = !r.canVote || !!r.myVote;
    if (r.myVote === p.id) b.classList.add('picked');
    b.onclick = () => socket.emit('vote:cast', { suspectId: p.id });
    $('suspects').appendChild(b);
  }

  schedulePlayback(r);
}

function schedulePlayback(r) {
  if (scheduledIndex === r.index) return; // deja programme pour ce tour
  scheduledIndex = r.index;

  clearTimeout(playTimer);
  audio.src = r.previewUrl;
  audio.load();

  const wait = Math.max(0, r.startAt - serverNow());
  playTimer = setTimeout(() => {
    audio.currentTime = 0;
    audio.play().catch(() => toast('Touche l\'écran pour activer le son'));
  }, wait);

  clearInterval(barTimer);
  barTimer = setInterval(() => {
    const left = r.voteEndsAt - serverNow();
    const total = r.voteEndsAt - r.startAt;
    $('barFill').style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
  }, 250);
}

function stopAudio() {
  clearTimeout(playTimer);
  clearInterval(barTimer);
  scheduledIndex = -1;
  audio.pause();
}

function renderReveal(s) {
  show('reveal');
  const v = s.reveal;
  $('revealArt').src = v.artwork;
  $('revealTitle').textContent = `${v.title} — ${v.artist}`;
  $('revealOwner').innerHTML = `C'était <strong>${esc(v.owners.join(' et '))}</strong>`;

  $('revealVotes').innerHTML = v.votes
    .map((x) => `<li>
      <span>${esc(x.voterPseudo)} → ${esc(x.suspectPseudo)}</span>
      <span class="${x.correct ? 'good' : 'wrong'}">${x.correct ? '+100' : '✗'}</span>
    </li>`)
    .join('') || '<li><span>Personne n\'a voté</span><span></span></li>';

  $('revealScores').innerHTML = v.scores
    .map((p) => `<li>
      <span>${esc(p.pseudo)}</span>
      <span>${p.delta ? `<span class="good">+${p.delta}</span> → ` : ''}${p.score} pts</span>
    </li>`)
    .join('');

  $('btnSkip').style.display = s.youAreHost ? 'block' : 'none';
  $('btnSkip').textContent = v.isLast ? 'Voir le classement' : 'Morceau suivant';

  const host = s.players.find((p) => p.isHost);
  $('revealWait').textContent = s.youAreHost
    ? ''
    : `En attente de ${host ? host.pseudo : "l'hôte"}…`;
}

function renderScores(s) {
  show('scores');
  $('ranking').innerHTML = s.ranking
    .map((p, i) => `<li><span>${i + 1}. ${esc(p.pseudo)}</span><span>${p.score} pts</span></li>`)
    .join('');
}

show('home');
