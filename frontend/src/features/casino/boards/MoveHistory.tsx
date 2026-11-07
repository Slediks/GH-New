import { useEffect, useRef } from 'react';
import type { BoardTable, HistoryEntry } from './types';

export function MoveHistory({
  entries,
  participants,
}: {
  entries: HistoryEntry[];
  participants: BoardTable['participants'];
}) {
  const feed = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const last = entries.at(-1);
  useEffect(() => {
    if (following.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [last?.number, last?.text]);
  return (
    <section className="board-move-history" aria-label="Последние ходы">
      <h3>Последние ходы</h3>
      {!entries.length ? (
        <p className="muted">Ходов пока нет</p>
      ) : (
        <div
          ref={feed}
          className="board-move-feed"
          tabIndex={0}
          aria-label="История ходов"
          onScroll={() => {
            const el = feed.current!;
            following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
        >
          <ol>
            {entries.map((entry, index) => {
              const player = participants.find((p) => p.player === entry.player);
              return (
                <li key={entry.number} className={index === entries.length - 1 ? 'is-latest' : ''}>
                  <span className="board-move-number">{entry.number}.</span>
                  <div>
                    <div className="board-move-author">
                      <strong title={player?.label}>
                        {player?.label ?? (entry.player === 0 ? 'Белые' : 'Чёрные')}
                      </strong>
                      {!!entry.dice.length && (
                        <span
                          className="board-move-dice"
                          aria-label={`Кубики ${entry.dice.join(' и ')}`}
                        >
                          {entry.dice.join('–')}
                        </span>
                      )}
                    </div>
                    <p>{entry.text}</p>
                    {index === entries.length - 1 && (
                      <small>{entry.complete ? 'Последний ход' : 'Ход продолжается'}</small>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
