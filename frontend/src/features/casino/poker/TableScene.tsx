import { Cards } from '../Cards';
import { points } from '../../../shared/api';
import type { Table } from './types';
import { actionText, seatStatus, streets, type Round } from './presentation';
import { Timer } from './Timer';

export function Chips({ amount, className = '' }: { amount: number; className?: string }) {
  return (
    <span className={`holdem-chips ${className}`}>
      <i aria-hidden="true">●</i>
      {points(amount)}
    </span>
  );
}

function Board({ round }: { round: Round | null }) {
  const state = round?.state;
  const showdown =
    state?.done &&
    state.players.filter((p) => !p.folded).length > 1 &&
    state.street !== 'cancelled';
  return (
    <div className="holdem-board">
      <span className="holdem-street">
        {showdown
          ? 'ШОУДАУН'
          : state?.done
            ? 'Раздача завершена'
            : (streets[state?.street ?? ''] ?? 'Ожидание участников')}
      </span>
      {!!state?.board.length && (
        <div className="holdem-community" aria-label="Общие карты">
          {state.board.map((card, i) => (
            <div className="holdem-board-card" key={`${round?.id}:${i}`}>
              <Cards cards={[card]} />
            </div>
          ))}
        </div>
      )}
      <div className="holdem-pot" aria-label="Банк">
        <small>БАНК</small>
        <Chips amount={state?.players.reduce((sum, p) => sum + p.committed, 0) ?? 0} />
      </div>
    </div>
  );
}

function PlayerSeat({
  table,
  round,
  index,
  slot,
  own,
}: {
  table: Table;
  round: Round | null;
  index: number;
  slot: number;
  own: boolean;
}) {
  const label = (round ? round.labels : table.seats)[index];
  const state = round?.state,
    player = state?.players[index];
  // Round and lobby indexes may differ after seats are released; don't attach another person's lobby status.
  const lobbySeat = !round || round.status === 'playing' ? table.seats[index] : undefined;
  const active = round?.status === 'playing' && !state?.done && state?.turn === index;
  const winner = state?.settlement?.pots.some((p) => p.winners.includes(index));
  const action = state?.last_actions?.filter((a) => a.player === index).at(-1);
  const status = seatStatus(round, index, !!lobbySeat?.leaving);
  return (
    <section
      data-seat={index}
      className={`holdem-seat slot-${slot} ${own ? 'own' : ''} ${active ? 'active' : ''} ${player?.folded ? 'folded' : ''} ${winner ? 'winner' : ''}`}
      aria-label={own ? 'Ваше место' : `Место ${label.label}`}
    >
      <div className="holdem-seat-positions">
        {state?.button === index && (
          <span className="holdem-dealer" title="Дилер">
            D
          </span>
        )}
        {state?.small_blind_player === index && <span title="Малый блайнд">SB</span>}
        {state?.big_blind_player === index && <span title="Большой блайнд">BB</span>}
      </div>
      <div className="holdem-seat-info">
        <strong>
          {own ? 'Вы' : label.label} {label.bot && <small>БОТ</small>}
        </strong>
        {own && <span className="holdem-nickname">{label.label}</span>}
        <b className="holdem-stack">{points(player?.stack ?? lobbySeat?.stack ?? 0)}</b>
        {!!status && <span className="holdem-seat-status">{status}</span>}
        {lobbySeat?.leaving && status !== 'Выход после раздачи' && (
          <small className="holdem-seat-status">Выход после раздачи</small>
        )}
        {!!lobbySeat?.misses && (
          <small className="holdem-misses">⚠ Пропущено действий: {lobbySeat.misses}</small>
        )}
      </div>
      {player && (
        <div className="holdem-hole" key={round?.id}>
          <Cards cards={player.folded ? [null, null] : (player.cards ?? [null, null])} />
        </div>
      )}
      {active && round?.deadline && <Timer deadline={round.deadline} />}
      {!!player?.street_bet && (
        <div className="holdem-individual-bet" aria-label={`Ставка ${label.label}`}>
          <Chips
            key={`${round?.id}:${state?.street}:${player.street_bet}`}
            amount={player.street_bet}
            className="bet-motion"
          />
        </div>
      )}
      {action && (
        <small
          className="holdem-last-action"
          key={`${round?.id}:${action.street}:${action.action}:${action.total}`}
        >
          {actionText(action.action, action.total)}
        </small>
      )}
      {winner && (
        <span className="holdem-award" key={`${round?.id}:award`}>
          +<Chips amount={state?.settlement?.payouts[index] ?? 0} />
        </span>
      )}
    </section>
  );
}

// Clockwise seats start at the bottom; rotate the viewer here, never reorder engine indexes.
const layouts: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 5],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};
export function TableScene({ table, round }: { table: Table; round: Round | null }) {
  const labels = round ? round.labels : table.seats;
  const own = round ? round.player : table.player;
  const layout = layouts[labels.length] ?? layouts[6];
  return (
    <div className="holdem-table" aria-label="Покерный стол">
      <div className="holdem-felt" />
      <Board round={round} />
      {labels.map((_, index) => (
        <PlayerSeat
          key={`${round?.id ?? table.id}:${index}`}
          table={table}
          round={round}
          index={index}
          slot={layout[(index - (own ?? 0) + labels.length) % labels.length]}
          own={own === index}
        />
      ))}
    </div>
  );
}
