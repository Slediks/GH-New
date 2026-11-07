// Local synthesized sounds: no audio downloads, CDN or autoplay before interaction.
let context: AudioContext | null = null;
export function casinoSound(kind: 'click' | 'result') {
  if (localStorage.getItem('casino-sound') !== 'on') return;
  if (!context) {
    if (!navigator.userActivation?.hasBeenActive) return;
    context = new AudioContext();
  }
  void context
    .resume()
    .then(() => {
      if (!context || localStorage.getItem('casino-sound') !== 'on') return;
      const oscillator = context.createOscillator(),
        gain = context.createGain();
      const duration = kind === 'click' ? 0.07 : 0.22;
      oscillator.frequency.value = kind === 'click' ? 440 : 660;
      oscillator.type = 'sine';
      gain.gain.value = 0.04;
      oscillator.connect(gain);
      gain.connect(context.destination);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    })
    .catch(() => {
      /* Browsers may suspend audio; gameplay must stay available. */
    });
}
