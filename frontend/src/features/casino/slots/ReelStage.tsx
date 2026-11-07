import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { ART, displayGrid, isWinning, type Frame, type Variant } from './model';
import { REEL, reelFrame, reelPlan, reelStrip } from './motion';

export function ReelStage({
  frame,
  previous,
  variant,
  fast,
  instant,
  landed,
  lines,
  onLanded,
  onStopping,
  selectedLocks,
  onToggleLock,
}: {
  frame?: Frame;
  previous?: Frame;
  variant: Variant;
  fast: boolean;
  instant: boolean;
  landed: boolean;
  lines?: number[][];
  onLanded: () => void;
  onStopping?: () => void;
  selectedLocks?: number[];
  onToggleLock?: (column: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const speed = useRef(fast).current;
  // The parent keys this stage by spin/revision. Polling the same result must
  // never replace its presentation or restart its animation.
  const presentation = useRef({
    grid: displayGrid(frame, variant),
    before: displayGrid(previous, variant),
    held: frame?.locked ?? [],
  }).current;
  const { grid, before, held } = presentation;
  const strips = useMemo(
    () => grid.map((column, col) => reelStrip(before[col] ?? column, column, ART[variant], col)),
    [grid, before, variant],
  );
  const finished = useRef(false);
  const cascade = variant === 'cascade' && previous?.spin != null && previous.spin === frame?.spin;
  const rows = grid[0].length,
    cellHeight = REEL.height / rows;
  useLayoutEffect(() => {
    if (finished.current) return;
    const nodes = Array.from(root.current!.querySelectorAll<HTMLElement>('.slot-reel'));
    const plans = nodes.map((_, col) => reelPlan(col, speed));
    const start = performance.now();
    let animation = 0;
    const stopped = new Set<number>();
    let stoppingAnnounced = false;
    const paint = (now: number) => {
      let allDone = true;
      nodes.forEach((node, col) => {
        if (stopped.has(col)) return;
        const state = reelFrame(
          plans[col],
          instant || cascade || held.includes(col) ? Infinity : now - start,
        );
        node.dataset.phase = state.phase;
        node.querySelector<HTMLElement>('.slot-reel-strip')!.style.transform =
          `translateY(${-state.position * cellHeight}px)`;
        if (state.phase !== 'stopped') allDone = false;
        else stopped.add(col);
        if (
          !instant &&
          !held.includes(col) &&
          !stoppingAnnounced &&
          (state.phase === 'braking' || state.phase === 'stopped')
        ) {
          stoppingAnnounced = true;
          onStopping?.();
        }
      });
      if (allDone && (!cascade || instant || now - start >= (speed ? 140 : 420))) {
        finished.current = true;
        onLanded();
      } else animation = requestAnimationFrame(paint);
    };
    // Set held strips to their final coordinates before the first browser paint.
    paint(start);
    return () => cancelAnimationFrame(animation);
  }, [speed, instant, cascade, cellHeight, onLanded, onStopping, held]);
  return (
    <div
      ref={root}
      className={`slot-reel-stage ${cascade && !instant ? 'falling' : ''} ${landed ? 'revealed' : ''}`}
      style={
        {
          '--slot-cell-height': `${cellHeight}px`,
          '--slot-fall-time': speed ? '140ms' : '420ms',
          gridTemplateColumns: `repeat(${grid.length}, minmax(0, 1fr))`,
        } as CSSProperties
      }
    >
      {grid.map((column, col) => {
        const strip = strips[col];
        return (
          <div
            key={col}
            className="slot-reel"
            data-column={col}
            data-locked={(selectedLocks ?? held).includes(col) || undefined}
            role={onToggleLock ? 'button' : undefined}
            tabIndex={onToggleLock ? 0 : undefined}
            aria-label={
              onToggleLock
                ? `Барабан ${col + 1}: ${(selectedLocks ?? held).includes(col) ? 'снять фиксацию' : 'зафиксировать'}`
                : undefined
            }
            aria-pressed={onToggleLock ? (selectedLocks ?? held).includes(col) : undefined}
            onClick={onToggleLock ? () => onToggleLock(col) : undefined}
            onKeyDown={
              onToggleLock
                ? (e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      onToggleLock(col);
                    }
                  }
                : undefined
            }
          >
            <div className="slot-reel-strip" aria-hidden="true">
              {strip.map((symbol, index) => (
                <div
                  key={index}
                  className={`slot-symbol ${landed && index >= reelPlan(col, false).target && isWinning(frame, col, index - reelPlan(col, false).target, lines) ? 'lit' : ''}`}
                >
                  {symbol}
                </div>
              ))}
            </div>
            {cascade && (
              <div className="slot-cascade-overlay" aria-hidden="true">
                {column.map((symbol, row) => {
                  const removed = previous?.removed?.[col] ?? [];
                  const survivors = (previous?.grid?.[col] ?? [])
                    .map((_, i) => i)
                    .filter((i) => !removed.includes(i));
                  const oldRow =
                    row < removed.length ? row - removed.length : survivors[row - removed.length];
                  return (
                    <div
                      key={row}
                      style={{ '--fall-distance': row - oldRow } as CSSProperties}
                      className={`slot-symbol ${landed && isWinning(frame, col, row, lines) ? 'lit' : ''}`}
                    >
                      {symbol}
                    </div>
                  );
                })}
              </div>
            )}
            {variant === 'hold' &&
              before[col].map((symbol, row) =>
                previous?.coins?.[row * 5 + col] ? (
                  <div
                    key={row}
                    className="slot-symbol slot-locked lit"
                    style={{ top: row * cellHeight }}
                    aria-label={`Закреплено ${symbol}`}
                  >
                    {symbol}
                  </div>
                ) : null,
              )}
            <span className="sr-only">{landed ? column.join(' · ') : 'Барабан вращается'}</span>
          </div>
        );
      })}
    </div>
  );
}
