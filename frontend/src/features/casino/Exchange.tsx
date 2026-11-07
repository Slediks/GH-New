import { useState } from 'react';
import { api, points } from '../../shared/api';
import { ErrorBox } from '../../shared/UI';
import type { CasinoWallet, Quote } from './types';
import { CasinoDialog } from './CasinoDialog';

export function Exchange({
  wallet,
  direction,
  close,
  refresh,
  hideBalances = false,
}: {
  wallet: CasinoWallet;
  direction: 'deposit' | 'withdraw';
  close: () => void;
  refresh: () => Promise<void>;
  hideBalances?: boolean;
}) {
  const [amount, setAmount] = useState('10');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  const source = direction === 'deposit' ? 'очков GameHub' : 'шейкелей';
  const target = direction === 'deposit' ? 'шейкелей' : 'очков GameHub';
  const rate = quote?.rate ?? wallet.rates[direction];
  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (!quote) {
        setQuote(await api<Quote>('/casino/exchange/quote', 'POST', { direction, amount }));
      } else {
        await api('/casino/exchange/confirm', 'POST', { quote_id: quote.id });
        setCompleted(true);
        await refresh();
      }
    } catch (error) {
      setError((error as Error).message);
      // A server rejection requires a fresh visible quote; network failures retain the
      // quote ID so the exact same operation can be retried without a second transfer.
      if ('status' in (error as object) && (error as { status: number }).status === 409)
        setQuote(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <CasinoDialog label="Обмен виртуальных валют" close={close} blocked={busy}>
      <section className="panel casino-exchange" aria-label="Обмен виртуальных валют">
        <div className="section-heading">
          <h2>{direction === 'deposit' ? 'Пополнить казино' : 'Вывести в GameHub'}</h2>
          <button onClick={close} disabled={busy}>
            Закрыть
          </button>
        </div>
        <div className="exchange-direction" aria-label="Направление обмена">
          <span>
            {direction === 'deposit' ? 'Очки GameHub' : 'Шейкели'}
            <strong>{points(direction === 'deposit' ? wallet.gamehub : wallet.available)}</strong>
          </span>
          <b aria-hidden="true">→</b>
          <span>
            {direction === 'deposit' ? 'Шейкели' : 'Очки GameHub'}
            <strong>{points(direction === 'deposit' ? wallet.available : wallet.gamehub)}</strong>
          </span>
        </div>
        <p className="exchange-rate">
          {rate.denominator} {source} → {rate.numerator} {target}.
        </p>
        <p className="exchange-rate-note">
          Курсы пополнения и вывода разные. Обратный обмен вернёт меньше очков.
        </p>
        {completed ? (
          <p className="success" role="status">
            Обмен выполнен.
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label>
              Сумма, {source}
              <input
                inputMode="decimal"
                value={amount}
                disabled={busy || !!quote}
                onChange={(event) => setAmount(event.target.value)}
                required
                pattern="[0-9]+([.,][0-9]{1,2})?"
              />
            </label>
            {quote && (
              <div className="casino-quote" aria-live="polite">
                <p>
                  Списать:{' '}
                  <strong>
                    {points(quote.debit)} {source}
                  </strong>
                </p>
                <p>
                  Зачислить:{' '}
                  <strong>
                    {points(quote.credit)} {target}
                  </strong>
                </p>
                <p>
                  Шаг обмена: {points(quote.step)} {source}. Версия курса: {quote.rate_version}.
                </p>
                {quote.remainder > 0 && (
                  <p>
                    Из введённой суммы {points(quote.remainder)} {source} останется на исходном
                    балансе.
                  </p>
                )}
                <p hidden={hideBalances}>
                  После обмена: {points(quote.after.gamehub)} очков GameHub и{' '}
                  {points(quote.after.available)} доступных шейкелей.
                </p>
                <p className="muted" hidden={hideBalances}>
                  Зарезервировано: {points(quote.after.reserved)} · За столом:{' '}
                  {points(quote.after.at_table)} шейкелей.
                </p>
                <button type="button" disabled={busy} onClick={() => setQuote(null)}>
                  Изменить сумму
                </button>
              </div>
            )}
            <ErrorBox message={error} />
            <button className="primary" disabled={busy}>
              {busy ? 'Обработка…' : quote ? 'Подтвердить обмен' : 'Рассчитать обмен'}
            </button>
          </form>
        )}
      </section>
    </CasinoDialog>
  );
}
