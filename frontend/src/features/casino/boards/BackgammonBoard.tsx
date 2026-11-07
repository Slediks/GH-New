import { useState } from 'react';
import type { BoardState, Move } from './types';

const rows = [
  Array.from({ length: 12 }, (_, i) => 12 + i),
  Array.from({ length: 12 }, (_, i) => 11 - i),
];
export function BackgammonBoard({
  state,
  long,
  player,
  disabled,
  move,
}: {
  state: BoardState;
  long: boolean;
  player: number | null;
  disabled: boolean;
  move: (m: Move) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [choices, setChoices] = useState<Move[]>([]);
  const legal = disabled ? [] : state.legal;
  const from = selected ?? hovered;
  const preview = selected === null && hovered !== null;
  function choose(point: number) {
    const options = legal.filter((m) => m.from === selected && m.to === point);
    if (options.length === 1) {
      move(options[0]);
      setSelected(null);
      setChoices([]);
    } else if (options.length) setChoices(options);
    else {
      setSelected(selected !== point && legal.some((m) => m.from === point) ? point : null);
      setChoices([]);
    }
  }
  return (
    <div className={`nardy-scene ${long ? 'long' : 'short'}`}>
      <div
        className="nardy-dice"
        key={`${state.turn}:${state.dice?.join('-')}:${state.remaining?.length}`}
      >
        {(state.dice ?? []).map((d, i) => (
          <span key={i} aria-label={`Кубик ${d}`}>
            {'⚀⚁⚂⚃⚄⚅'[d - 1]}
          </span>
        ))}
        <strong>Осталось: {state.remaining?.join(' · ') || '—'}</strong>
      </div>
      <div
        className="nardy-board"
        role="group"
        aria-label={long ? 'Доска длинных нард' : 'Доска коротких нард'}
      >
        {rows.map((row, r) => (
          <div className={`nardy-row row-${r}`} key={r}>
            {row.map((point, i) => {
              const count = state.points?.[point] ?? 0;
              const target = legal.some((m) => m.from === from && m.to === point);
              return (
                <button
                  key={point}
                  data-point={point}
                  disabled={disabled}
                  aria-label={`Пункт ${point + 1}: ${Math.abs(count)} ${count >= 0 ? 'белых' : 'чёрных'}`}
                  className={`nardy-point ${i % 2 ? 'ochre' : 'ivory'} ${selected === point ? 'selected' : ''} ${target ? 'legal' : ''} ${preview && (target || from === point) ? 'preview' : ''} ${state.last_move?.to === point ? 'last' : ''}`}
                  onClick={() => choose(point)}
                  onMouseEnter={() =>
                    setHovered(legal.some((m) => m.from === point) ? point : null)
                  }
                  onMouseLeave={() => setHovered(null)}
                >
                  <small>{point + 1}</small>
                  <span className="nardy-stack">
                    {Array.from({ length: Math.min(5, Math.abs(count)) }, (_, n) => (
                      <i
                        key={n}
                        className={`board-piece checker ${count > 0 ? 'white' : 'black'} ${state.last_move?.to === point && n === Math.min(5, Math.abs(count)) - 1 ? 'arrived' : ''}`}
                      >
                        {n === 4 && Math.abs(count) > 5 ? Math.abs(count) : ''}
                      </i>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        <div className="nardy-center">
          {long ? (
            'ДЛИННЫЕ НАРДЫ'
          ) : (
            <>
              <span>
                Бар · белые {state.bar?.[0]} / чёрные {state.bar?.[1]}
              </span>
              <button
                disabled={disabled || !legal.some((m) => m.from === -1)}
                className={selected === -1 ? 'selected' : ''}
                onClick={() => choose(-1)}
                onMouseEnter={() => setHovered(legal.some((m) => m.from === -1) ? -1 : null)}
                onMouseLeave={() => setHovered(null)}
              >
                Вернуть с бара
              </button>
            </>
          )}
        </div>
      </div>
      <div className="nardy-off">
        <span>
          Снято: белые {state.off?.[0]} / чёрные {state.off?.[1]}
        </span>
        <button
          className={
            legal.some((m) => m.from === from && m.to === 24)
              ? `legal ${preview ? 'preview' : ''}`
              : ''
          }
          disabled={disabled || !legal.some((m) => m.from === selected && m.to === 24)}
          onClick={() => choose(24)}
        >
          Снять шашку →
        </button>
        {!disabled && !legal.length && player === state.turn && (
          <button onClick={() => move({ pass: true })}>Нет ходов · пропустить</button>
        )}
      </div>
      {choices.length > 0 && (
        <div className="actions">
          {choices.map((m) => (
            <button
              key={m.die}
              onClick={() => {
                move(m);
                setChoices([]);
                setSelected(null);
              }}
            >
              Использовать {m.die}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
