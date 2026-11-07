/// <reference types="vite/client" />
type Transition = 'fullscreen' | 'pointer-lock' | 'exit-fullscreen' | null;

/** Browser focus owns gameplay entry; clearing held input is a separate operation. */
export class ArenaFocus {
  transition: Transition = null;
  private playing: boolean;
  private wantsPlay: boolean;
  private operation = 0;
  private disposed = false;
  private wasFullscreen = false;
  private root: HTMLElement | null;

  constructor(
    private canvas: HTMLCanvasElement,
    private clearInput: () => void,
    private onPlaying: (playing: boolean) => void,
    private onError: (message: string) => void,
    private onEscape?: () => void,
  ) {
    this.root = canvas.parentElement;
    this.playing = this.wantsPlay = this.locked();
    this.wasFullscreen = !!this.root && document.fullscreenElement === this.root;
    document.addEventListener('pointerlockchange', this.pointerChange);
    document.addEventListener('pointerlockerror', this.pointerError);
    document.addEventListener('fullscreenchange', this.fullscreenChange);
    document.addEventListener('visibilitychange', this.visibilityChange);
    window.addEventListener('blur', this.windowBlur);
    window.addEventListener('focus', this.windowFocus);
  }
  private locked() {
    return document.pointerLockElement === this.canvas;
  }
  private setPlaying(value: boolean) {
    if (value === this.playing) return;
    this.playing = value;
    this.onPlaying(value);
  }
  private trace(reason: string) {
    if (import.meta.env.DEV) console.debug('[Arena focus]', reason, this.transition);
  }
  private lockHint() {
    return this.root && document.fullscreenElement === this.root
      ? 'Нажмите на игровое поле, чтобы вернуть управление.'
      : 'Не удалось захватить мышь. Нажмите «Продолжить» ещё раз.';
  }
  pause(reason: string) {
    this.clearInput();
    this.operation++;
    this.wantsPlay = false;
    this.transition = null;
    if (this.playing) this.trace(reason);
    this.setPlaying(false);
    if (this.locked()) document.exitPointerLock();
  }
  escape() {
    this.onEscape?.();
    this.pause('escape');
    if (this.root && document.fullscreenElement === this.root)
      void document
        .exitFullscreen()
        .catch(() => this.onError('Не удалось выйти из полного экрана. Используйте Esc ещё раз.'));
  }
  private async acquire(operation: number) {
    this.transition = 'pointer-lock';
    try {
      await this.canvas.requestPointerLock();
      if (this.disposed || operation !== this.operation) {
        if (this.locked() && !this.wantsPlay) document.exitPointerLock();
        return;
      }
      this.transition = null;
      if (!document.hidden && document.hasFocus() && this.locked()) {
        this.setPlaying(true);
        this.onError('');
      } else {
        this.pause('pointer-lock-not-acquired');
        this.onError(this.lockHint());
      }
    } catch {
      if (operation !== this.operation || this.disposed) return;
      this.pause('pointer-lock-rejected');
      this.onError(this.lockHint());
    }
  }
  async lock() {
    if (this.disposed || this.transition) return;
    if (this.locked()) {
      this.setPlaying(true);
      return;
    }
    this.clearInput();
    this.wantsPlay = true;
    await this.acquire(++this.operation);
  }
  async toggleFullscreen(root: HTMLElement) {
    if (this.disposed || this.transition) return;
    this.root = root;
    const exiting = document.fullscreenElement === root;
    const resume = !exiting;
    const operation = ++this.operation;
    this.wantsPlay = resume;
    this.transition = exiting ? 'exit-fullscreen' : 'fullscreen';
    this.clearInput();
    try {
      if (exiting) await document.exitFullscreen();
      else {
        // Both requests need the button's user activation. Waiting for fullscreen
        // first can make pointer lock fail on Chromium.
        const pointer = Promise.resolve(this.canvas.requestPointerLock()).catch(() => {});
        const fullscreen = root.requestFullscreen();
        await fullscreen;
        await pointer;
      }
      if (this.disposed || operation !== this.operation) return;
      if (document.hidden || !document.hasFocus()) {
        this.pause('fullscreen-unfocused');
        return;
      }
      if (resume && this.locked()) {
        this.transition = null;
        this.setPlaying(true);
        this.onError('');
      } else if (resume) await this.acquire(operation);
      else {
        this.transition = null;
        this.pause('fullscreen-exit-button');
      }
    } catch {
      if (operation !== this.operation || this.disposed) return;
      this.pause('fullscreen-rejected');
      this.onError('Браузер не разрешил полный экран. Можно продолжить игру в обычном окне.');
    }
  }
  private pointerChange = () => {
    if (this.locked()) {
      if (this.wantsPlay && !document.hidden) this.setPlaying(true);
      else document.exitPointerLock();
    } else {
      this.clearInput();
      if (this.transition) this.trace('pointer-lock-change-during-transition');
      else this.pause('pointer-lock-lost');
    }
  };
  private pointerError = () => {
    if (!this.transition) return;
    this.pause('pointer-lock-error');
    this.onError(this.lockHint());
  };
  private fullscreenChange = () => {
    const active = !!this.root && document.fullscreenElement === this.root;
    const exited = this.wasFullscreen && !active;
    this.wasFullscreen = active;
    if (exited && !this.transition) this.pause('system-fullscreen-exit');
  };
  private windowBlur = () => {
    this.clearInput();
    // Fullscreen can emit a technical blur. Decide after its promise settles;
    // real backgrounding always wins, and regular genuine blur pauses immediately.
    if (document.hidden || (!this.transition && !document.hasFocus())) this.pause('window-blur');
  };
  private windowFocus = () => {
    // Returning to the window never steals the mouse; require an explicit Resume.
    if (!this.transition && !this.locked()) this.setPlaying(false);
  };
  private visibilityChange = () => {
    if (document.hidden) this.pause('hidden');
  };
  dispose() {
    if (this.disposed) return;
    this.pause('dispose');
    this.disposed = true;
    document.removeEventListener('pointerlockchange', this.pointerChange);
    document.removeEventListener('pointerlockerror', this.pointerError);
    document.removeEventListener('fullscreenchange', this.fullscreenChange);
    document.removeEventListener('visibilitychange', this.visibilityChange);
    window.removeEventListener('blur', this.windowBlur);
    window.removeEventListener('focus', this.windowFocus);
  }
}
