import { DurakCard, cardKey } from './DurakCard';
import type { DuelTable } from '../duelTypes';
import type { PlayingCard } from '../types';

export function Opponents({ table }: { table: DuelTable }) {
  const round = table.round!,
    state = round.state;
  return (
    <div className="durak-opponents">
      {table.participants
        .filter((p) => p.player !== round.player)
        .map((player) => (
          <section
            key={player.player}
            data-seat={player.player}
            className={`durak-opponent ${round.status === 'playing' && state.turn === player.player ? 'active' : ''}`}
          >
            <strong>
              {player.label}
              {player.bot && <small>БОТ</small>}
            </strong>
            <div className="durak-hidden-hand" aria-hidden="true">
              {Array.from(
                { length: Math.min(10, state.hand_sizes?.[player.player] ?? 0) },
                (_, i) => (
                  <DurakCard key={i} />
                ),
              )}
            </div>
            <span>
              {state.hand_sizes?.[player.player] ?? 0} карт
              {state.finished?.includes(player.player)
                ? ' · Закончил'
                : state.turn === player.player && round.status === 'playing'
                  ? ' · Ход'
                  : ''}
            </span>
          </section>
        ))}
    </div>
  );
}

export function Deck({ card, count }: { card: PlayingCard; count: number }) {
  return (
    <div className="durak-deck" data-anchor="deck">
      <div className="durak-deck-stack">
        <div className="durak-trump">
          <DurakCard card={card} />
        </div>
        {count > 0 && <DurakCard />}
      </div>
      <span>
        {count} карт · козырь {['♠', '♥', '♣', '♦'][card.suit]}
      </span>
    </div>
  );
}

export function Trick({
  board,
  target,
  select,
  defending,
}: {
  board: (PlayingCard | null)[][];
  target: number;
  select: (index: number) => void;
  defending: boolean;
}) {
  return (
    <div className="durak-trick" aria-label="Карты розыгрыша">
      {!board.length && <p>Место для атаки</p>}
      {board.map((pair, index) => (
        <div className="durak-pair" key={cardKey(pair[0]!)}>
          <DurakCard
            card={pair[0]!}
            zone="board"
            onClick={defending && !pair[1] ? () => select(index) : undefined}
            selected={defending && !pair[1] ? target === index : undefined}
          />
          {pair[1] && (
            <div className="durak-cover">
              <DurakCard card={pair[1]} zone="board" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Hand({
  cards,
  allowed,
  play,
  player,
}: {
  cards: PlayingCard[];
  allowed: Set<number>;
  play: (index: number) => void;
  player: number | null;
}) {
  return (
    <div className="durak-player-hand" data-seat={player ?? 'viewer'} aria-label="Ваша рука">
      {cards.map((card, index) => (
        <DurakCard
          key={cardKey(card)}
          card={card}
          zone="hand"
          disabled={!allowed.has(index)}
          onClick={() => play(index)}
        />
      ))}
    </div>
  );
}
