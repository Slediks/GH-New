import { points } from '../../shared/api';
import type { CasinoRound } from './types';
import { PenaltyScene } from './ArcadeScenes';

export function StepGames({
  round,
  move,
  busy,
}: {
  round: CasinoRound;
  move: (action: string, options?: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const state = round.state;
  if (round.game === 'mines') {
    const opened = state.opened as number[],
      mines = (state.mines ?? []) as number[];
    return (
      <>
        <div className="casino-next-step">
          <div>
            <small>Безопасная следующая клетка</small>
            <strong>{(state.next_probability as number[]).join(' / ')}</strong>
          </div>
          {!state.done && (
            <div>
              <small>После следующего кристалла</small>
              <strong>{points(Number(state.next_payout ?? 0))} ш.</strong>
            </div>
          )}
        </div>
        <div className="casino-mine-grid">
          {Array.from({ length: 25 }, (_, index) => (
            <button
              key={index}
              aria-label={`Клетка ${index + 1}${opened.includes(index) ? ', открыта' : ''}`}
              className={mines.includes(index) ? 'mine' : opened.includes(index) ? 'safe' : ''}
              disabled={busy || state.done || opened.includes(index)}
              onClick={() => move('open', { cell: index })}
            >
              {mines.includes(index) ? '✹' : opened.includes(index) ? '◆' : '·'}
            </button>
          ))}
        </div>
      </>
    );
  }
  if (round.game === 'ladder') {
    const choices = state.choices as number[];
    const hazards = state.hazards as number[][] | undefined;
    return (
      <>
        <div className="casino-next-step">
          <div>
            <small>Безопасный шаг</small>
            <strong>{(state.next_probability as number[] | undefined)?.join(' / ')}</strong>
          </div>
          <div>
            <small>Пройдено уровней</small>
            <strong>{choices.length} / 8</strong>
          </div>
        </div>
        <div className="casino-ladder">
          {Array.from({ length: 8 }, (_, level) => (
            <div key={level}>
              <span>
                {level + 1}
                <small>
                  {points((state.level_payouts as number[] | undefined)?.[level] ?? 0)} ш.
                </small>
              </span>
              {Array.from({ length: 3 }, (_, cell) => (
                <button
                  key={cell}
                  disabled={busy || state.done || choices.length !== level}
                  aria-label={`Уровень ${level + 1}, клетка ${cell + 1}`}
                  className={
                    hazards?.[level].includes(cell) ? 'mine' : choices[level] === cell ? 'safe' : ''
                  }
                  onClick={() => move('choose', { cell })}
                >
                  {hazards?.[level].includes(cell) ? '✹' : choices[level] === cell ? '◆' : '?'}
                </button>
              ))}
            </div>
          ))}
        </div>
      </>
    );
  }
  const shots = state.shots as { zone: number; defended: number; goal: boolean }[];
  const defense = state.defense as number[],
    payouts = state.next_payouts as number[];
  return (
    <>
      <PenaltyScene
        shots={shots}
        defense={defense}
        payouts={payouts}
        disabled={busy || state.done}
        shoot={(zone) => move('shoot', { zone })}
      />
    </>
  );
}
