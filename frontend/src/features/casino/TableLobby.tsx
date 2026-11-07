import { pricingLabel, type TablePricing } from './tablePricing';
import { useState } from 'react';
import { Users, Bot, Coins, Zap } from 'lucide-react';
import { points } from '../../shared/api';
import './tableLobby.css';

export interface LobbyTable {
  pricing?: TablePricing;
  id: string;
  bots: boolean;
  capacity: number;
  occupied: number;
  entry: number;
  playing: boolean;
  seated: boolean;
  joinable: boolean;
  details?: string;
}
export function recommendedTables(tables: LobbyTable[]) {
  return [...tables].sort((a, b) => {
    const priority = (t: LobbyTable) => (t.seated ? -1 : !t.joinable ? 2 : t.occupied > 0 ? 0 : 1);
    return priority(a) - priority(b) || a.entry - b.entry || a.id.localeCompare(b.id);
  });
}
export function TableLobby({
  tables,
  available,
  active,
  busy,
  join,
  open,
  initialCapacity,
  stakeLabel = 'Ставка',
}: {
  tables: LobbyTable[];
  available: number;
  active: boolean;
  busy: boolean;
  join: (id: string) => void;
  open: (id: string) => void;
  initialCapacity?: number;
  stakeLabel?: string;
}) {
  const [opponents, setOpponents] = useState('all'),
    [capacity, setCapacity] = useState(initialCapacity ?? 0),
    [stake, setStake] = useState(0),
    [freeOnly, setFreeOnly] = useState(false),
    [sort, setSort] = useState('recommended');
  const capacities = [...new Set(tables.map((t) => t.capacity))].sort((a, b) => a - b);
  const stakes = [...new Set(tables.map((t) => t.entry))].sort((a, b) => a - b);
  const filtered = tables.filter(
    (t) =>
      (opponents === 'all' || t.bots === (opponents === 'bots')) &&
      (!capacity || t.capacity === capacity) &&
      (!stake || t.entry === stake) &&
      (!freeOnly || t.joinable || (t.seated && !t.playing && t.occupied < t.capacity)),
  );
  const shown = recommendedTables(filtered);
  if (sort === 'asc') shown.sort((a, b) => a.entry - b.entry);
  if (sort === 'desc') shown.sort((a, b) => b.entry - a.entry);
  if (sort === 'free') shown.sort((a, b) => b.capacity - b.occupied - (a.capacity - a.occupied));
  const quick = recommendedTables(filtered).find(
    (t) => t.joinable && !t.seated && t.entry <= available,
  );
  const blocked = active
    ? 'Сначала завершите активную игру'
    : !quick
      ? 'Нет подходящего доступного стола'
      : '';
  const reset = () => {
    setOpponents('all');
    setCapacity(initialCapacity ?? 0);
    setStake(0);
    setFreeOnly(false);
    setSort('recommended');
  };
  return (
    <section className="table-lobby" aria-label="Выбор стола">
      <div className="lobby-balance">
        <Coins size={18} />
        <span>Доступно</span>
        <strong>{points(available)}</strong>
        <small>шейкелей</small>
      </div>
      <section className="lobby-quick">
        <Zap size={28} />
        <div>
          <h3>Быстрая игра</h3>
          <p>
            {quick && !active
              ? `${quick.bots ? 'С ботами' : 'Только люди'} · до ${quick.capacity} игроков · вход ${points(quick.entry)} шейкелей`
              : blocked}
          </p>
          <small>Учитываем выбранные фильтры. Вход спишется при посадке за стол.</small>
        </div>
        <button disabled={busy || !!blocked} onClick={() => quick && join(quick.id)}>
          {busy ? 'Подождите…' : 'Найти стол и играть'}
        </button>
      </section>
      <div className="lobby-filters">
        <fieldset>
          <legend>Соперники</legend>
          <div className="lobby-segments">
            {[
              ['all', 'Все'],
              ['humans', 'Люди'],
              ['bots', 'Боты'],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={opponents === value}
                onClick={() => setOpponents(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        {capacities.length > 1 && (
          <fieldset>
            <legend>Игроков</legend>
            <div className="lobby-segments">
              {[0, ...capacities].map((n) => (
                <button key={n} aria-pressed={capacity === n} onClick={() => setCapacity(n)}>
                  {n || 'Все'}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset>
          <legend>{stakeLabel}</legend>
          <div className="lobby-segments">
            {[0, ...stakes].map((n) => (
              <button key={n} aria-pressed={stake === n} onClick={() => setStake(n)}>
                {n ? points(n) : 'Все'}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="lobby-free">
          <input
            type="checkbox"
            checked={freeOnly}
            onChange={(e) => setFreeOnly(e.target.checked)}
          />
          Только столы со свободными местами
        </label>
      </div>
      <div className="lobby-list-heading">
        <h3>
          Выбрать стол вручную <small>· {shown.length}</small>
        </h3>
        {tables.length > 6 && (
          <label>
            Сортировка
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recommended">Рекомендуемые</option>
              <option value="asc">Ставка ↑</option>
              <option value="desc">Ставка ↓</option>
              <option value="free">Свободные места</option>
            </select>
          </label>
        )}
      </div>
      {!shown.length && (
        <div className="panel lobby-empty">
          <p>По этим условиям столов нет.</p>
          <button onClick={reset}>Сбросить фильтры</button>
        </div>
      )}
      <div className="lobby-tables">
        {shown.map((t) => {
          const free = Math.max(0, t.capacity - t.occupied),
            poor = t.entry > available;
          const disabled = busy || !t.joinable || active || poor;
          const label = t.seated
            ? 'Вернуться к игре'
            : t.playing
              ? 'Смотреть'
              : !free
                ? 'Заполнен'
                : active
                  ? 'Есть активная игра'
                  : poor
                    ? 'Недостаточно средств'
                    : 'Играть';
          return (
            <article
              className={`lobby-table ${t.seated ? 'seated' : ''}`}
              key={t.id}
              data-table-id={t.id}
            >
              <header>
                <span>
                  {t.bots ? <Bot size={18} /> : <Users size={18} />}{' '}
                  {t.bots ? 'С ботами' : 'Только люди'}
                </span>
                <strong>
                  {t.occupied} / {t.capacity}
                </strong>
              </header>
              <div className="lobby-entry">
                <strong>
                  {points(t.entry)} <Coins size={21} />
                </strong>
                <small>
                  {t.pricing ? `${pricingLabel(t.pricing)} шейкелей` : 'Вход · шейкели'}
                </small>
              </div>
              {t.details && <small className="lobby-details">{t.details}</small>}
              <p className={`lobby-availability ${t.joinable ? 'free' : ''}`}>
                {t.playing
                  ? 'Игра идёт'
                  : !free
                    ? 'Стол заполнен'
                    : t.joinable
                      ? `${free} ${free === 1 ? 'место свободно' : free < 5 ? 'места свободно' : 'мест свободно'}`
                      : 'Вход временно недоступен'}
              </p>
              <button
                disabled={busy || (!t.seated && !t.playing && disabled)}
                onClick={() => (t.seated || t.playing ? open(t.id) : join(t.id))}
              >
                {label}
              </button>
              {!t.seated && !t.playing && (
                <button className="lobby-watch" disabled={busy} onClick={() => open(t.id)}>
                  Смотреть
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
