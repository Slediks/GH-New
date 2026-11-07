/** Fullscreen suppresses incidental pauses; only an explicit Esc may show its menu. */
export function showPauseMenu(
  locked: boolean, ended: boolean, scoreboard: boolean,
  fullscreen: boolean, escapeRequested: boolean,
) {
  return !locked && !ended && !scoreboard && (!fullscreen || escapeRequested);
}
