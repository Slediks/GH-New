import type { ArenaClient } from './client';
import { ArenaFocus } from './focus';
/** One owner for DOM input. Menus keep normal keyboard navigation. */
export class ArenaInput {
  disposed = false;
  focus: ArenaFocus;
  toggleCrouchActive = false;
  constructor(private client: ArenaClient) {
    this.focus = new ArenaFocus(client.canvas, this.clear, client.onLock, client.onError,
      client.onEscapeMenu);
    document.addEventListener('keydown', this.down, { capture: true });
    document.addEventListener('keyup', this.up, { capture: true });
    document.addEventListener('mousemove', client.mouse);
    document.addEventListener('mousedown', this.mouseDown, { capture: true });
    document.addEventListener('mouseup', this.mouseUp, { capture: true });
    document.addEventListener('contextmenu', this.contextMenu);
    client.canvas.addEventListener('wheel', client.wheel, { passive: false });
  }
  clear = () => {
    const c = this.client;
    c.keys.clear();
    c.fire = false;
    c.reload = false;
    c.aimHeld = false;
    this.toggleCrouchActive = false;
    c.onTab(false);
  };
  down = (e: KeyboardEvent) => {
    const c = this.client;
    if (e.code === 'Escape') {
      if (!c.locked() && document.fullscreenElement !== c.canvas.parentElement) return;
      e.preventDefault();
      e.stopPropagation();
      this.focus.escape();
      return;
    }
    if (!c.locked()) return;
    if (e.altKey || e.metaKey) {
      this.clear();
      return;
    }
    const action = Object.entries(c.prefs.bindings).find(
      ([, key]) =>
        key === e.code ||
        (key === 'ControlLeft' &&
          e.code === 'ControlRight' &&
          !Object.values(c.prefs.bindings).includes('ControlRight')),
    )?.[0];
    const gameKey =
      action ||
      /^(Digit[1-5]|KeyG|ControlLeft|ControlRight|ShiftLeft|ShiftRight|ArrowLeft|ArrowRight)$/.test(
        e.code,
      );
    if (!gameKey) return;
    e.preventDefault();
    e.stopPropagation();
    c.keys.add(e.code);
    if (action === 'crouchToggle' && !e.repeat) {
      if (!this.toggleCrouchActive) this.toggleCrouchActive = true;
      else if (c.canStand()) this.toggleCrouchActive = false;
    }
    if (action === 'scoreboard') c.onTab(true);
    if (action === 'reload' && !e.repeat) c.requestReload();
    if (!e.repeat && e.code === 'Digit5') {
      const kinds = (['frag', 'smoke', 'flash', 'molotov'] as typeof c.grenadeType[])
        .filter((kind) => kind in (c.manifest.grenades ?? {}));
      if (c.grenadeSlot && kinds.length)
        c.grenadeType = kinds[(kinds.indexOf(c.grenadeType) + 1) % kinds.length];
      c.grenadeSlot = true;
      c.aimHeld = false;
      c.fire = false;
    }
    if (!e.repeat && e.code === 'KeyG') c.throwGrenade();
    if (!e.repeat && ['ArrowLeft', 'ArrowRight'].includes(e.code))
      c.cycleSpectator(e.code === 'ArrowLeft' ? -1 : 1);
    const weapon = Object.keys(c.manifest.weapons)[Number(e.code.replace('Digit', '')) - 1];
    if (weapon && weapon !== c.weapon) {
      c.aimHeld = false;
      c.reload = false;
      c.weapon = weapon;
      c.grenadeSlot = false;
    }
  };
  up = (e: KeyboardEvent) => {
    const c = this.client;
    const held = c.keys.delete(e.code);
    if (held && c.locked()) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (e.code === c.prefs.bindings.scoreboard) c.onTab(false);
  };
  contextMenu = (e: Event) => {
    if (this.client.locked()) e.preventDefault();
  };
  mouseDown = (e: MouseEvent) => {
    if (this.client.locked()) {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 0) {
        if (this.client.grenadeSlot) this.client.throwGrenade();
        else this.client.requestFire();
      }
      if (e.button === 2) this.client.aimHeld = true;
    }
  };
  mouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.client.fire = false;
    if (e.button === 2) this.client.aimHeld = false;
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.focus.dispose();
    const c = this.client;
    document.removeEventListener('keydown', this.down, { capture: true });
    document.removeEventListener('keyup', this.up, { capture: true });
    document.removeEventListener('mousemove', c.mouse);
    document.removeEventListener('mousedown', this.mouseDown, { capture: true });
    document.removeEventListener('mouseup', this.mouseUp, { capture: true });
    document.removeEventListener('contextmenu', this.contextMenu);
    c.canvas.removeEventListener('wheel', c.wheel);
  }
}
