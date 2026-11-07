import type { Page } from '@playwright/test';

/** Test-only observation of native Web Audio. No production debug endpoints or UI. */
export async function installAudioProbe(page: Page) {
  await page.addInitScript(() => {
    const probe = ((window as any).__audioProbe = {
      starts: [] as any[],
      contexts: [] as AudioContext[],
      nodes: 0,
      listener: [] as number[],
    });
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(options?: AudioContextOptions) {
        super(options);
        probe.contexts.push(this);
        [this.listener.positionX, this.listener.positionY, this.listener.positionZ].forEach(
          (param, i) => {
            const set = param.setValueAtTime.bind(param);
            param.setValueAtTime = (value, time) => {
              probe.listener[i] = value;
              return set(value, time);
            };
          },
        );
      }
    };
    const links = new WeakMap<AudioNode, AudioNode[]>();
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (...args: any[]) {
      if (args[0] instanceof AudioNode) links.set(this, [...(links.get(this) ?? []), args[0]]);
      return (connect as any).apply(this, args);
    };
    const create = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function () {
      const source = create.call(this),
        start = source.start;
      source.start = function (...args: any[]) {
        const queue: AudioNode[] = [source],
          seen = new Set<AudioNode>();
        let pan: PannerNode | undefined,
          filter: BiquadFilterNode | undefined,
          gain: GainNode | undefined;
        while (queue.length) {
          const n = queue.shift()!;
          if (seen.has(n)) continue;
          seen.add(n);
          if (n instanceof PannerNode) pan = n;
          if (n instanceof BiquadFilterNode) filter = n;
          if (!gain && n instanceof GainNode) gain = n;
          queue.push(...(links.get(n) ?? []));
        }
        probe.starts.push({
          at: performance.now(),
          duration: source.buffer?.duration,
          position: pan ? [pan.positionX.value, pan.positionY.value, pan.positionZ.value] : null,
          gain: gain?.gain.value,
          cutoff: filter?.frequency.value,
        });
        probe.nodes++;
        source.addEventListener('ended', () => probe.nodes--, { once: true });
        return (start as any).apply(source, args);
      };
      return source;
    };
  });
}
