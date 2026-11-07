import type { ArenaAudio } from './audio';
import { audioConfig, type Point } from './audioConfig';
import type { GameEvent, Player, Snapshot, Weapon } from './types';

/** A burst token plus authoritative shot ordinal identifies prediction echoes exactly. */
export class ShotPrediction {
  burst = 0;
  private next = 0;
  private pending = 0;
  reconcile() {
    this.pending = 0;
  }
  private bursts = new Map<number, { predicted: number; confirmed: number }>();
  start(id: number) {
    this.burst = id;
    this.bursts.set(id, { predicted: 0, confirmed: 0 });
    if (this.bursts.size > 64) this.bursts.delete(this.bursts.keys().next().value!);
  }
  predict(
    now: number,
    player: Player,
    weapon: Weapon,
    selected: string,
    blocked: boolean,
    tick: number,
  ) {
    const entry = this.bursts.get(this.burst);

    if (
      !entry ||
      !player.alive ||
      player.reloading ||
      blocked ||
      player.weapon !== selected ||
      (player.ammo?.[selected]?.[0] ?? 0) <= this.pending ||
      now < this.next
    )
      return false;
    entry.predicted++;
    this.pending++;
    this.next = now + Math.ceil(weapon.interval / tick) * tick * 1000;
    return true;
  }
  echo(event: GameEvent) {
    const entry = event.fire_id == null ? undefined : this.bursts.get(event.fire_id);
    if (!entry || !event.fire_index) return false;
    const duplicate = event.fire_index <= entry.predicted;
    entry.confirmed = Math.max(entry.confirmed, event.fire_index);
    entry.predicted = Math.max(entry.predicted, event.fire_index);
    return duplicate;
  }
  clear() {
    this.bursts.clear();
    this.burst = 0;
    this.next = 0;
    this.pending = 0;
  }
}

export class ArenaSoundEvents {
  prediction = new ShotPrediction();
  private last = 0;
  private fresh = true;
  private match = '';
  private clockOffset = Infinity;
  reset() {
    this.fresh = true;
    this.clockOffset = Infinity;
    this.prediction.clear();
  }
  consume(
    s: Snapshot,
    self: string,
    audibleWorld: boolean,
    audio: Pick<ArenaAudio, 'play'>,
    now = performance.now() / 1000,
  ) {
    if (this.match !== s.id) {
      this.reset();
      this.match = s.id;
    }
    let queueAge = 0;
    if (s.sent_at !== undefined && Number.isFinite(s.sent_at)) {
      const offset = now - s.sent_at;
      this.clockOffset = Math.min(this.clockOffset, offset);
      queueAge = Math.max(0, offset - this.clockOffset);
    }
    if (this.fresh) {
      this.last = Math.max(0, ...s.events.map((e) => e.id));
      this.fresh = false;
      return;
    }
    this.prediction.reconcile();
    const me = s.players.find((p) => p.id === self);
    for (const e of s.events) {
      if (e.id <= this.last) continue;
      this.last = e.id;
      if (s.time - e.time + queueAge > audioConfig.maxEventAge || e.time > s.time) continue;
      const own = e.player === self;
      const point =
        e.start?.length === 3 && e.start.every(Number.isFinite)
          ? (e.start as unknown as Point)
          : undefined;
      if (e.kind === 'shot') {
        const duplicate = own && this.prediction.echo(e);
        if (!duplicate && (own || audibleWorld) && (own || point))
          audio.play(e.weapon ?? 'rifle', own ? undefined : point);
      } else if (e.kind === 'hit' && own) audio.play(e.head ? 'head' : 'hit');
      else if (e.kind === 'dry' && own) audio.play('dry');
      else if (e.kind === 'reload' && (own || audibleWorld) && (own || point))
        audio.play(`reload-${e.weapon ?? 'rifle'}`, own ? undefined : point, 1, e.player);
      else if (e.kind === 'grenade_throw' && !own && audibleWorld && point)
        audio.play('grenade-throw', point);
      else if (e.kind === 'grenade_bounce' && audibleWorld && e.position?.length === 3)
        audio.play('grenade-bounce', e.position as unknown as Point);
      else if (e.kind === 'grenade_explode' && audibleWorld && e.position?.length === 3)
        audio.play('grenade-explosion', e.position as unknown as Point);
      else if (e.kind === 'grenade_flash_detonate' && audibleWorld && e.position?.length === 3)
        audio.play('flash-detonate', e.position as unknown as Point);
      else if (e.kind === 'grenade_smoke' && audibleWorld && e.position?.length === 3)
        audio.play('grenade-smoke', e.position as unknown as Point);
      else if (e.kind === 'molotov_break' && audibleWorld && e.position?.length === 3)
        audio.play('molotov-break', e.position as unknown as Point);
      else if (e.kind === 'fire_spawn' && audibleWorld && e.position?.length === 3)
        audio.play('fire-ignite', e.position as unknown as Point);
      else if (e.kind === 'fire_remove' && audibleWorld && e.position?.length === 3)
        audio.play('fire-end', e.position as unknown as Point);
      else if (['step', 'jump', 'land'].includes(e.kind) && (own || audibleWorld) && (own || point))
        audio.play(e.kind, own ? undefined : point, e.level ?? 1);
      else if (e.kind === 'kill') {
        if (e.victim === self) audio.play('death');
        else if (audibleWorld && point) audio.play('death', point);
        if (e.killer === self) audio.play('confirm');
      } else if (e.kind === 'round_end')
        audio.play(e.winner === me?.team ? 'round_win' : 'round_loss');
      else if (['round', 'countdown', 'finished'].includes(e.kind)) audio.play(e.kind);
    }
  }
}
