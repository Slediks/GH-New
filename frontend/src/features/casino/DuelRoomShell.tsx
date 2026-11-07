import { DecisionTimer } from './DecisionTimer';
import type { ReactNode } from 'react';
import { points } from '../../shared/api';
import type { DuelTable } from './duelTypes';
import './duelRoom.css';

function availability(table: DuelTable) {
  const round = table.round;
  const finished = round?.status === 'finished';
  const occupied = finished ? 0 : table.participants.length;
  const free = Math.max(0, (table.capacity ?? 2) - occupied);
  const seated = !!round && !finished && round.player !== null;
  const joinable =
    table.enabled !== false &&
    (!round || finished || round.status === 'waiting') &&
    !seated &&
    free > 0;
  const status = finished
    ? 'Игра завершена'
    : round?.status === 'playing'
      ? 'Игра идёт'
      : free === 0
        ? 'Стол заполнен'
        : 'Ожидание игроков';
  return { occupied, free, seated, joinable, status, finished };
}

export function DuelRoomShell({
  table,
  name,
  busy,
  available,
  active,
  join,
  leave,
  children,
}: {
  table: DuelTable;
  name: string;
  busy: boolean;
  available: number;
  active: boolean;
  join: () => void;
  leave: () => void;
  children: ReactNode;
}) {
  const room = availability(table),
    round = table.round,
    state = round?.state;
  const winners = table.participants.filter(
    (player) => state?.winners?.includes(player.player) || state?.winner === player.player,
  );
  const result = winners.length
    ? `Победители: ${winners.map((player) => player.label).join(', ')}`
    : state?.winner === null
      ? 'Ничья / возврат'
      : 'Партия завершена';
  return (
    <section className="duel-room" data-round-id={round?.id}>
      <header className="duel-room-header">
        <div>
          <small className="duel-room-eyebrow">
            Игровая комната · {table.bots ? 'С ботами' : 'Только люди'}
          </small>
          <h3>{name}</h3>
          <span>
            {room.finished ? 'Вход в следующую партию' : 'Вступительная ставка'}:{' '}
            {points(table.stake)} ш.
          </span>
        </div>
        <span className="duel-room-status" role="status">
          {room.status}
        </span>
      </header>
      <div className="duel-room-lobby">
        <section className="duel-room-roster" aria-label="Места за столом">
          <div className="duel-roster-heading">
            <strong>{room.finished ? 'Участники завершённой партии' : 'Участники'}</strong>
            <small>
              {room.occupied} / {table.capacity ?? 2} мест занято
            </small>
          </div>
          <div className="duel-room-seats">
            {Array.from({ length: table.capacity ?? 2 }, (_, index) => {
              const player = table.participants.find((player) => player.player === index);
              return (
                <div className={`duel-room-seat ${player ? 'occupied' : 'vacant'}`} key={index}>
                  <span className="duel-seat-number">{index + 1}</span>
                  <div>
                    <strong>{player?.label ?? 'Свободное место'}</strong>
                    <small>
                      {player
                        ? [
                            player.bot ? 'БОТ' : 'Игрок',
                            round?.player === player.player ? 'Вы' : '',
                            room.finished
                              ? 'Партия завершена'
                              : state?.turn === player.player
                                ? 'Ход'
                                : state?.finished?.includes(player.player)
                                  ? 'Без карт'
                                  : round?.status === 'waiting'
                                    ? 'Ожидает'
                                    : 'В игре',
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : 'Ожидаем участника'}
                    </small>
                    {player?.payout != null && <small>Выплата: {points(player.payout)} ш.</small>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <aside className="duel-room-entry" aria-label="Вход за стол">
          <strong>{room.seated ? 'Вы за столом' : `${room.free} свободных мест`}</strong>
          <p>
            {room.finished
              ? 'Можно присоединиться к новой партии.'
              : table.bots
                ? 'Боты отмечены в списке участников.'
                : 'За этим столом играют только люди.'}
          </p>
          <button
            className="primary"
            disabled={busy || !room.joinable || active || available < table.stake}
            onClick={join}
          >
            {busy
              ? 'Подождите…'
              : room.joinable && available < table.stake
                ? 'Недостаточно средств'
                : room.joinable && active
                  ? 'Есть активная игра'
                  : room.joinable
                    ? `Войти · ${points(table.stake)} ш.`
                    : room.seated
                      ? 'Вы уже за столом'
                      : round?.status === 'playing'
                        ? 'Игра уже идёт'
                        : room.free === 0
                          ? 'Стол заполнен'
                          : 'Вход недоступен'}
          </button>
          {round?.status === 'waiting' && room.seated && (
            <button disabled={busy} onClick={leave}>
              Отменить участие
            </button>
          )}
          {table.game === 'durak' &&
            round?.status === 'playing' &&
            round.deadline &&
            state?.turn != null && (
              <DecisionTimer
                key={`${round.id}:${state.turn}:${round.deadline}`}
                deadline={round.deadline}
                duration={45}
                ownTurn={round.player === state.turn}
                label={
                  round.player === state.turn
                    ? 'Ваш ход'
                    : `Ходит ${table.participants.find((player) => player.player === state.turn)?.label ?? 'участник'}`
                }
              />
            )}
        </aside>
      </div>
      <div className="duel-room-game">
        {state?.rolls || state?.trump_card ? (
          <section className="casino-felt casino-duel">{children}</section>
        ) : (
          <div className="duel-room-waiting">
            <span aria-hidden="true">◷</span>
            <h3>{room.finished ? 'Партия завершена' : 'Место для вашей партии'}</h3>
            <p>
              {room.seated
                ? 'Игра начнётся, когда соберутся участники.'
                : 'Выберите «Войти», чтобы занять свободное место.'}
            </p>
          </div>
        )}
      </div>
      <footer className="duel-room-notice" aria-label="Сообщения стола">
        <strong>{room.finished ? result : room.status}</strong>
        <p>
          {state?.reason ||
            (round?.status === 'waiting'
              ? `Ожидаем игроков${round.deadline ? ` до ${new Date(round.deadline * 1000).toLocaleTimeString('ru-RU')}` : ''}. Если партия не начнётся, ставка вернётся.`
              : room.finished
                ? `Комиссия: ${points(state?.commission ?? 0)} ш. Вход в следующую партию доступен в панели справа.`
                : round?.status === 'playing'
                  ? 'Партия продолжается. Доступные игровые действия показаны на поле.'
                  : 'Ставка резервируется при входе за стол.')}
        </p>
        {round && <small>Комиссия: {round.commission_bps / 100}% банка</small>}
      </footer>
    </section>
  );
}
