import { afterEach, expect, it, vi } from 'vitest';
import { ArenaFocus } from './focus';

function setup() {
  const root = {
    requestFullscreen: vi.fn(async () => {
      doc.fullscreenElement = root;
      doc.dispatchEvent(new Event('fullscreenchange'));
    }),
  };
  const canvas = {
    parentElement: root,
    requestPointerLock: vi.fn(async () => {
      doc.pointerLockElement = canvas;
      doc.dispatchEvent(new Event('pointerlockchange'));
    }),
  };
  const doc = Object.assign(new EventTarget(), {
    pointerLockElement: canvas as typeof canvas | null,
    fullscreenElement: null as typeof root | null,
    hidden: false,
    hasFocus: vi.fn(() => true),
    exitPointerLock: vi.fn(() => {
      doc.pointerLockElement = null;
      doc.dispatchEvent(new Event('pointerlockchange'));
    }),
    exitFullscreen: vi.fn(async () => {
      doc.fullscreenElement = null;
      doc.dispatchEvent(new Event('fullscreenchange'));
    }),
  });
  const win = new EventTarget();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  const clear = vi.fn(),
    playing = vi.fn(),
    error = vi.fn(),
    escape = vi.fn();
  const focus = new ArenaFocus(canvas as unknown as HTMLCanvasElement, clear, playing, error, escape);
  return { root, canvas, doc, win, clear, playing, error, escape, focus };
}
afterEach(() => vi.unstubAllGlobals());
it('technical blur clears input without pause; genuine blur pauses once', () => {
  const f = setup();
  f.win.dispatchEvent(new Event('blur'));
  expect(f.clear).toHaveBeenCalled();
  expect(f.playing).not.toHaveBeenCalled();
  f.doc.hasFocus.mockReturnValue(false);
  f.win.dispatchEvent(new Event('blur'));
  f.doc.hidden = true;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  expect(f.playing.mock.calls).toEqual([[false]]);
  f.win.dispatchEvent(new Event('focus'));
  expect(f.canvas.requestPointerLock).not.toHaveBeenCalled();
  f.focus.dispose();
});
it('fullscreen transition tolerates pointer loss and then reacquires it', async () => {
  const f = setup();
  f.root.requestFullscreen.mockImplementation(async () => {
    f.doc.exitPointerLock();
    f.win.dispatchEvent(new Event('blur'));
    f.doc.fullscreenElement = f.root;
    f.doc.dispatchEvent(new Event('fullscreenchange'));
  });
  await f.focus.toggleFullscreen(f.root as unknown as HTMLElement);
  expect(f.doc.fullscreenElement).toBe(f.root);
  expect(f.doc.pointerLockElement).toBe(f.canvas);
  expect(f.playing).not.toHaveBeenCalledWith(false);
  await f.doc.exitFullscreen();
  expect(f.playing.mock.calls).toEqual([[false]]);
  f.focus.dispose();
});
it('fullscreen denial keeps real browser state and provides a recoverable error', async () => {
  const f = setup();
  f.root.requestFullscreen.mockRejectedValue(new Error('denied'));
  await f.focus.toggleFullscreen(f.root as unknown as HTMLElement);
  expect(f.doc.fullscreenElement).toBeNull();
  expect(f.error).toHaveBeenCalledWith(expect.stringContaining('полный экран'));
  await f.focus.lock();
  expect(f.doc.pointerLockElement).toBe(f.canvas);
  f.focus.dispose();
});
it('backgrounding cancels an outstanding fullscreen operation', async () => {
  const f = setup();
  let complete!: () => void;
  f.root.requestFullscreen.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const pending = f.focus.toggleFullscreen(f.root as unknown as HTMLElement);
  f.doc.hidden = true;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  complete();
  await pending;
  expect(f.canvas.requestPointerLock).toHaveBeenCalledOnce();
  expect(f.doc.pointerLockElement).toBeNull();
  f.focus.dispose();
});
it('pointer boundaries never trigger pause and disposal removes listeners', () => {
  const f = setup();
  for (const type of ['mouseleave', 'mouseout']) f.win.dispatchEvent(new Event(type));
  expect(f.playing).not.toHaveBeenCalled();
  f.focus.dispose();
  f.clear.mockClear();
  f.win.dispatchEvent(new Event('blur'));
  expect(f.clear).not.toHaveBeenCalled();
});
it('only explicit Escape signals the fullscreen menu; leaving fullscreen pauses', async () => {
  const f = setup();
  await f.focus.toggleFullscreen(f.root as unknown as HTMLElement);
  f.doc.hasFocus.mockReturnValue(false);
  f.win.dispatchEvent(new Event('blur'));
  expect(f.escape).not.toHaveBeenCalled();
  f.focus.escape();
  expect(f.escape).toHaveBeenCalledOnce();
  expect(f.doc.fullscreenElement).toBeNull();
  f.focus.dispose();
});
