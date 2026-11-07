import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArenaInput } from './input';
import type { ArenaClient } from './client';
import { defaultPreferences, readPreferences, effectiveSensitivity } from './preferences';
function fixture() {
  const canvas = new EventTarget();
  const doc = Object.assign(new EventTarget(), {
    pointerLockElement: canvas as EventTarget | null,
    hidden: false,
    hasFocus: vi.fn(() => false),
    exitPointerLock: vi.fn(() => {
      doc.pointerLockElement = null;
    }),
  });
  const win = new EventTarget();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  const c = {
    canvas,
    keys: new Set<string>(),
    fire: false,
    requestFire() {
      this.fire = true;
    },
    aimHeld: false,
    canStand: vi.fn(() => true),
    reload: false,
    requestReload() {
      this.reload = true;
    },
    weapon: 'rifle',
    prefs: defaultPreferences(),
    onTab: vi.fn(),
    onLock: vi.fn(),
    onError: vi.fn(),
    mouse: vi.fn(),
    wheel: vi.fn(),
    cycleSpectator: vi.fn(),
    locked: () => doc.pointerLockElement === canvas,
    manifest: { weapons: { pistol: {}, rifle: {}, shotgun: {}, sniper: {} } },
  };
  const input = new ArenaInput(c as unknown as ArenaClient);
  const key = (code: string, extra = {}) => {
    const e = Object.assign(new Event('keydown', { cancelable: true }), {
      code,
      repeat: false,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      ...extra,
    });
    doc.dispatchEvent(e);
    return e;
  };
  return { c, doc, win, input, key };
}
afterEach(() => vi.unstubAllGlobals());
describe('Arena input ownership', () => {
  it('captures actions, Tab, reload and weapons while locked', () => {
    const { c, key, input } = fixture();
    for (const k of [
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'Space',
      'KeyC',
      'ShiftLeft',
      'Tab',
      'KeyR',
      'Digit3',
    ])
      expect(key(k).defaultPrevented).toBe(true);
    expect(c.reload).toBe(false); // Switching weapon cancels its reload intent.
    key('KeyR');
    expect(c.reload).toBe(true);
    expect(c.weapon).toBe('shotgun');
    expect(c.onTab).toHaveBeenCalledWith(true);
    input.dispose();
  });
  it('blur clears movement/fire/reload and releases pointer lock', () => {
    const { c, win, input, key, doc } = fixture();
    key('KeyW');
    c.fire = true;
    c.reload = true;
    win.dispatchEvent(new Event('blur'));
    expect(c.keys.size).toBe(0);
    expect(c.fire).toBe(false);
    expect(c.reload).toBe(false);
    expect(doc.pointerLockElement).toBeNull();
    input.dispose();
  });
  it('background and pointer lock loss clear all held actions', () => {
    const { c, doc, input, key } = fixture();
    key('KeyW');
    c.fire = true;
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(c.keys.size).toBe(0);
    expect(c.fire).toBe(false);
    input.dispose();
  });
  it('does not consume system combinations and removes listeners on dispose', () => {
    const { c, key, input, doc } = fixture();
    expect(key('KeyW', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(c.keys.has('KeyW')).toBe(true);
    expect(doc.pointerLockElement).toBe(c.canvas);
    expect(key('Tab', { altKey: true }).defaultPrevented).toBe(false);
    expect(c.keys.size).toBe(0);
    input.dispose();
    doc.pointerLockElement = c.canvas;
    key('KeyW');
    expect(c.keys.size).toBe(0);
  });
  it('custom keys work, menu keys stay available, Escape is not leave', () => {
    const { c, key, input, doc } = fixture();
    c.prefs.bindings.forward = 'KeyZ';
    expect(key('KeyZ').defaultPrevented).toBe(true);
    key('Escape');
    expect(doc.pointerLockElement).toBeNull();
    expect(key('Tab').defaultPrevented).toBe(false);
    input.dispose();
  });
});
describe('Arena stored preferences', () => {
  it('clamps settings and discards conflicting key mappings', () => {
    vi.stubGlobal('localStorage', {
      getItem: () =>
        JSON.stringify({ fov: 999, sensitivity: -1, volume: 9, bindings: { forward: 'Space' } }),
    });
    const p = readPreferences();
    expect(p.fov).toBe(100);
    expect(p.sensitivity).toBe(0.2);
    expect(p.volume).toBe(1);
    expect(p.bindings.forward).toBe('KeyW');
  });
});

describe('Crouch intent and scope buttons', () => {
  it('toggle survives hold release; blocked stand retains toggle; repeat does not toggle', () => {
    const { c, key, input, doc } = fixture();
    key('ControlLeft');
    expect(input.toggleCrouchActive).toBe(true);
    key('ControlLeft', { repeat: true });
    expect(input.toggleCrouchActive).toBe(true);
    key('KeyC');
    doc.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyC' }));
    expect(input.toggleCrouchActive).toBe(true);
    expect(c.keys.has('KeyC')).toBe(false);
    c.canStand.mockReturnValue(false);
    key('ControlLeft');
    expect(input.toggleCrouchActive).toBe(true);
    c.canStand.mockReturnValue(true);
    key('ControlLeft');
    expect(input.toggleCrouchActive).toBe(false);
    input.dispose();
  });
  it('right mouse hold releases without cancelling left fire; blur clears both', () => {
    const { c, input, doc, win } = fixture();
    const mouse = (type: string, button: number) =>
      doc.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { button }));
    mouse('mousedown', 0);
    mouse('mousedown', 2);
    expect(c.aimHeld).toBe(true);
    mouse('mouseup', 2);
    expect(c.aimHeld).toBe(false);
    expect(c.fire).toBe(true);
    mouse('mousedown', 2);
    win.dispatchEvent(new Event('blur'));
    expect(c.aimHeld).toBe(false);
    expect(c.fire).toBe(false);
    input.dispose();
  });
});

describe('ADS sensitivity', () => {
  it('scales both directions only while scoped and applies changes immediately', () => {
    const prefs = defaultPreferences();
    prefs.sensitivity = 2;
    expect(effectiveSensitivity(prefs, false)).toBe(2);
    expect(effectiveSensitivity(prefs, true)).toBe(1.3);
    prefs.adsSensitivity = 0.25;
    expect(effectiveSensitivity(prefs, true)).toBe(0.5);
    expect(effectiveSensitivity(prefs, false)).toBe(2);
  });
  it('migrates old preferences and bounds saved ADS values', () => {
    const getItem = vi.fn(() => '{}');
    vi.stubGlobal('localStorage', { getItem });
    expect(readPreferences().adsSensitivity).toBe(0.65);
    getItem.mockReturnValue('{"adsSensitivity":0.45}');
    expect(readPreferences().adsSensitivity).toBe(0.45);
    getItem.mockReturnValue('{"adsSensitivity":99}');
    expect(readPreferences().adsSensitivity).toBe(2);
  });
});
