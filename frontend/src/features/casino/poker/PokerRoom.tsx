import { useRef, useState } from 'react';
import { points } from '../../../shared/api';
import type { Table } from './types';
import { TableScene } from './TableScene';
import { ActionPanel } from './ActionPanel';
import { History } from './History';
import { parseAmount, type Round } from './presentation';
import './holdem.css';
import './motion.css';

export function PokerRoom({
  table,
  round,
  busy,
  available,
  active,
  amount,
  setAmount,
  send,
}: {
  table: Table;
  round: Round | null;
  busy: boolean;
  available: number;
  active: boolean;
  amount: string;
  setAmount: (amount: string) => void;
  send: (action: string, value?: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const buyIn = parseAmount(amount);
  const affordable =
    buyIn !== null && buyIn >= table.minimum && buyIn <= table.maximum && buyIn <= available;
  const playing = round?.status === 'playing';
  const myTurn =
    playing && round.player !== null && round.player === round.state.turn && !round.state.done;
  const leaving = table.player !== null && table.seats[table.player]?.leaving;
  const leave = () => {
    if (playing) {
      setConfirm(true);
      dialog.current?.showModal();
    } else send('leave');
  };
  return (
    <section className="holdem-room">
      <header className="holdem-header">
        <div>
          <strong>{table.bots ? 'Стол с ботами' : 'Только люди'} · NL Hold’em</strong>
          <small>
            Блайнды {points(table.small_blind)}/{points(table.big_blind)} · Шейкели
          </small>
        </div>
        <details className="holdem-menu">
          <summary aria-label="Меню стола">⋯</summary>
          {table.player !== null ? (
            <button disabled={busy || !!leaving} onClick={leave}>
              {leaving ? 'Выход после раздачи запрошен' : 'Покинуть стол'}
            </button>
          ) : (
            <span>Вы наблюдаете</span>
          )}
        </details>
      </header>
      <div className="holdem-room-layout">
        <div className="holdem-play-area">
          <TableScene table={table} round={round} />
          {myTurn ? (
            <ActionPanel
              key={`${round.id}:${round.deadline}:${round.state.current_bet}:${round.state.options.raise_max}`}
              round={round}
              busy={busy}
              bigBlind={table.big_blind}
              send={send}
            />
          ) : (
            <div className="holdem-wait-status" role="status">
              {playing
                ? round?.player !== null && round?.state.players[round.player]?.folded
                  ? 'Вы сделали фолд · дождитесь окончания раздачи'
                  : `Ход ${round?.labels[round.state.turn ?? -1]?.label ?? 'завершается'}`
                : 'Ожидание следующей раздачи'}
            </div>
          )}
        </div>
        <aside className="holdem-secondary">
          {round && <small className="holdem-hand-number">Раздача {round.id.slice(0, 8)}</small>}
          {table.player === null && (
            <div className="holdem-join">
              <label>
                Вход, шейкели
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={busy}
                />
              </label>
              <small>
                {points(table.minimum)}–{points(table.maximum)}. Стек занят до выхода со стола.
              </small>
              <button
                disabled={
                  busy ||
                  table.enabled === false ||
                  active ||
                  !affordable ||
                  table.seats.length >= 6 ||
                  playing
                }
                onClick={() => send('join')}
              >
                {active
                  ? 'Есть активная игра'
                  : playing
                    ? 'Игра идёт'
                    : table.seats.length >= 6
                      ? 'Стол заполнен'
                      : buyIn !== null && buyIn > available
                        ? 'Недостаточно средств'
                        : !affordable
                          ? 'Введите сумму входа'
                          : 'Занять место'}
              </button>
            </div>
          )}
          <History round={round} />
          {round?.state.settlement && (
            <div className="holdem-settlement">
              <strong>Раздача завершена</strong>
              {round.state.settlement.pots.map((pot, i) => (
                <p key={i}>
                  Банк {i + 1}: {points(pot.amount)}
                  <br />
                  {pot.winners.map((w) => round.labels[w].label).join(', ')}
                </p>
              ))}
              <small>Комиссия {points(round.state.settlement.commission)}</small>
            </div>
          )}
        </aside>
      </div>
      <dialog
        ref={dialog}
        className="holdem-leave-dialog"
        onClose={() => setConfirm(false)}
        aria-label="Выход из-за стола"
      >
        {confirm && (
          <>
            <h3>Покинуть стол после раздачи?</h3>
            <p>
              Участие в текущей раздаче продолжается. Свободный стек вернётся в кошелёк после её
              завершения.
            </p>
            <button autoFocus onClick={() => dialog.current?.close()}>
              Остаться
            </button>
            <button
              disabled={busy}
              onClick={() => {
                dialog.current?.close();
                send('leave');
              }}
            >
              Выйти после раздачи
            </button>
          </>
        )}
      </dialog>
    </section>
  );
}
