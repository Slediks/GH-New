type Sample = { time: number; value: number };
const BUFFER = { intervals: 1.5, capacity: 64, minimumSpeed: 0.85, maximumSpeed: 1.15 };

/** Delayed server timeline, not a queue of packet-triggered animations.
 * Log-space interpolation follows the curve without per-packet easing.
 * A prolonged outage holds the last confirmed point instead of predicting outcomes.
 */
export class FlightTimeline {
  private samples: Sample[] = [];
  private cursor = 0;
  private interval = 0;
  private lastFrame: number | null = null;
  private phase = '';
  private speed = 1;
  value = 100;

  receive(phase: string, multiplier: number, serverTimeMs: number) {
    const value = Math.max(100, multiplier);
    if (!this.samples.length || phase === 'betting') {
      this.samples = [{ time: serverTimeMs, value: phase === 'betting' ? 100 : value }];
      this.cursor = serverTimeMs;
      this.value = this.samples[0].value;
      this.interval = 0;
      this.speed = 1;
      this.lastFrame = null;
    } else if (phase === 'live') {
      const previous = this.samples.at(-1)!;
      if (serverTimeMs > previous.time && value >= previous.value) {
        const gap = serverTimeMs - previous.time;
        this.interval = this.interval ? this.interval * 0.8 + gap * 0.2 : gap;
        this.samples.push({ time: serverTimeMs, value });
        if (this.samples.length > BUFFER.capacity) this.samples.shift();
      }
    }
    // Final labels/colour change without teleporting the in-flight craft.
    this.phase = phase;
  }

  frame(now: number) {
    const delta = this.lastFrame === null ? 0 : Math.max(0, now - this.lastFrame);
    this.lastFrame = now;
    if (this.phase !== 'live' || this.samples.length < 2) return this.value;
    const latest = this.samples.at(-1)!;
    const desiredBuffer = this.interval * BUFFER.intervals;
    const wantedSpeed = Math.min(
      BUFFER.maximumSpeed,
      Math.max(BUFFER.minimumSpeed, (latest.time - this.cursor) / desiredBuffer),
    );
    this.speed += (wantedSpeed - this.speed) * (1 - Math.exp(-delta / desiredBuffer));
    this.cursor = Math.min(latest.time, this.cursor + delta * this.speed);
    while (this.samples.length > 2 && this.samples[1].time <= this.cursor) this.samples.shift();
    const [from, to] = this.samples;
    const fraction = Math.min(1, Math.max(0, (this.cursor - from.time) / (to.time - from.time)));
    this.value = Math.max(
      this.value,
      Math.exp(Math.log(from.value) + (Math.log(to.value) - Math.log(from.value)) * fraction),
    );
    return this.value;
  }

  snapToLatest() {
    if (this.phase === 'result') return this.value;
    this.cursor = this.samples.at(-1)?.time ?? this.cursor;
    this.value = this.samples.at(-1)?.value ?? this.value;
    return this.value;
  }

  resetFrameClock() {
    this.lastFrame = null;
  }
}
