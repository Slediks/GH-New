import { useRef, useState } from 'react';
import type { DuelTable } from '../duelTypes';
import { Deck, Hand, Opponents, Trick } from './parts';
import { useCardMotion } from './motion';
import { TurnStatus, TurnActions } from './controls';
import './durak.css';

export function DurakTable({
  table,
  busy,
  move,
}: {
  table: DuelTable;
  busy: boolean;
  move: (action: string, options?: Record<string, unknown>) => void;
}) {
  const round = table.round!,
    state = round.state,
    board = state.board ?? [];
  const root = useRef<HTMLDivElement>(null),
    [selected, setSelected] = useState(0);
  const moving = useCardMotion(root, table);
  const myTurn = round.status === 'playing' && round.player !== null && round.player === state.turn;
  const defender = state.defender ?? 1 - (state.attacker ?? 0),
    defending = round.player === defender;
  const target =
    board[selected] && !board[selected][1] ? selected : board.findIndex((pair) => !pair[1]);
  const moves = myTurn && !busy && !moving ? (state.legal_moves ?? []) : [];
  const playable = moves.filter(
    (m) => m.action === 'attack' || (m.action === 'defend' && m.options.target === target),
  );
  const allowed = new Set(playable.map((m) => m.options.card!));
  const canTake = moves.some((m) => m.action === 'take'),
    canPass = moves.some((m) => m.action === 'pass');
  const role = defending ? 'Защита' : board.length ? 'Подкидывание' : 'Атака';
  const activeName = table.participants.find((p) => p.player === state.turn)?.label ?? 'соперник';
  const label =
    round.status === 'finished'
      ? 'Партия завершена'
      : myTurn
        ? `Ваш ход · ${role}`
        : `Ход соперника · ${activeName}`;
  const passLabel = state.taking
    ? 'Закончить ход'
    : table.participants.filter((p) => !state.finished?.includes(p.player)).length === 2 &&
        board.every((pair) => !!pair[1])
      ? 'Бито'
      : 'Пас';
  return (
    <div ref={root} className="durak-table" aria-label="Игровой стол дурака">
      <Opponents table={table} />
      <div className="durak-center">
        <div className="durak-discard" data-anchor="discard">
          <span>Отбой</span>
          <small>{state.discard?.length ?? 0} карт</small>
        </div>
        <Trick
          board={board}
          target={target}
          select={setSelected}
          defending={myTurn && defending && !busy && !moving}
        />
        <Deck card={state.trump_card!} count={state.deck_size ?? 0} />
      </div>
      <TurnStatus
        label={label}
        myTurn={myTurn}
        defending={defending}
        taking={!!state.taking}
        hasBoard={!!board.length}
      />
      <Hand
        player={round.player}
        cards={state.cards ?? []}
        allowed={allowed}
        play={(index) => {
          const choice = playable.find((m) => m.options.card === index);
          if (choice) move(choice.action, choice.options);
        }}
      />
      <TurnActions
        canTake={canTake}
        canPass={canPass}
        passLabel={passLabel}
        spectator={round.player === null}
        move={move}
      />
    </div>
  );
}
