import { expect, it } from 'vitest';
import { showPauseMenu } from './pauseMenu';

it('shows normally outside fullscreen and only after Esc inside fullscreen', () => {
  expect(showPauseMenu(false, false, false, false, false)).toBe(true);
  expect(showPauseMenu(false, false, false, true, false)).toBe(false);
  expect(showPauseMenu(false, false, false, true, true)).toBe(true);
  expect(showPauseMenu(true, false, false, true, true)).toBe(false);
  expect(showPauseMenu(false, true, false, true, true)).toBe(false);
  expect(showPauseMenu(false, false, true, true, true)).toBe(false);
  expect(showPauseMenu(false, false, false, false, true)).toBe(true);
});
