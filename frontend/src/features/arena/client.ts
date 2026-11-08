import { reloadAcknowledged } from './reload';
import { effectiveSensitivity } from './preferences';
import { scopeActive } from './scope';
import { io, type Socket } from 'socket.io-client';
import { api } from '../../shared/api';
import { ArenaInput } from './input';
import { ArenaAudio } from './audio';
import { ArenaSoundEvents } from './audioEvents';
import { FlashEffect } from './flashEffect';
import { Vector3 } from 'three';
import { SpectatorController } from './spectator';
import { canStand } from './movement';
import { LocalMovement, MOVEMENT_SEND_HZ } from './localMovement';
import { RemoteMovement, INTERPOLATION_MS } from './remoteMovement';
import { ArenaScene } from './scene';
import type { Input, Manifest, Preferences, Room, Snapshot } from './types';

export class ArenaClient {
  scene: ArenaScene;
  input: ArenaInput;
  audio: ArenaAudio;
  soundEvents = new ArenaSoundEvents();
  flashEffect = new FlashEffect();
  private serverClockOffset = Infinity;
  private lastRound = 0;
  audioForward = new Vector3();
  audioUp = new Vector3();
  requestFire() {
    this.fire = true;
    this.soundEvents.prediction.start(++this.seq);
    this.predictFire();
  }
  predictFire() {
    const me = this.snapshot?.players.find((p) => p.id === this.self);
    if (
      me &&
      this.connected &&
      this.fire &&
      this.locked() &&
      this.snapshot?.phase === 'active' &&
      this.soundEvents.prediction.predict(
        performance.now(),
        me,
        this.manifest.weapons[this.weapon],
        this.weapon,
        this.reload,
        this.manifest.tick,
      )
    )
      this.audio.play(this.weapon);
  }
  socket: Socket | null = null;
  snapshot: Snapshot | null = null;
  remoteViews: import('./types').Player[] = [];
  local = new LocalMovement();
  remote = new RemoteMovement();
  diagnostics = {
    frames: 0,
    frameMsMax: 0,
    frameSpikes: 0,
    sent: 0,
    snapshotAgeMs: 0,
    interpolationMs: INTERPOLATION_MS,
    movementMsMax: 0,
    renderMsMax: 0,
    audioMsMax: 0,
  };
  keys = new Set<string>();
  get position() {
    return this.local.position;
  }
  yaw = 0;
  pitch = 0;
  seq = 0;
  fire = false;
  reload = false;
  reloadAfterSeq = 0;
  reloadWeapon = '';
  requestReload() {
    this.reload = true;
    this.reloadAfterSeq = this.seq + 1;
    this.reloadWeapon = this.weapon;
    this.aimHeld = false;
  }
  weapon = 'rifle';
  grenadeSlot = false;
  grenadeType: 'frag' | 'smoke' | 'flash' | 'molotov' = 'frag';
  grenadeSequence = 0;
  pendingGrenade: { kind: 'frag' | 'smoke' | 'flash' | 'molotov'; sequence: number; requestedAt: number } | null = null;
  throwGrenade() {
    const me = this.snapshot?.players.find((p) => p.id === this.self);
    const kind = this.grenadeType;
    if (!this.connected || !this.locked() || this.snapshot?.phase !== 'active' || !me?.alive ||
      (me.grenades?.[kind] ?? 0) <= 0 || this.pendingGrenade) return;
    const sequence = ++this.grenadeSequence;
    this.pendingGrenade = { kind, sequence, requestedAt: performance.now() };
    this.aimHeld = false;
    this.fire = false;
    this.grenadeSlot = false;
    this.scene.predictGrenade(kind, sequence, this.self, this.position, this.yaw, this.pitch);
    this.audio.play('grenade-throw');
  }
  lastEvent = 0;
  spectatorController = new SpectatorController();
  get spectator() {
    return this.spectatorController.target;
  }
  aimHeld = false;
  lastPresentation = '';
  canStand() {
    return canStand(
      this.position,
      this.manifest,
      this.snapshot?.players.filter((p) => p.id !== this.self),
    );
  }
  scoped() {
    const me = this.snapshot?.players.find((p) => p.id === this.self);
    return scopeActive(
      this.aimHeld,
      this.locked(),
      this.snapshot?.phase,
      this.weapon,
      this.reload,
      me,
    );
  }

  cycleSpectator(direction: number) {
    this.spectatorController.update(
      this.snapshot?.players ?? [],
      this.self,
      this.room.settings.mode,
      direction,
    );
  }
  fresh = true;
  stopped = false;
  replaced = false;
  frame = 0;
  tick: ReturnType<typeof setInterval>;
  retry: ReturnType<typeof setTimeout> | undefined;
  lastFrame = performance.now();

  connected = false;
  constructor(
    public canvas: HTMLCanvasElement,
    public manifest: Manifest,
    public room: Room,
    public self: string,
    public prefs: Preferences,
    public onState: (state: Snapshot) => void,
    public onLock: (locked: boolean) => void,
    public onError: (error: string) => void,
    public onTab: (show: boolean) => void,
    public onHit: (head: boolean) => void,
    public onPresentation: (scope: boolean, target: string) => void,
    public onEscapeMenu: () => void = () => {},
  ) {
    // Read-only developer probe; no mutation hooks, packet delays or gameplay overrides.
    Object.defineProperty(canvas, 'arenaDiagnostics', {
      configurable: true,
      value: () => ({
        ...this.diagnostics,
        local: { ...this.position },
        resets: this.local.resets,
        epoch: this.local.epoch,
        remote: this.remoteViews.map((p) => ({ ...p })),
        snapshotTime: this.snapshot?.time,
        phase: this.snapshot?.phase,
        yaw: this.yaw,
        pitch: this.pitch,
        connected: this.connected,
      }),
    });
    this.scene = new ArenaScene(canvas, manifest, prefs);
    this.audio = new ArenaAudio(manifest.boxes);
    this.audio.configure(prefs.volume, prefs.effects);
    this.input = new ArenaInput(this);
    this.tick = setInterval(() => this.send(), 1000 / MOVEMENT_SEND_HZ);
    this.frame = requestAnimationFrame(this.animate);
    if (room.status !== 'finished') void this.connect();
    else this.input.dispose();
  }
  async connect() {
    if (this.stopped || this.replaced) return;
    try {
      const { ticket } = await api<{ ticket: string }>(
        `/arena/rooms/${this.room.id}/ticket`,
        'POST',
        {},
      );
      if (this.stopped) return;
      this.socket?.removeAllListeners();
      this.socket?.disconnect();
      const socket = (this.socket = io({
        path: '/arena/socket.io',
        transports: ['websocket'],
        auth: { ticket },
        reconnection: false,
      }));
      socket.on('connect', async () => {
        this.connected = true;
        if (this.input.disposed) this.input = new ArenaInput(this);
        this.fresh = true;
        this.remote.clear();
        this.onError('');
        this.soundEvents.reset();
        await this.audio.ready;
        if (socket.connected && !this.stopped) socket.emit('loaded');
      });
      socket.on('snapshot', (s: Snapshot) => this.receive(s));
      socket.on('probe', (nonce: number) => socket.emit('probe_reply', nonce));
      const reconnect = () => {
        if (this.replaced) return;
        this.connected = false;
        this.audio.stopWorld();
        this.flashEffect.reset();
        this.audio.setFlashImpairment(0);
        this.soundEvents.reset();
        this.input.dispose();
        this.onError('Связь прервана. Возвращаемся в матч…');
        if (!this.stopped && this.snapshot?.phase !== 'finished') {
          clearTimeout(this.retry);
          this.retry = setTimeout(() => void this.connect(), 1500);
        }
      };
      socket.on('connect_error', reconnect);
      socket.on('disconnect', reconnect);
      socket.on('replaced', () => {
        this.replaced = true;
        this.connected = false;
        this.audio.stopWorld();
        this.soundEvents.reset();
        this.input.dispose();
        clearTimeout(this.retry);
        this.onError(
          'Управление передано другой вкладке. Закройте её и обновите эту страницу для возврата.',
        );
      });
      socket.on('closed', () => {
        this.connected = false;
        this.audio.stopWorld();
        this.soundEvents.reset();
        this.input.dispose();
        this.onError('Комната закрыта. Вернитесь к списку комнат.');
      });
      socket.on('cancelled', () => {
        this.stopped = true;
        this.connected = false;
        this.audio.stopWorld();
        this.soundEvents.reset();
        this.input.dispose();
        clearTimeout(this.retry);
        this.onError('Матч завершён: карта снята с публикации администратором.');
      });
    } catch (error) {
      this.onError((error as Error).message);
      if (!this.stopped) this.retry = setTimeout(() => void this.connect(), 2000);
    }
  }
  configure(prefs: Preferences) {
    this.prefs = prefs;
    this.audio.configure(prefs.volume, prefs.effects);
    this.scene.configure(prefs);
  }
  async lock() {
    // Pointer Lock needs the original gesture, not a later audio-resume callback.
    void this.audio
      .unlock()
      .catch(() => this.onError('Звук недоступен; управление работает без него.'));
    await this.input.focus.lock();
  }
  async fullscreen(root: HTMLElement) {
    void this.audio
      .unlock()
      .catch(() => this.onError('Звук недоступен; управление работает без него.'));
    await this.input.focus.toggleFullscreen(root);
  }
  locked = () => document.pointerLockElement === this.canvas;
  mouse = (e: MouseEvent) => {
    if (this.locked()) {
      const sensitivity = effectiveSensitivity(this.prefs, this.scoped());
      this.yaw += e.movementX * 0.002 * sensitivity;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.002 * sensitivity));
    }
  };
  wheel = (e: WheelEvent) => {
    if (!this.locked()) return;
    e.preventDefault();
    const names = Object.keys(this.manifest.weapons);
    this.aimHeld = false;
    this.reload = false;
    this.weapon =
      names[(names.indexOf(this.weapon) + (e.deltaY > 0 ? 1 : -1) + names.length) % names.length];
    this.grenadeSlot = false;
  };
  command(): Input {
    const me = this.snapshot?.players.find((p) => p.id === this.self);
    const active = this.locked() && !!me?.alive && this.snapshot?.phase === 'active';
    return {
      seq: this.seq,
      yaw: this.yaw,
      pitch: this.pitch,
      forward: active
        ? Number(this.keys.has(this.prefs.bindings.forward)) -
          Number(this.keys.has(this.prefs.bindings.backward))
        : 0,
      side: active
        ? Number(this.keys.has(this.prefs.bindings.right)) -
          Number(this.keys.has(this.prefs.bindings.left))
        : 0,
      jump: active && this.keys.has(this.prefs.bindings.jump),
      crouch:
        active && (this.input.toggleCrouchActive || this.keys.has(this.prefs.bindings.crouch)),
      fire: active && this.fire,
      reload: active && this.reload,
      weapon: this.weapon,
      ...(active && this.pendingGrenade ? { grenade: this.pendingGrenade.kind,
        grenade_sequence: this.pendingGrenade.sequence } : {}),
    };
  }
  send() {
    const me = this.snapshot?.players.find((p) => p.id === this.self);
    if (!this.connected || this.fresh || !me?.alive || this.snapshot?.phase !== 'active') return;
    const input = this.command();
    input.seq = ++this.seq;
    input.movement = this.local.packet();
    this.predictFire();
    input.fire_id = this.soundEvents.prediction.burst;
    this.socket?.volatile.emit('input', input);
    this.diagnostics.sent++;
  }

  receive(s: Snapshot) {
    if (!this.fresh && this.snapshot && s.id === this.snapshot.id && s.time <= this.snapshot.time)
      return;
    const me = s.players.find((p) => p.id === this.self);
    if (!me) return;
    if (s.grenade_config) {
      this.manifest.grenades = s.grenade_config;
      this.scene.world.grenades = s.grenade_config;
      if (!s.grenade_config[this.grenadeType]?.enabled ||
          (me.grenades?.[this.grenadeType] ?? 0) <= 0) {
        const available = (['frag', 'smoke', 'flash', 'molotov'] as const).find(
          (kind) => s.grenade_config?.[kind]?.enabled && (me.grenades?.[kind] ?? 0) > 0);
        if (available) this.grenadeType = available;
      }
    }
    const firstSnapshot = this.fresh;
    const arrival = performance.now();
    this.serverClockOffset = Math.min(this.serverClockOffset, arrival - s.time * 1000);
    this.grenadeSequence = Math.max(this.grenadeSequence, me.grenade_sequence ?? 0);
    // Retry the request until the authoritative snapshot confirms it. A bounded
    // server input queue may discard a packet during a stall, never the intent.
    if (
      !me.alive ||
      reloadAcknowledged(
        me,
        this.reloadWeapon,
        this.reloadAfterSeq,
        this.manifest.weapons[this.reloadWeapon]?.magazine ?? 0,
      )
    )
      this.reload = false;
    const spawn = this.local.accept(s, me, this.fresh);
    if (spawn || !me.alive || s.phase !== 'active' || (this.lastRound && s.round !== this.lastRound)) {
      this.flashEffect.reset();
      this.audio.setFlashImpairment(0);
    }
    this.lastRound = s.round;
    if (!me.alive || spawn || s.phase !== 'active') this.pendingGrenade = null;
    if (this.pendingGrenade && performance.now() - this.pendingGrenade.requestedAt > 4000)
      this.pendingGrenade = null;
    if ((me.grenade_sequence ?? 0) >= (this.pendingGrenade?.sequence ?? Infinity))
      this.pendingGrenade = null;
    if (spawn) {
      this.seq = Math.max(this.seq, (me.seq ?? 0) + 10);
      this.yaw = me.yaw;
      this.pitch = me.pitch;
      this.remote.clear();
      this.fresh = false;
    }
    if (!me.alive || me.reloading || spawn || me.weapon !== 'sniper' || s.phase !== 'active')
      this.aimHeld = false;
    if (spawn || !me.alive) this.input.toggleCrouchActive = false;
    this.snapshot = s;
    this.scene.syncGrenades(s.grenades ?? [], this.self, s.time);
    this.scene.syncFireAreas(s.fire_areas ?? [], s.time);
    const fireOwners = new Set<string>();
    for (const area of s.fire_areas ?? []) {
      const owner = `fire:${area.id}`;
      fireOwners.add(owner);
      const center = area.patches[0]?.center;
      if (me.alive && center?.length === 3)
        this.audio.loop('fire-loop', center as [number, number, number], owner);
    }
    this.audio.stopLoopsExcept('fire-loop', fireOwners);
    this.spectatorController.update(s.players, this.self, this.room.settings.mode);
    this.remote.push(s, performance.now(), this.self);
    for (const e of s.events)
      if (e.id > this.lastEvent) {
        this.scene.event(e, this.spectator || this.self);
        if (e.kind === 'hit' && e.player === this.self) this.onHit(!!e.head);
        if (!firstSnapshot && e.kind === 'flash_effect' && e.player === this.self && me.alive) {
          const audio = this.flashEffect.apply(e, arrival, this.serverClockOffset,
            this.manifest.grenades);
          if (audio > 0.1) this.audio.flashRing(audio);
        }
      }
    this.soundEvents.consume(s, this.self, me.alive || !!this.spectator, this.audio);

    this.lastEvent = Math.max(this.lastEvent, ...s.events.map((e) => e.id));
    if (s.phase === 'finished') this.input.dispose();
    this.onState(s);
  }
  animate = (now: number) => {
    if (this.stopped) return;
    const elapsed = Math.max(0, (now - this.lastFrame) / 1000);
    const dt = Math.min(0.1, elapsed);
    this.lastFrame = now;
    this.diagnostics.frames++;
    this.diagnostics.frameMsMax = Math.max(this.diagnostics.frameMsMax, elapsed * 1000);
    if (elapsed > 0.05) this.diagnostics.frameSpikes++;
    this.diagnostics.snapshotAgeMs = now - this.remote.lastArrival;
    const state = this.snapshot,
      me = state?.players.find((p) => p.id === this.self);
    const movementStarted = performance.now();
    const remotePlayers = this.remote.sample(now, dt, this.manifest);
    this.remoteViews = remotePlayers;
    if (me?.alive && state?.phase === 'active' && !this.fresh && !this.input.disposed) {
      this.local.advance(this.command(), this.manifest, remotePlayers, dt);
    }
    const players = me
      ? [
          ...remotePlayers,
          {
            ...me,
            ...this.position,
            yaw: this.yaw,
            pitch: this.pitch,
            moving: Math.hypot(this.position.vx, this.position.vz) > 0.2,
          },
        ]
      : remotePlayers;
    let view = {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      crouched: this.position.crouched,
      yaw: this.yaw,
      pitch: this.pitch,
    };
    this.diagnostics.movementMsMax = Math.max(
      this.diagnostics.movementMsMax,
      performance.now() - movementStarted,
    );
    let cameraPlayer = this.self;
    if (me && !me.alive && this.room.settings.mode === 'elimination') {
      const teammate = players.find((p) => p.id === this.spectator && p.alive && p.connected);
      if (teammate) {
        view = {
          x: teammate.x,
          y: teammate.y,
          crouched: teammate.crouched,
          z: teammate.z,
          yaw: teammate.yaw,
          pitch: teammate.pitch,
        };
        cameraPlayer = teammate.id;
      }
    }
    const observed = players.find((p) => p.id === cameraPlayer);
    const scoped = this.scoped();
    const presentation = `${scoped}:${this.spectator}`;
    if (presentation !== this.lastPresentation) {
      this.lastPresentation = presentation;
      this.onPresentation(scoped, this.spectator);
    }
    this.scene.setWeapon(cameraPlayer === this.self && this.grenadeSlot ? this.grenadeType
      : observed?.weapon ?? me?.weapon ?? this.weapon);
    this.scene.targetFov = scoped ? this.manifest.weapons.sniper.scope_fov : this.prefs.fov;
    this.scene.scoped = scoped;
    const renderStarted = performance.now();
    this.scene.render(
      players,
      view,
      cameraPlayer,
      dt,
      now / 1000,
      !!observed?.alive && state?.phase === 'active',
    );
    this.diagnostics.renderMsMax = Math.max(
      this.diagnostics.renderMsMax,
      performance.now() - renderStarted,
    );
    const audioStarted = performance.now();
    this.audio.updatePlayers(players, !!me?.alive || !!this.spectator);
    const camera = this.scene.camera;
    camera.getWorldDirection(this.audioForward);
    this.flashEffect.capture(now, [camera.position.x, camera.position.y, camera.position.z],
      [this.audioForward.x, this.audioForward.y, this.audioForward.z]);
    const flash = this.flashEffect.state(now);
    const overlay = this.canvas.parentElement?.querySelector<HTMLElement>('.arena-flash-overlay');
    if (overlay) overlay.style.opacity = String(Math.min(0.96, flash.visual * 0.96));
    this.canvas.parentElement?.style.setProperty('--arena-flash-visual', String(flash.visual));
    this.audio.setFlashImpairment(flash.audio);
    this.audioUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.audio.listener(
      [camera.position.x, camera.position.y, camera.position.z],
      [this.audioForward.x, this.audioForward.y, this.audioForward.z],
      [this.audioUp.x, this.audioUp.y, this.audioUp.z],
    );
    this.diagnostics.audioMsMax = Math.max(
      this.diagnostics.audioMsMax,
      performance.now() - audioStarted,
    );
    this.frame = requestAnimationFrame(this.animate);
  };
  dispose() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.tick);
    cancelAnimationFrame(this.frame);
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    if (this.locked()) document.exitPointerLock();
    this.input.dispose();
    delete (this.canvas as HTMLCanvasElement & { arenaDiagnostics?: unknown }).arenaDiagnostics;
    this.remote.clear();
    this.scene.dispose();
    this.audio.dispose();
    this.flashEffect.reset();
  }
}
