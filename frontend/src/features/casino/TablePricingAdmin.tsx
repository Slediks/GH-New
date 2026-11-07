import { useRef, useState } from 'react';
import { api, points } from '../../shared/api';
import { ErrorBox } from '../../shared/UI';
import { casinoNames } from './SettingsWorkspace';
import { amountText, parseAmount } from './poker/presentation';
import { pricingLabel, type PricedTable } from './tablePricing';

export function TablePricingAdmin({
  tables,
  reload,
}: {
  tables: PricedTable[];
  reload: () => Promise<void>;
}) {
  const [mode, setMode] = useState('fixed'),
    [query, setQuery] = useState(''),
    [selected, setSelected] = useState('');
  const matching = tables.filter(
    (t) =>
      t.configured_pricing?.mode === mode &&
      `${t.id} ${casinoNames[t.game]}`.toLowerCase().includes(query.toLowerCase()),
  );
  const chosen = matching.find((t) => t.id === selected) ?? matching[0];
  return (
    <section className="panel">
      <h3>Стоимость и доступность столов</h3>
      <p>
        Фиксированная цена сохраняется для всей текущей партии, включая ожидающих участников. Новая
        цена — со следующей партии. Диапазон входного стека действует для новых посадок.
      </p>
      <div className="tabs">
        <button onClick={() => setMode('fixed')} aria-pressed={mode === 'fixed'}>
          Фиксированная цена
        </button>
        <button onClick={() => setMode('variable')} aria-pressed={mode === 'variable'}>
          Диапазон входа
        </button>
      </div>
      <label>
        Поиск стола
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Игра или идентификатор"
        />
      </label>
      <label>
        Стол
        <select value={chosen?.id ?? ''} onChange={(e) => setSelected(e.target.value)}>
          {matching.map((t) => (
            <option key={t.id} value={t.id}>
              {casinoNames[t.game]} · {t.id} · {t.bots ? 'Боты' : 'Люди'}
            </option>
          ))}
        </select>
      </label>
      {chosen ? (
        <PriceEditor
          key={`${chosen.id}:${chosen.configured_pricing.version}`}
          table={chosen}
          reload={reload}
        />
      ) : (
        <p>Подходящих столов нет.</p>
      )}
    </section>
  );
}
function PriceEditor({ table, reload }: { table: PricedTable; reload: () => Promise<void> }) {
  const price = table.configured_pricing;
  const [first, setFirst] = useState(
      amountText(price.mode === 'fixed' ? price.fixed_price : price.min_bet),
    ),
    [last, setLast] = useState(amountText(price.mode === 'variable' ? price.max_bet : 0));
  const [enabled, setEnabled] = useState(table.enabled),
    [reason, setReason] = useState(''),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const inFlight = useRef(false);
  const low = parseAmount(first),
    high = parseAmount(last);
  const valid =
    low !== null &&
    low > 0 &&
    low <= 100000000 &&
    (price.mode === 'fixed' ||
      (high !== null &&
        high >= low &&
        high <= 100000000 &&
        low >= (table.big_blind ?? 0) * 40 &&
        high <= (table.big_blind ?? 1000000) * 100));
  async function save() {
    if (!valid || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await api('/casino/admin/table', 'POST', {
        table_id: table.id,
        version: price.version,
        enabled,
        reason,
        pricing:
          price.mode === 'fixed'
            ? { mode: 'fixed', fixed_price: amountText(low!) }
            : { mode: 'variable', min_bet: amountText(low!), max_bet: amountText(high!) },
      });
      await reload();
    } catch (e) {
      setError((e as Error).message);
      setPreview(false);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="panel table-price-editor"
      aria-label={table.id}
      onSubmit={(e) => {
        e.preventDefault();
        setPreview(true);
      }}
    >
      <h4>
        {casinoNames[table.game]} · {table.bots ? 'С ботами' : 'Только люди'}
      </h4>
      <code>{table.id}</code>
      <p>
        {pricingLabel(price)} · версия {price.version}
      </p>
      {table.pricing.version !== price.version && (
        <p>Текущая партия: {pricingLabel(table.pricing)}. Новые настройки ожидают её завершения.</p>
      )}
      <ErrorBox message={error} />
      {error && (
        <button type="button" onClick={() => void reload()}>
          Обновить настройки стола
        </button>
      )}
      <div className="form-grid">
        <label>
          {price.mode === 'fixed' ? 'Цена участия, шейкели' : 'Минимум входа, шейкели'}
          <input
            value={first}
            onChange={(e) => {
              setFirst(e.target.value);
              setPreview(false);
            }}
            inputMode="decimal"
            disabled={busy}
          />
        </label>
        {price.mode === 'variable' && (
          <label>
            Максимум входа, шейкели
            <input
              value={last}
              onChange={(e) => {
                setLast(e.target.value);
                setPreview(false);
              }}
              inputMode="decimal"
              disabled={busy}
            />
          </label>
        )}
        <label>
          Причина изменения
          <input
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setPreview(false);
            }}
            required
            maxLength={1000}
            disabled={busy}
          />
        </label>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setPreview(false);
          }}
          disabled={busy}
        />
        Новые входы разрешены
      </label>
      <small>
        {price.mode === 'fixed'
          ? 'От 0,01 до 1 000 000 шейкелей. Общие min/max игры не применяются.'
          : `Диапазон в пределах 40–100 BB: ${points((table.big_blind ?? 0) * 40)}–${points((table.big_blind ?? 0) * 100)}. Блайнды не меняются.`}
      </small>
      {!valid && (
        <p className="error">
          Введите положительные суммы с точностью до сотых в допустимом диапазоне.
        </p>
      )}
      {!preview ? (
        <button disabled={busy || !valid || !reason.trim()}>Проверить изменения</button>
      ) : (
        <div role="status">
          <p>
            Новая версия: {first}
            {price.mode === 'variable' ? `–${last}` : ''} шейкелей ·{' '}
            {enabled ? 'вход разрешён' : 'новые входы отключены'}
          </p>
          <button type="button" disabled={busy} onClick={() => void save()}>
            Сохранить настройки стола
          </button>
          <button type="button" onClick={() => setPreview(false)}>
            Назад
          </button>
        </div>
      )}
    </form>
  );
}
