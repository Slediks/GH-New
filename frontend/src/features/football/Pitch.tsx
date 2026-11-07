import { useEffect, useRef, useState } from 'react';
import type { Player, Snapshot, Team } from '../../shared/types';
import { acceptsSnapshot, interpolate } from './interpolation';
import { ballEffects, playerIndicators } from './effects';

export function Pitch({ snapshot, teams }: { snapshot: Snapshot | null; teams: Team[] }) {
  const [selected, setSelected] = useState<number | null>(null),
    [hovered, setHovered] = useState<number | null>(null);
  const hitboxes = useRef<{ id: number; x: number; y: number }[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null),
    buffer = useRef<{ previous: Snapshot | null; current: Snapshot | null; received: number }>({
      previous: null,
      current: null,
      received: 0,
    });
  useEffect(() => {
    if (!snapshot) buffer.current = { previous: null, current: null, received: 0 };
    if (snapshot && acceptsSnapshot(buffer.current.current, snapshot)) {
      buffer.current = {
        previous: buffer.current.current ?? snapshot,
        current: snapshot,
        received: performance.now(),
      };
    }
  }, [snapshot]);
  useEffect(() => {
    let animation = 0;
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext('2d');
    if (!context) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const debug = new URLSearchParams(window.location.search).has('football-debug');
    let displayScale = 1;
    const resize = new ResizeObserver(([entry]) => {
      displayScale = Math.max(0.1, entry.contentRect.width / 1000);
    });
    resize.observe(element);
    // Clamp screen-pixel sizes, then convert back to the unchanged field coordinates.
    const visualSize = (base: number, min: number, max: number) =>
      Math.max(min, Math.min(max, base * displayScale)) / displayScale;
    function draw() {
      const ctx = context!,
        width = 1000,
        height = 640;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#123e32';
      ctx.fillRect(0, 0, width, height);
      for (let index = 0; index < 10; index++) {
        ctx.fillStyle = index % 2 ? '#174a3a' : '#154535';
        ctx.fillRect(40 + index * 92, 44, 92, 552);
      }
      ctx.strokeStyle = '#b4d5b670';
      ctx.lineWidth = 2;
      ctx.strokeRect(40, 44, 920, 552);
      ctx.beginPath();
      ctx.moveTo(500, 44);
      ctx.lineTo(500, 596);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(500, 320, 80, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#b4d5b6';
      ctx.beginPath();
      ctx.arc(500, 320, 4, 0, 7);
      ctx.fill();
      ctx.strokeRect(40, 164, 140, 312);
      ctx.strokeRect(820, 164, 140, 312);
      ctx.strokeRect(40, 230, 55, 180);
      ctx.strokeRect(905, 230, 55, 180);
      ctx.fillStyle = '#0b211f';
      ctx.fillRect(18, 265, 22, 110);
      ctx.fillRect(960, 265, 22, 110);
      ctx.strokeRect(18, 265, 22, 110);
      ctx.strokeRect(960, 265, 22, 110);
      const { previous, current, received } = buffer.current;
      const state =
        previous && current
          ? reducedMotion.matches
            ? current
            : interpolate(previous, current, (performance.now() - received) / 100)
          : null;
      const players: Player[] =
        state?.players ??
        [0, 1].flatMap((side) =>
          [
            [5, 30],
            [27, 20],
            [27, 40],
            [45, 17],
            [45, 43],
          ].map(([x, y], index) => ({
            side,
            number: teams[side]?.lineup?.[index]?.number ?? index + 1,
            id: teams[side]?.lineup?.[index]?.id,
            name: teams[side]?.lineup?.[index]?.name,
            short_name: teams[side]?.lineup?.[index]?.short_name,
            position: teams[side]?.lineup?.[index]?.role,
            keeper: index === 0,
            x: side ? 100 - x : x,
            y,
            state: 'shape',
          })),
        );
      hitboxes.current = [];
      const labelBoxes: { x: number; y: number; w: number }[] = [];
      for (const [index, player] of players.entries()) {
        if (player.active === false) continue;
        const waiting = state?.phase === 'penalties' && player.y < 12;
        const x = 40 + player.x * 9.2,
          y = 44 + player.y * 9.2;
        if (player.id) hitboxes.current.push({ id: player.id, x, y });
        ctx.shadowColor = '#0008';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 4;
        ctx.beginPath();
        ctx.arc(x, y, waiting ? visualSize(11, 9, 15) : visualSize(15, 12, 20), 0, 7);
        ctx.fillStyle =
          (player.keeper ?? player.number === 1)
            ? '#203540'
            : (teams[player.side]?.color ?? '#58bde9');
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = (player.keeper ?? player.number === 1) ? '#e8cd74' : '#fff9';
        ctx.lineWidth = selected === player.id ? 4 : 2;
        if (selected === player.id) ctx.strokeStyle = '#fff';
        ctx.stroke();
        const rgb = (teams[player.side]?.color ?? '#58bde9')
          .slice(1)
          .match(/.{2}/g)
          ?.map((v) => parseInt(v, 16)) ?? [80, 180, 220];
        const brightness = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
        ctx.fillStyle =
          (player.keeper ?? player.number === 1) || brightness < 145 ? '#fff' : '#10232e';
        ctx.font = `bold ${waiting ? visualSize(11, 10, 14) : visualSize(14, 12, 18)}px Segoe UI`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(player.number), x, y);
        if (player.short_name) {
          const labelHeight = visualSize(18, 17, 24);
          ctx.font = `${selected === player.id ? 'bold ' : ''}${visualSize(13, 12, 18)}px Segoe UI`;
          const label = player.short_name;
          const w = Math.min(150, ctx.measureText(label).width + 12);
          const lx = Math.max(w / 2 + 4, Math.min(996 - w / 2, x));
          const positions = [27, -27, 45, -45, 63, -63, 81, -81].map((offset) =>
            Math.max(14, Math.min(626, y + offset)),
          );
          const ly =
            positions.find(
              (ly) =>
                !labelBoxes.some(
                  (b) => Math.abs(b.x - lx) < (b.w + w) / 2 && Math.abs(b.y - ly) < 18,
                ),
            ) ?? positions[0];
          labelBoxes.push({ x: lx, y: ly, w });
          ctx.fillStyle = selected === player.id ? '#17495f' : '#071d22db';
          ctx.fillRect(lx - w / 2, ly - labelHeight / 2, w, labelHeight);
          ctx.fillStyle = '#fff';
          ctx.fillText(label, lx, ly, w - 8);
          if (player.yellow) {
            ctx.fillStyle = '#f5cc42';
            ctx.fillRect(x + 12, y - 19, 7, 10);
          }
        }
        if (!waiting) playerIndicators(ctx, player, state?.owner === index, debug);
      }
      if (state) ballEffects(ctx, state, reducedMotion.matches);
      const ball = state?.ball ?? { x: 50, y: 30 };
      ctx.beginPath();
      ctx.arc(40 + ball.x * 9.2, 44 + ball.y * 9.2, visualSize(7, 5, 10), 0, 7);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#152d2c';
      ctx.stroke();
      animation = requestAnimationFrame(draw);
    }
    draw();
    return () => {
      cancelAnimationFrame(animation);
      resize.disconnect();
    };
  }, [teams, selected]);
  const people: Player[] =
    snapshot?.players ??
    teams.flatMap((team, side) =>
      (team.lineup ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        short_name: p.short_name,
        number: p.number,
        side,
        position: p.role,
        x: 0,
        y: 0,
        state: 'waiting',
        energy: 100,
      })),
    );
  const person = people.find((p) => p.id === (hovered ?? selected));
  function hit(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * 1000) / rect.width,
      y = ((event.clientY - rect.top) * 640) / rect.height;
    return hitboxes.current.find((p) => Math.hypot(p.x - x, p.y - y) < 25)?.id ?? null;
  }
  return (
    <>
      <div className="football-pitch-stage">
        <canvas
          className="pitch"
          width={1000}
          height={640}
          ref={canvas}
          onMouseMove={(e) => setHovered(hit(e))}
          onMouseLeave={() => setHovered(null)}
          onClick={(e) => setSelected(hit(e))}
          aria-label="Общая серверная трансляция футбольного матча, вид сверху"
        />
      </div>
      <div className="football-player-info">
        <label>
          Следить за игроком{' '}
          <select
            aria-label="Следить за игроком"
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Общий вид</option>
            {people
              .filter((p) => p.id && p.active !== false)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.number} · {p.name}
                </option>
              ))}
          </select>
        </label>
        {person && (
          <span>
            {person.name} · №{person.number} · {person.position} · Выносливость{' '}
            {Math.round(person.energy ?? 100)}% {person.yellow ? `· ЖК: ${person.yellow}` : ''}
            {person.active === false ? ' · покинул поле' : ''}
          </span>
        )}
      </div>
    </>
  );
}
