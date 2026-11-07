import { sounds } from './audioConfig';
let cached: Promise<Map<string, AudioBuffer>> | undefined;
/** Decode once, before loaded acknowledgement, without starting a live AudioContext. */
export function loadArenaSounds() {
  return (cached ??= (async () => {
    const result = new Map<string, AudioBuffer>();
    const decoder = new OfflineAudioContext(1, 1, 48000);
    await Promise.all(
      [...new Set(Object.values(sounds).flatMap((s) => s.files))].map(async (url) => {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          result.set(url, await decoder.decodeAudioData(await response.arrayBuffer()));
        } catch (error) {
          console.warn(`[Arena audio] Cannot load ${url}`, error);
        }
      }),
    );
    // Short non-positional UI cues, separate from the recorded gameplay sounds.
    for (const [name, frequency] of Object.entries({
      hit: 700,
      head: 1100,
      confirm: 950,
      round: 550,
      countdown: 450,
      finished: 820,
      round_win: 900,
      round_loss: 220,
    })) {
      const buffer = decoder.createBuffer(1, 9600, 48000),
        data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / 48000;
        data[i] =
          Math.sin(t * frequency * Math.PI * 2) * Math.min(1, t / 0.005) * Math.exp(-t * 25) * 0.25;
      }
      result.set(name, buffer);
    }
    return result;
  })());
}
