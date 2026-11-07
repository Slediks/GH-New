import { useCallback, useEffect, useState } from 'react';
import { points } from '../../shared/api';
import type { CasinoGame, CasinoRound } from './types';
import { ReelStage } from './slots/ReelStage';
import { TITLES, type Frame, type Variant } from './slots/model';
import './slots/slots.css';

export function SlotGame({
  round,
  game,
  fast,
  animate,
  onFinished,
}: {
  round: CasinoRound | null;
  game: CasinoGame;
  fast: boolean;
  animate: boolean;
  onFinished: () => void;
}) {
  const frames = (round?.state.frames ?? []) as Frame[];
  const variant = (round?.state.variant ?? game.id.replace('slots_', '')) as Variant;
  const [reduced, setReduced] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [index, setIndex] = useState(!animate || reduced ? Math.max(0, frames.length - 1) : 0);
  const [skipped, setSkipped] = useState(!animate || reduced);
  const [landed, setLanded] = useState(!animate || reduced || !round);
  const [complete, setComplete] = useState(!animate || reduced || !round);
  const didLand = useCallback(() => setLanded(true), []);
  const skip = useCallback(() => {
    setSkipped(true);
    setIndex(Math.max(0, frames.length - 1));
    setLanded(true);
    setComplete(true);
  }, [frames.length]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => {
      setReduced(media.matches);
      if (media.matches) skip();
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [skip]);
  useEffect(() => {
    if (!round || !landed) return;
    if (index >= frames.length - 1 || skipped) {
      setComplete(true);
      onFinished();
      return;
    }
    const timer = setTimeout(
      () => {
        setLanded(false);
        setIndex((i) => i + 1);
      },
      fast ? 200 : 750,
    );
    return () => clearTimeout(timer);
  }, [round, landed, index, frames.length, skipped, fast, onFinished]);
  const frame = frames[index],
    previous = frames[index - 1];
  const accumulated = landed ? (frame?.accumulated ?? 0) : (previous?.accumulated ?? 0);
  const won = landed && accumulated > 0;
  const lines = (round?.rules?.lines ?? game.rules.lines) as number[][] | undefined;
  return (
    <div
      className={`slot-machine variant-${variant} ${landed ? 'settled' : 'running'} ${won ? 'won' : ''}`}
    >
      <div className="slot-marquee">
        <span>{TITLES[variant]}</span>
        <i aria-hidden="true">◆ ◆ ◆</i>
      </div>
      <div className="slot-status">
        <span>
          {!round
            ? 'Выберите ставку и запустите барабаны'
            : complete
              ? 'Серия завершена'
              : `${frame?.free ? 'Бесплатное вращение' : 'Вращение'} · ${landed ? 'Результат' : 'Барабаны вращаются'}`}
        </span>
        <button className="slot-skip" disabled={!round || complete} onClick={skip}>
          Показать итог
        </button>
      </div>
      <div className="slot-window">
        <ReelStage
          key={`${round?.id ?? 'idle'}-${index}`}
          frame={frame}
          previous={previous}
          variant={variant}
          fast={fast}
          instant={skipped || reduced || !round}
          landed={landed}
          lines={lines}
          onLanded={didLand}
        />
      </div>
      <div className="slot-win-zone" role="status" aria-live="polite">
        <small>
          {!round
            ? 'ГОТОВ К ИГРЕ'
            : complete
              ? 'ИТОГОВАЯ ВЫПЛАТА'
              : landed
                ? 'НАКОПЛЕНО В СЕРИИ'
                : 'ВРАЩЕНИЕ'}
        </small>
        <strong className={won ? 'slot-win-amount' : ''}>
          {!round
            ? '◆'
            : complete
              ? `${points(round.state.payout ?? 0)} ш.`
              : landed
                ? `${points(accumulated)} ш.`
                : '•••'}
        </strong>
        <span>
          {round && landed
            ? frame?.wins?.length
              ? `Линии: ${frame.wins.map((w) => `${w.line + 1} (${w.count})`).join(' · ')}`
              : accumulated
                ? 'Результат сохранён сервером'
                : 'Без выигрыша на этом этапе'
            : 'Результат раскрывается после остановки барабанов'}
        </span>
      </div>
      <div className="slot-bonus-zone">
        {landed && frame?.runes && <span>Руны: {frame.runes.map((v) => `×${v}`).join(' · ')}</span>}
        {landed && !!frame?.chest && <span>Алмазный приз: ×{frame.chest}</span>}
        {landed && frame?.multipliers && (
          <span>Множители столбцов: {frame.multipliers.map((v) => `×${v}`).join(' · ')}</span>
        )}
        {landed && frame?.coins && <span>Монет: {Object.keys(frame.coins).length}/15</span>}
        {landed && frame?.payout !== undefined && (
          <span>Выплата этапа: {points(frame.payout)} ш.</span>
        )}
      </div>
    </div>
  );
}
