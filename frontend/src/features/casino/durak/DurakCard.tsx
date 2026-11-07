import type { PlayingCard } from '../types';

export const cardKey = (card: PlayingCard) => `${card.rank}-${card.suit}`;
export function cardLabel(card: PlayingCard) {
  return `${({ 11: 'Валет', 12: 'Дама', 13: 'Король', 14: 'Туз' } as Record<number, string>)[card.rank] ?? card.rank} ${['пики', 'червы', 'трефы', 'бубны'][card.suit]}`;
}
export function DurakCard({
  card,
  onClick,
  disabled,
  zone,
  selected,
}: {
  card?: PlayingCard;
  onClick?: () => void;
  disabled?: boolean;
  zone?: string;
  selected?: boolean;
}) {
  const Tag = onClick ? 'button' : 'div';
  const rank = card
    ? (({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[card.rank] ?? card.rank)
    : '';
  const suit = card ? ['♠', '♥', '♣', '♦'][card.suit] : '◆';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`durak-card ${card && card.suit % 2 ? 'red' : ''} ${card ? '' : 'back'} ${selected ? 'selected' : ''}`}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      role={onClick ? undefined : 'img'}
      aria-label={card ? cardLabel(card) : 'Закрытая карта'}
      aria-pressed={onClick && selected !== undefined ? selected : undefined}
      data-card={card && zone ? cardKey(card) : undefined}
      data-zone={zone}
    >
      <span className="durak-corner">
        {rank}
        <i>{suit}</i>
      </span>
      <b>{suit}</b>
      <span className="durak-corner bottom" aria-hidden="true">
        {rank}
        <i>{suit}</i>
      </span>
    </Tag>
  );
}
