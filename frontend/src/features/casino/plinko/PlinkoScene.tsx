import { useMemo } from 'react';
import { points } from '../../../shared/api';
import type { CasinoGame, CasinoRound } from '../types';
import { multiplierLabel, roundBalls } from './model';
import { FIELD } from './motion';
import { useBalls } from './useBalls';
import './plinko.css';
export function PlinkoScene({
  round,
  game,
  risk,
  animate,
  onFinished,
}: {
  round: CasinoRound | null;
  game: CasinoGame;
  risk: string;
  animate: boolean;
  onFinished: () => void;
}) {
  const balls = useMemo(() => roundBalls(round), [round]);
  const frames = useBalls(balls, animate, onFinished);
  const complete = frames.filter((frame) => frame.done);
  const rules = round?.rules ?? game.rules;
  const table =
    (rules.payout as Record<string, [number, number][]>)?.[String(round?.state.risk ?? risk)] ?? [];
  const payout = balls
    .filter((ball) => complete.some((frame) => frame.id === ball.id))
    .reduce((sum, ball) => sum + ball.payout, 0);
  return (
    <div className={`plinko-scene plinko-group risk-${String(round?.state.risk ?? risk)}`}>
      <div className="plinko-topline">
        <span>12 НЕЗАВИСИМЫХ ОТСКОКОВ</span>
        <strong>
          {balls.length
            ? `Приземлились ${complete.length} / ${balls.length}`
            : 'Выберите ставку и количество шариков'}
        </strong>
      </div>
      <svg
        viewBox={`0 0 ${FIELD.width} ${FIELD.height}`}
        className="casino-plinko"
        role="img"
        aria-label="Поле Plinko и коэффициенты конечных ячеек"
      >
        {Array.from({ length: FIELD.rows }, (_, row) =>
          Array.from({ length: row + 1 }, (_, col) => (
            <circle
              key={`${row}-${col}`}
              cx={FIELD.originX - row * FIELD.stepX + col * FIELD.binWidth}
              cy={30 + row * FIELD.stepY}
              r="3"
              fill="currentColor"
            />
          )),
        )}
        {table.map((fraction, bin) => (
          <g key={bin} className="plinko-bin" data-bin={bin}>
            <title>{`Ячейка ${bin + 1}. Точный коэффициент ${fraction.join('/')}`}</title>
            <rect
              x={FIELD.firstBinX + bin * FIELD.binWidth - 17}
              y="300"
              width="34"
              height="32"
              rx="5"
              fill={
                complete.some((frame) => balls.find((ball) => ball.id === frame.id)?.bin === bin)
                  ? '#d6b369'
                  : '#3a5574'
              }
            />
            <text
              className="plinko-bin-multiplier"
              x={FIELD.firstBinX + bin * FIELD.binWidth}
              y="350"
              textAnchor="middle"
              fill="#ffe3a6"
              fontSize="8"
              fontWeight="700"
            >
              {multiplierLabel(fraction)}
            </text>
            <text
              x={FIELD.firstBinX + bin * FIELD.binWidth}
              y="365"
              textAnchor="middle"
              fill="#b7c9da"
              fontSize="7"
            >
              {bin + 1}
            </text>
          </g>
        ))}
        {frames.map((frame) => (
          <circle
            key={frame.id}
            className="plinko-moving-ball"
            data-ball-id={frame.id}
            data-done={frame.done}
            cx={frame.x}
            cy={frame.y}
            r="4.5"
            fill={`hsl(${(frame.id * 67) % 360} 85% 73%)`}
            stroke="#fff"
            strokeWidth=".8"
          >
            <title>Шарик {frame.id}</title>
          </circle>
        ))}
      </svg>
      {!!balls.length && (
        <div className="plinko-group-summary" aria-live="polite">
          <strong>
            {complete.length === balls.length
              ? 'Выплата запуска'
              : 'Выплата приземлившихся шариков'}
            : {points(payout)} ш.
          </strong>
          {complete.length === balls.length && round?.state.total_stake != null && (
            <span>Итог: {points(payout - Number(round.state.total_stake))} ш.</span>
          )}
        </div>
      )}
      {!!balls.length && (
        <div className="plinko-ball-results">
          {balls.map((ball) => {
            const landed = complete.some((frame) => frame.id === ball.id);
            return (
              <div key={ball.id} className={landed ? 'landed' : ''} data-result-id={ball.id}>
                <b>№{ball.id}</b>
                {landed ? (
                  <>
                    <span>
                      Ячейка {ball.bin + 1} ·{' '}
                      {ball.multiplier ? multiplierLabel(ball.multiplier) : ''}
                    </span>
                    <strong>{points(ball.payout)} ш.</strong>
                    {ball.stake != null && <small>Ставка {points(ball.stake)} ш.</small>}
                  </>
                ) : (
                  <span>В движении</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
