/** Smooth small grounded risers only; jumps, falls, respawns and physics stay exact. */
export function stepViewOffset(
  previousY: number,
  y: number,
  offset: number,
  grounded: boolean,
  stepHeight: number,
  dt: number,
) {
  const rise = y - previousY;
  if (!grounded || rise < -0.025 || rise > stepHeight + 0.01) return 0;
  return Math.max(-stepHeight, Math.min(0, offset - Math.max(0, rise))) * Math.exp(-dt * 24);
}
