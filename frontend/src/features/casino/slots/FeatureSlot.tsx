import { useCallback, useEffect, useState } from 'react';
import type { CasinoGame, CasinoRound } from '../types';
import { points } from '../../../shared/api';
import { ReelStage } from './ReelStage';
import { TITLES, type Frame, type Variant } from './model';
import './features.css';

type Wheel = {
  level: number;
  sectors: number[];
  awards?: number[];
  selected: number;
  award: number;
};
type Move = (action: string, options?: Record<string, unknown>) => void;

function StreakDecision({ round, busy, move }: { round: CasinoRound; busy: boolean; move: Move }) {
  const s = round.state,
    steps = s.steps as number[],
    stage = Number(s.stage);
  return (
    <div className="streak-decision">
      <div className="streak-steps">
        {steps.map((step, i) => (
          <span className={i === Math.max(0, stage - 1) ? 'current' : ''} key={step}>
            ×{step}
          </span>
        ))}
      </div>
      <div className="streak-amounts">
        <span>
          Защищено всего<strong>{points(Number(s.secured_payout))} ш.</strong>
        </span>
        <span>
          Банк серии<strong>{points(Number(s.bank))} ш.</strong>
        </span>
      </div>
      <p>
        Последний spin: +{points(Number(s.last_base))} ш. на баланс.{' '}
        {s.done
          ? s.outcome === 'bank_lost'
            ? `Потерян банк ${points(Number(s.lost_bank))} ш. Следующая серия — ×1.`
            : 'Банк выплачен, серия завершена.'
          : `Следующий spin — ×${steps[stage]}. Рискуете только банком: ${points(Number(s.bank))} ш.`}
      </p>
      <div className="feature-actions">
        <button disabled={busy || s.done} onClick={() => move('collect')}>
          Забрать банк {points(Number(s.bank))} ш.
        </button>
        <button className="primary" disabled={busy || s.done} onClick={() => move('continue')}>
          Продолжить · без доплаты
        </button>
      </div>
    </div>
  );
}

function BonusWheel({
  wheel,
  fast,
  instant,
  done,
}: {
  wheel: Wheel;
  fast: boolean;
  instant: boolean;
  done: () => void;
}) {
  const [turn, setTurn] = useState(instant),
    [revealed, setRevealed] = useState(instant);
  const duration = fast ? 900 : 3400;
  const target = 360 * 5 - ((wheel.selected + 0.5) * 360) / wheel.sectors.length;
  useEffect(() => {
    if (instant) {
      setTurn(true);
      setRevealed(true);
      done();
      return;
    }
    const start = setTimeout(() => setTurn(true), fast ? 180 : 900);
    const finish = setTimeout(
      () => {
        setRevealed(true);
        done();
      },
      duration + (fast ? 180 : 900) + 50,
    );
    return () => {
      clearTimeout(start);
      clearTimeout(finish);
    };
  }, [instant, fast, duration, done]);
  return (
    <div className="slot-wheel-scene">
      <p>
        {revealed ? 'НАГРАДА КОЛЕСА' : turn ? 'КОЛЕСО ВРАЩАЕТСЯ' : 'ЖЕТОНЫ СТАНОВЯТСЯ СЕКТОРАМИ'} ·
        уровень {wheel.level}
      </p>
      <div className="slot-bonus-wheel">
        <i className="slot-wheel-pointer" aria-hidden="true">
          ▼
        </i>
        <div
          className="slot-wheel-disc"
          style={{
            transform: `rotate(${turn ? target : 0}deg)`,
            transition: instant ? 'none' : `transform ${duration}ms cubic-bezier(.12,.64,.15,1)`,
          }}
        >
          {wheel.sectors.map((value, i) => (
            <span
              key={i}
              style={{
                transform: `rotate(${((i + 0.5) * 360) / wheel.sectors.length}deg) translateY(-117px)`,
              }}
            >
              {wheel.awards ? points(wheel.awards[i]) : `×${value}`}
            </span>
          ))}
        </div>
        <b className="slot-wheel-hub">🎡</b>
      </div>
      <strong role="status">{revealed ? `+${points(wheel.award)} ш.` : '•••'}</strong>
      {wheel.awards && <small>На секторах — выплата в шейкелях</small>}
    </div>
  );
}

export function FeatureSlot({
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
  move: Move;
  busy: boolean;
}) {
  const [reduced, setReduced] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [skip, setSkip] = useState(!animate || reduced);
  const [landed, setLanded] = useState(!animate || reduced || !round);
  const [ready, setReady] = useState(!animate || reduced || !round);
  const [wheelOpen, setWheelOpen] = useState(!animate || reduced);
  const variant = game.id.replace('slots_', '') as Variant;
  const frame = (round?.state.frames as Frame[] | undefined)?.[0];
  const wheel = round?.state.wheel as Wheel | null | undefined;
  const didLand = useCallback(() => setLanded(true), []);
  const complete = useCallback(() => {
    setReady(true);
    onFinished();
  }, [onFinished]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (reduced) {
      setSkip(true);
      setLanded(true);
    }
  }, [reduced]);
  useEffect(() => {
    if (!round || !landed) return;
    if (!wheel) {
      complete();
      return;
    }
    const timer = setTimeout(() => setWheelOpen(true), skip ? 0 : fast ? 350 : 1000);
    return () => clearTimeout(timer);
  }, [round, landed, wheel, skip, fast, complete]);
  return (
    <div
      className={`slot-machine slot-feature variant-${variant} ${landed ? 'settled' : 'running'}`}
    >
      <div className="slot-marquee">
        <span>{TITLES[variant]}</span>
        <i>◆ ◆ ◆</i>
      </div>
      <div className="slot-status">
        <span>
          {!round
            ? game.rules.description
            : !landed
              ? 'Барабаны вращаются'
              : round.state.done
                ? 'Раунд завершён'
                : 'Ваше решение'}
        </span>
        <button
          disabled={!round || ready}
          onClick={() => {
            setSkip(true);
            setLanded(true);
          }}
        >
          Показать итог
        </button>
      </div>
      <div className="feature-stage">
        {wheelOpen && wheel ? (
          <BonusWheel wheel={wheel} fast={fast} instant={skip} done={complete} />
        ) : (
          <>
            <div className="slot-window">
              <ReelStage
                frame={frame}
                variant={variant}
                fast={fast}
                instant={skip || !round}
                landed={landed}
                lines={game.rules.lines as number[][]}
                onLanded={didLand}
              />
            </div>
            {variant === 'wheel' && landed && (
              <div className="wheel-tokens">
                {((round?.state.tokens ?? []) as { value: number }[]).map((t, i) => (
                  <span key={i}>🎡 ×{t.value}</span>
                ))}
                <p>
                  {wheel
                    ? 'Собранные жетоны переходят в колесо'
                    : 'Для бонуса нужны 3–5 жетонов Wheel'}
                </p>
              </div>
            )}
            {round && landed && variant === 'streak' && (
              <StreakDecision round={round} busy={busy || !ready} move={move} />
            )}
          </>
        )}
      </div>
      <div className="slot-win-zone" role="status">
        <small>
          {!round
            ? 'ГОТОВ К ИГРЕ'
            : !ready
              ? 'РЕЗУЛЬТАТ ПОСЛЕ АНИМАЦИИ'
              : round.state.done
                ? 'ВСЕГО ВЫПЛАЧЕНО'
                : 'ТЕКУЩИЙ РЕЗУЛЬТАТ'}
        </small>
        <strong>
          {!round
            ? '◆'
            : !ready
              ? '•••'
              : `${points(Number(round.state.done ? round.state.payout : variant === 'lock' ? round.state.current_payout : round.state.secured_payout))} ш.`}
        </strong>
        <span>
          {variant === 'streak'
            ? 'Защищённые выплаты не отбираются при продолжении'
            : 'Одна ставка оплачивает весь раунд'}
        </span>
      </div>
    </div>
  );
}
