// Empêche la mise en veille de l'écran tant que la page est ouverte (Screen Wake Lock API).
// Le verrou est libéré par le navigateur quand la page est masquée : on le redemande au retour.
export function keepScreenAwake() {
  if (!('wakeLock' in navigator)) return;
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
