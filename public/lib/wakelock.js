// Empêche la mise en veille de l'écran tant que la page est ouverte.
// Screen Wake Lock quand le navigateur l'expose (HTTPS ou localhost) ; sinon repli NoSleep (vidéo muette en boucle),
// qui fonctionne aussi en HTTP sur le réseau local mais exige un geste de l'utilisateur.

// Le verrou natif est libéré par le navigateur quand la page est masquée : on le redemande au retour.
function nativeWakeLock() {
  let sentinel = null;

  async function acquire() {
    if (sentinel || document.visibilityState !== 'visible') return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        sentinel = null;
      });
    } catch {
      sentinel = null;
    }
  }

  document.addEventListener('visibilitychange', acquire);
  // Le navigateur exige souvent un geste de l'utilisateur : on réessaie aux premières interactions.
  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, acquire);
  acquire();
}

function noSleepFallback() {
  if (typeof window.NoSleep !== 'function') return;
  const noSleep = new window.NoSleep();
  const gestures = ['pointerdown', 'touchend', 'click', 'keydown'];

  // La vidéo est mise en pause quand la page est masquée : on la relance au prochain geste.
  let active = false;
  async function enable() {
    if (active || document.visibilityState !== 'visible') return;
    try {
      await noSleep.enable();
      active = true;
    } catch {
      active = false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') active = false;
  });
  for (const type of gestures) document.addEventListener(type, enable);
}

export function keepScreenAwake() {
  if ('wakeLock' in navigator) nativeWakeLock();
  else noSleepFallback();
}
