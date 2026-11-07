import { useState, type CSSProperties } from 'react';
import type { BoardState, Move } from './types';

const glyphs: Record<string, string> = {
  K: '♚',
  Q: '♛',
  R: '♜',
  B: '♝',
  N: '♞',
  P: '♟',
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
};
const names: Record<string, string> = { q: 'Ферзь', r: 'Ладья', b: 'Слон', n: 'Конь' };
export function SquareBoard({
  state,
  player,
  disabled,
  move,
}: {
  state: BoardState;
  player: number | null;
  disabled: boolean;
  move: (m: Move) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [promotion, setPromotion] = useState<Move[]>([]);
  const legal = disabled ? [] : state.legal;
  const from = state.forced ?? selected;
  const preview = from === null && hovered !== null;
  const shownFrom = from ?? hovered;
  const captureRequired = legal.some((m) => typeof m.capture === 'number');
  const squares = Array.from({ length: 64 }, (_, i) =>
    player === 1 ? Math.floor(i / 8) * 8 + 7 - (i % 8) : (7 - Math.floor(i / 8)) * 8 + (i % 8),
  );
  function choose(square: number) {
    const candidates = legal.filter((m) => m.from === from && m.to === square);
    if (candidates.length > 1 && candidates.some((m) => m.promotion)) setPromotion(candidates);
    else if (candidates.length) {
      move(candidates[0]);
      setSelected(null);
    } else {
      setSelected(selected !== square && legal.some((m) => m.from === square) ? square : null);
      setPromotion([]);
    }
  }
  return (
    <div className="board-square-wrap">
      <div className="board-squares" role="group" aria-label="Игровая доска">
        {squares.map((square) => {
          const piece = state.board?.[square] ?? '';
          const destination = legal.find((m) => m.from === shownFrom && m.to === square);
          const movable = legal.some((m) => m.from === square);
          const inactive =
            captureRequired &&
            typeof piece === 'number' &&
            piece !== 0 &&
            (piece > 0 ? 0 : 1) === player &&
            !movable;
          const white = typeof piece === 'number' ? piece > 0 : piece === piece.toUpperCase();
          const coordinate = `${'abcdefgh'[square % 8]}${Math.floor(square / 8) + 1}`;
          const origin = state.last_move?.to === square ? (state.last_move.from ?? square) : square;
          const travel = {
            '--travel-x': `${((origin % 8) - (square % 8)) * (player === 1 ? -100 : 100)}%`,
            '--travel-y': `${(Math.floor(origin / 8) - Math.floor(square / 8)) * (player === 1 ? 100 : -100)}%`,
          } as CSSProperties;
          return (
            <button
              key={square}
              className={`board-square ${((square % 8) + Math.floor(square / 8)) % 2 ? 'light' : 'dark'} ${from === square ? 'selected' : ''} ${destination ? 'legal' : ''} ${preview && (destination || shownFrom === square) ? 'preview' : ''} ${inactive ? 'inactive' : ''} ${captureRequired && movable ? 'must-capture' : ''} ${state.check === square ? 'check' : ''} ${state.last_move?.to === square || state.last_move?.from === square ? 'last' : ''}`}
              aria-label={`${coordinate}${piece ? ` · ${typeof piece === 'number' ? 'шашка' : piece}` : ''}`}
              aria-pressed={from === square}
              onClick={() => choose(square)}
              onMouseEnter={() => setHovered(movable ? square : null)}
              onMouseLeave={() => setHovered(null)}
              aria-disabled={disabled || inactive}
              disabled={disabled}
              data-square={square}
            >
              <small>{coordinate}</small>
              {!!piece && (
                <span
                  className={`board-travel ${state.last_move?.to === square ? 'moving' : ''}`}
                  style={travel}
                >
                  <span
                    key={`${square}:${piece}:${state.last_move?.to === square ? state.revision : 'still'}`}
                    className={`board-piece ${white ? 'white' : 'black'} ${typeof piece === 'number' ? 'checker' : 'chessman'} ${state.captured?.includes(square) ? 'captured' : ''}`}
                  >
                    {typeof piece === 'number' ? (Math.abs(piece) === 2 ? '♛' : '') : glyphs[piece]}
                  </span>
                </span>
              )}
              {destination && (
                <i
                  className={
                    destination.capture !== null &&
                    destination.capture !== false &&
                    destination.capture !== undefined
                      ? 'capture'
                      : ''
                  }
                />
              )}
            </button>
          );
        })}
      </div>
      {captureRequired && (
        <small role="status">
          {state.forced != null ? 'Продолжите серию этой шашкой' : 'Обязательное взятие'}
        </small>
      )}
      {promotion.length > 0 && (
        <div className="board-promotion" role="dialog" aria-label="Превращение пешки">
          <strong>Выберите фигуру</strong>
          {promotion.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                move(m);
                setPromotion([]);
                setSelected(null);
              }}
            >
              {names[m.promotion!]}
            </button>
          ))}
          <button onClick={() => setPromotion([])}>Отмена</button>
        </div>
      )}
    </div>
  );
}
