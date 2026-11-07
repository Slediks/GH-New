import {
  audioConfig,
  categoryLimits,
  sounds,
  type AudioCategory,
  type Point,
  type SoundProfile,
} from './audioConfig';
import { loadArenaSounds } from './audioBuffers';
import { attenuation, occluded } from './audioMath';
import type { Player } from './types';

interface Voice {
  kind: string;
  owner?: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter?: BiquadFilterNode;
  panner?: PannerNode;
  category: AudioCategory;
  point?: Point;
  profile: SoundProfile;
  local: boolean;
  level: number;
  score: number;
  blocked: boolean;
  checked: number;
  stop: () => void;
}
/** Match-owned Web Audio graph. No React playback, external services or audio loops. */
export class ArenaAudio {
  context: AudioContext | null = null;
  readonly ready: Promise<void>;
  private buffers = new Map<string, AudioBuffer>();
  private master?: GainNode;
  private effects?: GainNode;
  private flashFilter?: BiquadFilterNode;
  private categories = new Map<AudioCategory, GainNode>();
  private voices = new Set<Voice>();
  private lastVariant = new Map<string, number>();
  private position: Point = [0, 0, 0];
  private masterVolume = 0.35;
  private effectsVolume = 1;
  private flashImpairment = 0;
  private disposed = false;
  private visible = true;
  constructor(private boxes: number[][] = []) {
    document.addEventListener('pointerdown', this.resumeGesture, { capture: true });
    document.addEventListener('keydown', this.resumeGesture, { capture: true });
    document.addEventListener('visibilitychange', this.visibilityChanged);
    this.visible = !document.hidden;
    this.ready = loadArenaSounds()
      .then((buffers) => {
        if (!this.disposed) this.buffers = buffers;
      })
      .catch((error) => console.warn('[Arena audio] Preload unavailable', error));
  }
  private resumeGesture = () => {
    void this.unlock().catch((error) => console.warn('[Arena audio] Resume unavailable', error));
  };
  private visibilityChanged = () => this.visibility(!document.hidden);
  configure(master: number, effects: number) {
    this.masterVolume = Math.max(0, Math.min(1, master));
    this.effectsVolume = Math.max(0, Math.min(1, effects));
    const time = this.context?.currentTime ?? 0;
    this.master?.gain.setTargetAtTime(this.visible ? this.masterVolume : 0, time, 0.02);
    this.effects?.gain.setTargetAtTime(this.effectsVolume * (1 - this.flashImpairment * 0.82), time, 0.02);
  }
  setFlashImpairment(level: number) {
    this.flashImpairment = Math.max(0, Math.min(1, level));
    const c = this.context;
    if (c && this.effects)
      this.effects.gain.setTargetAtTime(this.effectsVolume * (1 - this.flashImpairment * 0.82),
        c.currentTime, 0.06);
    this.flashFilter?.frequency.setTargetAtTime(18000 - 17200 * this.flashImpairment,
      c?.currentTime ?? 0, 0.06);
  }
  flashRing(level: number) {
    if (this.effectsVolume > 0) this.play('flash-ring', undefined, level * this.effectsVolume);
  }
  async unlock() {
    if (this.disposed) return;
    if (!this.context) {
      const c = (this.context = new AudioContext({ latencyHint: 'interactive' }));
      this.master = c.createGain();
      this.effects = c.createGain();
      this.flashFilter = c.createBiquadFilter();
      this.flashFilter.type = 'lowpass';
      this.flashFilter.frequency.value = 18000;
      const compressor = c.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.knee.value = 12;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.15;
      // Last-resort smooth saturation bounds output even during a pathological burst.
      const safety = c.createWaveShaper(),
        curve = new Float32Array(4096);
      for (let i = 0; i < curve.length; i++)
        curve[i] = 0.97 * Math.tanh(((i / (curve.length - 1)) * 2 - 1) / 0.97);
      safety.curve = curve;
      safety.oversample = '2x';
      this.effects.connect(this.flashFilter).connect(this.master);
      this.master.connect(compressor).connect(safety).connect(c.destination);
      for (const category of Object.keys(categoryLimits) as AudioCategory[]) {
        const gain = c.createGain();
        gain.gain.value = category === 'weapons' ? 0.65 : 0.75;
        gain.connect(category === 'ui' ? this.master : this.effects);
        this.categories.set(category, gain);
      }
      this.configure(this.masterVolume, this.effectsVolume);
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }
  visibility(visible: boolean) {
    this.visible = visible;
    if (!visible) this.stopWorld();
    this.configure(this.masterVolume, this.effectsVolume);
    // A suspended context resumes only through a genuine user gesture (unlock).
  }
  listener(position: Point, forward: Point, up: Point) {
    this.position = position;
    const c = this.context;
    if (!c) return;
    const l = c.listener,
      t = c.currentTime;
    if (l.positionX) {
      [l.positionX, l.positionY, l.positionZ].forEach((p, i) => p.setValueAtTime(position[i], t));
      [l.forwardX, l.forwardY, l.forwardZ].forEach((p, i) => p.setValueAtTime(forward[i], t));
      [l.upX, l.upY, l.upZ].forEach((p, i) => p.setValueAtTime(up[i], t));
    } else {
      l.setPosition(...position);
      l.setOrientation(...forward, ...up);
    }
    for (const voice of this.voices)
      if (voice.point && t - voice.checked >= audioConfig.occlusionInterval) this.spatial(voice);
  }
  private spatial(v: Voice) {
    const c = this.context!;
    const distance = Math.hypot(...v.point!.map((n, i) => n - this.position[i]));
    v.blocked = occluded(this.position, v.point!, this.boxes);
    const level = attenuation(distance, v.profile) * (v.blocked ? audioConfig.wallGain : 1);
    v.gain.gain.setTargetAtTime(v.level * level, c.currentTime, 0.025);
    v.filter?.frequency.setTargetAtTime(
      v.blocked ? audioConfig.wallLowpass : audioConfig.openLowpass,
      c.currentTime,
      0.025,
    );
    v.score = v.profile.priority * level;
    v.checked = c.currentTime;
  }
  play(kind: string, point?: Point, level = 1, owner?: string, loop = false) {
    const c = this.context;
    if (!c || c.state !== 'running' || !this.visible || !this.masterVolume || this.disposed)
      return false;
    const profile: SoundProfile = sounds[kind] ?? {
      category: 'ui',
      files: [kind],
      gain: 0.5,
      reference: 1,
      distance: 1,
      rolloff: 1,
      priority: 5,
    };
    if (profile.category !== 'ui' && !this.effectsVolume) return false;
    const candidates = profile.files.filter((file) => this.buffers.has(file));
    if (!candidates.length) return false;
    const distance = point ? Math.hypot(...point.map((n, i) => n - this.position[i])) : 0;
    const volume = point ? attenuation(distance, profile) : 1;
    if (volume < 0.001) return false;
    const local = !point,
      score = local ? 100 + profile.priority : profile.priority * volume;
    const same = [...this.voices].filter((v) => v.category === profile.category);
    const pool =
      same.length >= categoryLimits[profile.category]
        ? same
        : this.voices.size >= audioConfig.voiceLimit
          ? [...this.voices]
          : [];
    if (pool.length) {
      const victim = pool
        .filter((v) => !v.local || v.category !== 'weapons')
        .sort((a, b) => a.score - b.score)[0];
      if (!victim || victim.score > score) return false;
      victim.stop();
    }
    let index = Math.floor(Math.random() * candidates.length);
    if (candidates.length > 1 && index === this.lastVariant.get(kind))
      index = (index + 1) % candidates.length;
    this.lastVariant.set(kind, index);
    const source = c.createBufferSource(),
      gain = c.createGain();
    source.buffer = this.buffers.get(candidates[index])!;
    source.loop = loop;
    source.playbackRate.value =
      profile.category === 'ui' ? 1 : 1 + (Math.random() * 2 - 1) * audioConfig.pitchVariation;
    const v: Voice = {
      kind,
      owner,
      source,
      gain,
      category: profile.category,
      point,
      profile,
      local,
      score,
      blocked: false,
      checked: -1,
      level: profile.gain * level * (1 + (Math.random() * 2 - 1) * audioConfig.gainVariation),
      stop: () => {},
    };
    const cleanup = () => {
      this.voices.delete(v);
      source.onended = null;
      source.disconnect();
      gain.disconnect();
      v.filter?.disconnect();
      v.panner?.disconnect();
    };
    v.stop = () => {
      source.stop();
      cleanup();
    };
    source.onended = cleanup;
    source.connect(gain);
    gain.gain.value = v.level;
    if (point) {
      const filter = (v.filter = c.createBiquadFilter());
      filter.type = 'lowpass';
      filter.frequency.value = occluded(this.position, point, this.boxes)
        ? audioConfig.wallLowpass
        : audioConfig.openLowpass;
      const pan = (v.panner = c.createPanner());
      pan.panningModel = 'HRTF';
      pan.distanceModel = 'inverse';
      pan.rolloffFactor = 0; // Our smooth profile is applied once.
      pan.positionX.value = point[0];
      pan.positionY.value = point[1];
      pan.positionZ.value = point[2];
      gain.connect(filter).connect(pan).connect(this.categories.get(profile.category)!);
      gain.gain.value =
        v.level * volume * (occluded(this.position, point, this.boxes) ? audioConfig.wallGain : 1);
      this.spatial(v);
    } else gain.connect(this.categories.get(profile.category)!);
    this.voices.add(v);
    source.start();
    return true;
  }
  loop(kind: string, point: Point, owner: string) {
    if ([...this.voices].some((v) => v.kind === kind && v.owner === owner)) return;
    this.play(kind, point, 1, owner, true);
  }
  stopLoopsExcept(kind: string, owners: Set<string>) {
    for (const voice of [...this.voices])
      if (voice.kind === kind && voice.owner && !owners.has(voice.owner)) voice.stop();
  }
  updatePlayers(players: Player[], worldAllowed: boolean) {
    for (const v of [...this.voices]) {
      if (v.point && !worldAllowed) {
        v.stop();
        continue;
      }
      if (!v.owner || !v.kind.startsWith('reload-')) continue;
      const player = players.find((p) => p.id === v.owner);
      if (
        !player?.alive ||
        !player.connected ||
        !player.reloading ||
        v.kind !== `reload-${player.weapon}`
      ) {
        v.stop();
        continue;
      }
      if (v.point && v.panner) {
        v.point = [player.x, player.y + (player.crouched ? 1.02 : 1.62), player.z];
        v.panner.positionX.value = v.point[0];
        v.panner.positionY.value = v.point[1];
        v.panner.positionZ.value = v.point[2];
      }
    }
  }
  stopWorld() {
    for (const v of [...this.voices]) if (v.category !== 'ui') v.stop();
  }
  // Read-only diagnostics for automated checks/dev tools; never exposed in player UI.
  diagnostics() {
    return {
      active: this.voices.size,
      buffers: this.buffers.size,
      listener: this.position,
      occluded: [...this.voices].filter((v) => v.blocked).length,
      categories: Object.fromEntries(
        Object.keys(categoryLimits).map((k) => [
          k,
          [...this.voices].filter((v) => v.category === k).length,
        ]),
      ),
    };
  }
  dispose() {
    this.disposed = true;
    document.removeEventListener('pointerdown', this.resumeGesture, { capture: true });
    document.removeEventListener('keydown', this.resumeGesture, { capture: true });
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    for (const v of [...this.voices]) v.stop();
    this.categories.clear();
    this.buffers = new Map();
    void this.context?.close();
    this.context = null;
  }
}
