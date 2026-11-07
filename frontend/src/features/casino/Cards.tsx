import type { PlayingCard } from './types';

export function Cards({
  cards,
  held,
  toggle,
}: {
  cards: (PlayingCard | null)[];
  held?: number[];
  toggle?: (index: number) => void;
}) {
  return (
    <div className="casino-cards">
      {cards.map((card, index) => {
        const label = card
          ? `${({ 11: 'Валет', 12: 'Дама', 13: 'Король', 14: 'Туз' } as Record<number, string>)[card.rank] ?? card.rank} ${['пики', 'червы', 'трефы', 'бубны'][card.suit]}`
          : 'Закрытая карта';
        const content = card ? (
          <>
            <span className="casino-card-corner">
              {({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[card.rank] ??
                card.rank}
              <i>{['♠', '♥', '♣', '♦'][card.suit]}</i>
            </span>
            <b className="casino-card-emblem">{['♠', '♥', '♣', '♦'][card.suit]}</b>
            <span className="casino-card-corner bottom" aria-hidden="true">
              {({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[card.rank] ??
                card.rank}
              <i>{['♠', '♥', '♣', '♦'][card.suit]}</i>
            </span>
          </>
        ) : (
          '◆'
        );
        const className = `casino-card ${card ? (card.suit % 2 ? 'red' : '') : 'down'} ${held?.includes(index) ? 'held' : ''}`;
        return toggle ? (
          <button
            key={index}
            className={className}
            aria-label={label}
            aria-pressed={held?.includes(index)}
            onClick={() => toggle(index)}
          >
            {content}
            <small>{held ? (held.includes(index) ? 'Оставить' : 'Заменить') : 'Сыграть'}</small>
          </button>
        ) : (
          <div key={index} className={className} role="img" aria-label={label}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
