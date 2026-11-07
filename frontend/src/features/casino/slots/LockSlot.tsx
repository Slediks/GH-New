import { useCallback, useEffect, useState } from 'react';
import { points } from '../../../shared/api';
import type { CasinoGame, CasinoRound } from '../types';
import { ReelStage } from './ReelStage';
import { TITLES, type Frame } from './model';
import './features.css';

type Phase = 'idle' | 'spinning' | 'stopping' | 'selecting_locks' | 'respining' | 'finished';
const STATUS: Record<Phase, string> = {
  idle: 'Выберите ставку и запустите барабаны',
  spinning: 'Барабаны вращаются',
  stopping: 'Барабаны останавливаются',
  selecting_locks: 'Выберите барабаны, которые хотите оставить',
  respining: 'Незакреплённые барабаны вращаются',
  finished: 'Раунд завершён',
};

// Mounted once per server revision; polling and selection retain this instance.
export function LockSlot({
  round,
  game,
  fast,
  animate,
  onFinished,
  move,
  busy,
}: {
  round: CasinoRound | null;
  game: CasinoGame;
  fast: boolean;
  animate: boolean;
  onFinished: () => void;
  move: (action: string, options?: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const frame = (round?.state.frames as Frame[] | undefined)?.[0];
  const [instant, setInstant] = useState(
    () => !animate || matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [phase, setPhase] = useState<Phase>(() =>
    !round
      ? 'idle'
      : instant
        ? round.state.done
          ? 'finished'
          : 'selecting_locks'
        : Number(round.state.revision) > 0
          ? 'respining'
          : 'spinning',
  );
  const [locked, setLocked] = useState<number[]>(frame?.locked ?? []);
  const moving = phase === 'spinning' || phase === 'stopping' || phase === 'respining';
  const landed = !moving;
  const stop = useCallback(
    () => setPhase((p) => (p === 'spinning' || p === 'respining' ? 'stopping' : p)),
    [],
  );
  const finish = useCallback(() => {
    setPhase(!round ? 'idle' : round.state.done ? 'finished' : 'selecting_locks');
    if (round) onFinished();
  }, [round?.id, round?.state.done, onFinished]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      if (media.matches) setInstant(true);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const selecting = phase === 'selecting_locks';
  const canSelect = selecting && !busy && !animate;
  const toggle = (col: number) =>
    setLocked((v) => (v.includes(col) ? v.filter((i) => i !== col) : [...v, col]));
  return (
    <div
      className={`slot-machine slot-feature variant-lock ${landed ? 'settled' : 'running'}`}
      data-phase={phase}
    >
      <div className="slot-marquee">
        <span>{TITLES.lock}</span>
        <i>◆ ◆ ◆</i>
      </div>
      <div className="slot-status">
        <span>{STATUS[phase]}</span>
        <button disabled={!moving} onClick={() => setInstant(true)}>
          Показать итог
        </button>
      </div>
      <div className="feature-stage">
        <div className="slot-window">
          <ReelStage
            frame={frame}
            variant="lock"
            fast={fast}
            instant={instant || !round}
            landed={landed}
            lines={(round?.rules?.lines ?? game.rules.lines) as number[][]}
            onLanded={finish}
            onStopping={stop}
            selectedLocks={locked}
            onToggleLock={canSelect ? toggle : undefined}
          />
        </div>
        <div className="lock-decision-space">
          {round && selecting && (
            <div className="lock-decision">
              <div className="lock-switches">
                {Array.from({ length: 5 }, (_, col) => (
                  <button
                    key={col}
                    aria-label={`Зафиксировать барабан ${col + 1}`}
                    aria-pressed={locked.includes(col)}
                    disabled={!canSelect}
                    onClick={() => toggle(col)}
                  >
                    {locked.includes(col) ? '🔒 LOCK' : '○ Оставить'}
                    <small>Барабан {col + 1}</small>
                  </button>
                ))}
              </div>
              <p>
                Осталось повторов: <b>{String(round.state.remaining)}</b> · Прокрутятся:{' '}
                {Array.from({ length: 5 }, (_, i) => i)
                  .filter((i) => !locked.includes(i))
                  .map((i) => i + 1)
                  .join(', ') || 'ни один'}
              </p>
              <div className="feature-actions">
                <button disabled={!canSelect} onClick={() => move('collect')}>
                  Забрать {points(Number(round.state.current_payout))} ш.
                </button>
                <button
                  className="primary"
                  disabled={!canSelect}
                  onClick={() => move('respin', { locked })}
                >
                  Повторить · без доплаты
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="slot-win-zone" role="status">
        <small>
          {moving
            ? 'РЕЗУЛЬТАТ ПОСЛЕ ОСТАНОВКИ'
            : phase === 'finished'
              ? 'ВСЕГО ВЫПЛАЧЕНО'
              : 'ТЕКУЩИЙ РЕЗУЛЬТАТ'}
        </small>
        <strong>
          {!round
            ? '◆'
            : moving
              ? '•••'
              : `${points(Number(round.state.done ? round.state.payout : round.state.current_payout))} ш.`}
        </strong>
        <span>Одна ставка оплачивает весь раунд</span>
      </div>
    </div>
  );
}
