import type { Player, Snapshot } from '../../shared/types';

const point = (x: number, y: number) => [40 + x * 9.2, 44 + y * 9.2];

export function playerIndicators(
  ctx: CanvasRenderingContext2D,
  player: Player,
  owns: boolean,
  debug: boolean,
) {
  const [x, y] = point(player.x, player.y);
  const angle = player.facing ?? (player.side ? Math.PI : 0);
  ctx.save();
  ctx.strokeStyle = owns ? '#fff' : '#ffffff88';
  ctx.lineWidth = owns ? 2.5 : 1.5;
  if (owns || player.state === 'windup') {
    ctx.beginPath();
    ctx.arc(x, y, player.state === 'windup' ? 23 : 20, 0, Math.PI * 2);
    ctx.strokeStyle = player.state === 'windup' ? '#ffd37c' : '#ffffffa0';
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(angle) * 17, y + Math.sin(angle) * 17);
  ctx.lineTo(x + Math.cos(angle) * 25, y + Math.sin(angle) * 25);
  ctx.stroke();
  if (player.state === 'dive') {
    ctx.strokeStyle = '#ffd37c';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x - Math.sin(angle) * 20, y + Math.cos(angle) * 20);
    ctx.lineTo(x + Math.sin(angle) * 20, y - Math.cos(angle) * 20);
    ctx.stroke();
  }
  if (debug && player.target) {
    const [tx, ty] = point(player.target[0], player.target[1]);
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff';
    ctx.font = '12px Segoe UI';
    ctx.fillText(`${player.role} · ${player.action}`, x, y - 30);
  }
  ctx.restore();
}

export function ballEffects(ctx: CanvasRenderingContext2D, state: Snapshot, reduced: boolean) {
  const [x, y] = point(state.ball.x, state.ball.y);
  const vx = state.ball.vx ?? 0,
    vy = state.ball.vy ?? 0;
  if (!reduced && Math.hypot(vx, vy) > 18) {
    const gradient = ctx.createLinearGradient(x - vx * 1.8, y - vy * 1.8, x, y);
    gradient.addColorStop(0, '#ffffff00');
    gradient.addColorStop(1, '#ffffffbb');
    ctx.save();
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - vx * 1.8, y - vy * 1.8);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();
  }
  for (const effect of state.effects ?? []) {
    const age = (state.clock ?? state.elapsed) - effect.at;
    if (age < 0 || age > 1.2) continue;
    const [ex, ey] = point(effect.x, effect.y);
    ctx.save();
    ctx.globalAlpha = 1 - age / 1.2;
    ctx.strokeStyle = ['shot', 'goal'].includes(effect.kind)
      ? '#ffd37c'
      : effect.kind === 'tackle'
        ? '#ff998c'
        : '#bde9ff';
    ctx.lineWidth = 2;
    if (effect.kind === 'goal') {
      ctx.fillStyle = '#ffd37c';
      ctx.globalAlpha = 0.25 * (1 - age / 1.2);
      ctx.fillRect(effect.x > 50 ? 960 : 18, 265, 22, 110);
      ctx.globalAlpha = 1 - age / 1.2;
      ctx.font = 'bold 24px Segoe UI';
      ctx.textAlign = 'center';
      ctx.fillText('ГОЛ!', 500, 80);
      // Brief rings around celebrating players, never affecting their server positions.
      for (const p of state.players.filter((p) => p.side === effect.side)) {
        const [px, py] = point(p.x, p.y);
        ctx.beginPath();
        ctx.arc(px, py, reduced ? 21 : 21 + age * 8, 0, 7);
        ctx.stroke();
      }
    } else if (age < 0.65) {
      ctx.setLineDash(effect.kind === 'tackle' ? [3, 4] : []);
      ctx.beginPath();
      ctx.arc(ex, ey, reduced ? 22 : 12 + age * 32, 0, 7);
      ctx.stroke();
    }
    ctx.restore();
  }
}
