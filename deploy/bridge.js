/* Trusted wrapper injected by nginx. Game messages only attest input, never points. */
(() => {
  const session = new URLSearchParams(location.hash.slice(1)).get('session');
  if (!session) return;
  const signal = () => parent.postMessage({type: 'gamehub:input', session}, '*');
  ['pointerdown', 'keydown', 'touchstart'].forEach(type => addEventListener(type, signal, {passive: true}));
})();
