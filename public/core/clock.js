// ---------------------------------------------------------------------------
// Synchronisation d'horloge.
//
// Chaque navigateur a sa propre heure. On estime le decalage avec le serveur
// pour que tout le monde declenche la meme chose au meme instant reel : un
// depart de musique, un compte a rebours, l'apparition d'un indice.
//
// Service de plateforme : n'importe quel jeu peut s'en servir via api.now().
// ---------------------------------------------------------------------------
let offset = 0;

export const now = () => Date.now() + offset;

export async function sync(socket, samples = 5) {
  const deltas = [];
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    // eslint-disable-next-line no-await-in-loop
    const serverTime = await new Promise((res) => socket.emit('time:sync', res));
    const t1 = Date.now();
    deltas.push(serverTime + (t1 - t0) / 2 - t1);
  }
  deltas.sort((a, b) => a - b);
  offset = deltas[Math.floor(deltas.length / 2)]; // mediane : ignore les pics
  return offset;
}
