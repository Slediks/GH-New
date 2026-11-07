import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, points } from '../../../shared/api';
import { ErrorBox } from '../../../shared/UI';
import { CasinoChat } from '../Chat';
import { DecisionTimer } from '../DecisionTimer';
import { TableLobby } from '../TableLobby';
import { requestId, type CasinoGame } from '../types';
import { casinoSound } from '../sound';
import { SquareBoard } from './SquareBoard';
import { BackgammonBoard } from './BackgammonBoard';
import type { BoardTable, Move } from './types';
import './boards.css';
import { MoveHistory } from './MoveHistory';

export const BOARD_GAMES = ['chess', 'russian_checkers', 'short_backgammon', 'long_backgammon'];
const levels: Record<string, string> = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный' };

export function BoardTables({
  game,
  refresh,
  available,
  active,
  holdBalance,
}: {
  game: CasinoGame;
  refresh: () => Promise<void>;
  available: number;
  active: boolean;
  holdBalance: () => () => Promise<void>;
}) {
  const [tables, setTables] = useState<BoardTable[]>([]),
    [table, setTable] = useState<BoardTable | null>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false);
  const [difficulty, setDifficulty] = useState('medium'),
    [side, setSide] = useState('random');
  const [confirm, setConfirm] = useState(false);
  const inFlight = useRef(false),
    sequence = useRef(0),
    restored = useRef(false),
    shown = useRef('');
  const latest = useRef({ refresh, holdBalance });
  latest.current = { refresh, holdBalance };
  const pending = useRef<{ signature: string; payload: Record<string, unknown> } | null>(null);
  const release = useRef<(() => Promise<void>) | null>(null);
  function accept(value: BoardTable) {
    value.clockOffset = Date.now() / 1000 - value.server_time;
    if (
      value.round?.status === 'finished' &&
      value.round.player !== null &&
      shown.current !== value.round.id
    ) {
      shown.current = value.round.id;
      const reveal = latest.current.holdBalance();
      release.current = reveal;
      setTable(value);
      window.setTimeout(() => {
        void reveal();
        casinoSound('result');
      }, 260);
    } else setTable(value);
  }
  useEffect(() => {
    let alive = true,
      running = false;
    const load = async () => {
      if (running || inFlight.current) return;
      running = true;
      const revision = sequence.current;
      try {
        if (selected) {
          const value = await api<BoardTable>(`/casino/tables/${selected}`);
          if (alive && revision === sequence.current && !inFlight.current) accept(value);
        } else {
          const result = await api<{ items: BoardTable[] }>(`/casino/tables?game=${game.id}`);
          if (alive && revision === sequence.current) {
            setTables(result.items);
            if (!restored.current) {
              restored.current = true;
              const own = result.items.find(
                (t) => t.round && t.round.status !== 'finished' && t.round.player !== null,
              );
              if (own) {
                setTable(own);
                setSelected(own.id);
              }
            }
          }
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        running = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 1500);
    const socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('casino:watch-table', { table: selected });
      void load();
    });
    socket.on('disconnect', () => {
      if (alive) setConnected(false);
    });
    socket.on('casino:table', (message: { table: string }) => {
      if (message.table === selected) void load();
    });
    return () => {
      alive = false;
      window.clearInterval(timer);
      socket.disconnect();
    };
  }, [selected, game.id]);
  useEffect(
    () => () => {
      void release.current?.();
    },
    [],
  );

  async function send(join: boolean, action = '', move?: Move, target = selected) {
    if (!target || inFlight.current) return;
    const source = table?.id === target ? table : tables.find((t) => t.id === target);
    const payload = join
      ? {
          pricing_version: source?.pricing.version,
          difficulty,
          side,
          ...(source?.bots ? { bot_reward: source.bot_offers[difficulty] } : {}),
        }
      : { action, move, round_id: table?.round?.id, revision: table?.round?.state.revision };
    const signature = JSON.stringify({ target, join, payload });
    const retrying = pending.current?.signature === signature;
    if (pending.current?.signature !== signature)
      pending.current = { signature, payload: { ...payload, request_id: requestId() } };
    inFlight.current = true;
    sequence.current++;
    setBusy(true);
    setError('');
    setConfirm(false);
    try {
      let result = await api<BoardTable>(
        `/casino/tables/${target}/${join ? 'join' : 'actions'}`,
        'POST',
        pending.current.payload,
      );
      // A replay preserves its original response; refresh its position/deadline.
      if (retrying) result = await api<BoardTable>(`/casino/tables/${target}`);
      pending.current = null;
      setSelected(target);
      accept(result);
      casinoSound('click');
      if (result.round?.status !== 'finished') await refresh();
    } catch (e) {
      setError((e as Error).message);
      // Refresh changed terms; the next click explicitly confirms the new offer.
      if (join) {
        const fresh = await api<BoardTable>(`/casino/tables/${target}`).catch(() => null);
        if (fresh) {
          setTables((items) => items.map((t) => (t.id === target ? fresh : t)));
          if (selected === target) accept(fresh);
        }
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const round = table?.round,
    state = round?.state;
  const seated = !!round && round.player !== null && round.status !== 'finished';
  const playing = round?.status === 'playing';
  const ownTurn = playing && state?.turn === round?.player;
  const nardy = game.id.endsWith('backgammon');
  const reward =
    seated || round?.status === 'finished' ? round?.bot_reward : table?.bot_offers[difficulty];
  const botFixed = !!reward;
  const offerText = (t: BoardTable) => {
    const offer = t.bot_offers[difficulty];
    return t.bots && offer
      ? `${levels[difficulty]} · стоимость ${points(offer.price)} · ×${(offer.multiplier_hundredths / 100).toLocaleString('ru-RU')} · выплата ${points(offer.payout)} ◈`
      : `Взнос ${points(t.stake)} · резерв ${points(t.reserve)}`;
  };
  return (
    <section className="board-tables">
      <div className="board-heading">
        <div>
          <span className="eyebrow">ИГРОВОЙ КЛУБ · ДВА УЧАСТНИКА</span>
          <h2>{game.rules.name}</h2>
        </div>
        <span>Доступно {points(available)} ◈</span>
      </div>
      <ErrorBox message={error} />
      {!seated && (
        <div className="board-preferences panel">
          <label>
            Сложность бота
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              {Object.entries(levels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {!nardy && (
            <label>
              Сторона против бота
              <select value={side} onChange={(e) => setSide(e.target.value)}>
                <option value="random">Случайно</option>
                <option value="white">Белые</option>
                <option value="black">Чёрные</option>
              </select>
            </label>
          )}
          {nardy && (
            <p>
              PvP: резерв {game.id === 'short_backgammon' ? '3' : '2'} взноса; остаток возвращается.
              Против бота: один взнос, выплата по сложности без множителя марса/кокса. Первый ход
              определяют кубики.
            </p>
          )}
        </div>
      )}
      {!selected ? (
        <TableLobby
          available={available}
          active={active}
          busy={busy}
          initialCapacity={2}
          stakeLabel="Резерв"
          tables={tables.map((t) => ({
            id: t.id,
            bots: t.bots,
            capacity: 2,
            occupied: t.round?.status === 'finished' ? 0 : t.participants.length,
            entry: t.reserve,
            playing: t.round?.status === 'playing',
            seated: !!t.round && t.round.player !== null && t.round.status !== 'finished',
            joinable: t.enabled && (!t.round || ['waiting', 'finished'].includes(t.round.status)),
            details: offerText(t),
          }))}
          join={(id) => void send(true, '', undefined, id)}
          open={(id) => {
            setSelected(id);
            setTable(tables.find((t) => t.id === id) ?? null);
          }}
        />
      ) : (
        <>
          <div className="board-toolbar">
            <button
              onClick={() => {
                if (seated && playing) setConfirm(true);
                else {
                  setSelected(null);
                  setTable(null);
                }
              }}
            >
              ← Столы
            </button>
            <small>{connected ? '● Подключено' : 'Обновление через сервер'}</small>
            <span>
              Взнос {points(table?.stake ?? 0)} · резерв {points(table?.reserve ?? 0)}
            </span>
          </div>
          {table && (
            <div className="board-room">
              <div className="board-main">
                <div className="board-players">
                  {[0, 1].map((p) => {
                    const person = table.participants.find((x) => x.player === p);
                    return (
                      <div
                        key={p}
                        className={`board-player ${playing && state?.turn === p ? 'active' : ''}`}
                      >
                        <i className={`board-piece checker ${p === 0 ? 'white' : 'black'}`} />
                        <div>
                          <strong>
                            {person
                              ? person.bot
                                ? `Бот · ${levels[round?.difficulty ?? difficulty]}`
                                : person.label
                              : 'Свободное место'}
                          </strong>
                          <small>
                            {p === 0 ? 'Белые' : 'Чёрные'}
                            {round?.player === p ? ' · Вы' : ''}
                          </small>
                        </div>
                        {playing && state?.turn === p && <span>Ход</span>}
                      </div>
                    );
                  })}
                </div>
                {state && (state.board || state.points) ? (
                  <>
                    {nardy ? (
                      <BackgammonBoard
                        key={`${round?.id}:${state.revision}`}
                        state={state}
                        long={game.id === 'long_backgammon'}
                        player={round?.player ?? null}
                        disabled={!ownTurn || busy}
                        move={(m) => void send(false, 'move', m)}
                      />
                    ) : (
                      <SquareBoard
                        key={`${round?.id}:${state.revision}`}
                        state={state}
                        player={round?.player ?? null}
                        disabled={!ownTurn || busy}
                        move={(m) => void send(false, 'move', m)}
                      />
                    )}
                  </>
                ) : (
                  <div className="board-waiting">
                    <span>{game.id === 'chess' ? '♔ ♚' : '● ◯'}</span>
                    <h3>
                      {round?.status === 'waiting'
                        ? 'Ожидаем второго игрока'
                        : 'Доска готова к партии'}
                    </h3>
                    <p>Два места. Один победитель. Общие правила для игроков и ботов.</p>
                  </div>
                )}
              </div>
              <aside className="board-sidebar panel">
                {reward && (
                  <div className="board-reward">
                    <strong>
                      {
                        levels[
                          seated || round?.status === 'finished'
                            ? (round?.difficulty ?? difficulty)
                            : difficulty
                        ]
                      }{' '}
                      · ×{(reward.multiplier_hundredths / 100).toLocaleString('ru-RU')}
                    </strong>
                    <p>
                      Стоимость {points(reward.price)} ◈ · выплата при победе{' '}
                      {points(reward.payout)} ◈
                    </p>
                    <small>
                      Включает взнос. Без дополнительной комиссии. Ничья — возврат взноса.
                    </small>
                  </div>
                )}
                {playing && round?.deadline && (
                  <DecisionTimer
                    key={`${round.id}:${state?.turn}:${round.deadline}`}
                    deadline={round.deadline + (table.clockOffset ?? 0)}
                    duration={round.duration}
                    label={ownTurn ? 'Ваш ход' : 'Ход соперника'}
                    ownTurn={!!ownTurn}
                  />
                )}
                {state?.forced != null && <p>Продолжите взятие той же шашкой.</p>}
                {round?.status === 'finished' && (
                  <div className="board-result" role="status">
                    <h3>
                      {state?.winner == null
                        ? 'Ничья / возврат'
                        : state.winner === round.player
                          ? 'Ваша победа'
                          : round.player === null
                            ? 'Партия завершена'
                            : 'Победа соперника'}
                    </h3>
                    <p>{state?.reason}</p>
                    {nardy && !botFixed && state?.winner != null && (
                      <strong>Результат ×{state.factor ?? 1}</strong>
                    )}
                    <p>
                      Зачислено, включая возврат резерва:{' '}
                      {points(
                        table.participants.find((p) => p.player === round.player)?.payout ?? 0,
                      )}{' '}
                      ◈
                    </p>
                  </div>
                )}
                {!seated &&
                  (!round || round.status === 'finished' || round.status === 'waiting') && (
                    <div>
                      {table.bots && <p>Новая партия: {offerText(table)}</p>}
                      <button
                        className="primary"
                        disabled={busy || active || available < table.reserve || !table.enabled}
                        onClick={() => void send(true)}
                      >
                        Занять место · резерв {points(table.reserve)}
                      </button>
                    </div>
                  )}
                {seated && (
                  <button
                    disabled={busy}
                    onClick={() => (playing ? setConfirm(true) : void send(false, 'leave'))}
                  >
                    {playing ? 'Сдаться' : 'Отменить ожидание'}
                  </button>
                )}
                {ownTurn && state?.can_claim && (
                  <button disabled={busy} onClick={() => void send(false, 'claim_draw')}>
                    Заявить ничью
                  </button>
                )}
                <details>
                  <summary>Правила игры</summary>
                  <p>{game.rules.description}</p>
                  <p>
                    Выберите свою фигуру, затем подсвеченное назначение. Отмена подтверждённого хода
                    недоступна.
                  </p>
                  <p>
                    На ход {round?.duration ?? table.turn_seconds} секунд. Отключение не
                    останавливает таймер; просрочка или выход из партии означают поражение.
                  </p>
                  {botFixed ? (
                    <p>
                      Выплата при победе — стоимость × зафиксированный коэффициент сложности.
                      Округление вниз до 0,01. Поражение — потеря одного взноса; ничья — возврат
                      взноса. Марс и кокс не увеличивают списание или выплату против бота.
                    </p>
                  ) : (
                    <p>
                      Банк: два взноса × результат; комиссия{' '}
                      {((round?.commission_bps ?? table.commission_bps) / 100).toLocaleString(
                        'ru-RU',
                      )}
                      %. Ничья возвращает весь резерв.
                    </p>
                  )}
                  {nardy && !botFixed && (
                    <p>
                      При сдаче или просрочке множитель определяется текущей позицией: снял ли
                      проигравший шашку, остались ли его шашки на баре или в доме победителя.
                    </p>
                  )}
                </details>
                <MoveHistory
                  key={round?.id}
                  entries={state?.move_history ?? []}
                  participants={table.participants}
                />
              </aside>
            </div>
          )}
          {confirm && (
            <div className="board-confirm" role="dialog" aria-label="Подтверждение сдачи">
              <h3>Сдаться и завершить партию?</h3>
              <p>
                Соперник получит победу.{' '}
                {nardy && !botFixed
                  ? 'Разыгрываемая сумма зависит от положения шашек, неиспользованный резерв вернётся.'
                  : 'Взнос будет разыгран.'}
              </p>
              <div className="actions">
                <button onClick={() => setConfirm(false)}>Продолжить игру</button>
                <button disabled={busy} onClick={() => void send(false, 'resign')}>
                  Да, сдаться
                </button>
              </div>
            </div>
          )}
          <CasinoChat key={selected} channel={selected} title="Чат стола" />
        </>
      )}
    </section>
  );
}
