import { useCallback, useEffect, useRef, useState } from 'react';
import { api, points } from '../../../shared/api';
import { ErrorBox } from '../../../shared/UI';
import { Rules } from '../Rules';
import { requestId, type CasinoGame, type CasinoRound } from '../types';
import { FortuneWheel } from './FortuneWheel';
import type { SECTORS } from './model';

const multiplier = (value: number) =>
  `×${(value / 10000).toLocaleString('ru-RU', { maximumFractionDigits: 4 })}`;
function Result({ round }: { round: CasinoRound }) {
  const state = round.state;
  return (
    <>
      <span>
        Участие: <b>{points(Number(state.stake))} ш.</b>
      </span>
      <span>
        Выпало: <b>{multiplier(Number(state.multiplier_bps))}</b>
      </span>
      <span>
        Получено: <b>{points(state.payout ?? 0)} ш.</b>
      </span>
      <span>
        Результат:{' '}
        <b>
          {Number(state.net) > 0 ? '+' : ''}
          {points(Number(state.net))} ш.
        </b>
      </span>
    </>
  );
}
export function PersonalWheel({
  game,
  initial,
  available,
  refresh,
  holdBalance,
}: {
  game: CasinoGame;
  initial: CasinoRound | null;
  available: number;
  refresh: () => Promise<void>;
  holdBalance: () => () => Promise<void>;
}) {
  const [round, setRound] = useState(initial?.game === game.id ? initial : null);
  const [amount, setAmount] = useState('10');
  const [busy, setBusy] = useState(false),
    [revealed, setRevealed] = useState(true);
  const [error, setError] = useState(''),
    [history, setHistory] = useState<CasinoRound[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const historyRequest = useRef(0);
  const release = useRef<(() => Promise<void>) | null>(null);
  const mounted = useRef(true),
    pending = useRef(false),
    finishing = useRef(false);
  const retry = useRef<{ amount: string; request_id: string } | null>(null);
  const loadHistory = useCallback(async (page = 1) => {
    const revision = ++historyRequest.current;
    const response = await api<{ items: CasinoRound[] }>(
      `/casino/rounds?game=personal_wheel&page=${page}`,
    );
    if (mounted.current && revision === historyRequest.current) {
      setHistory(response.items);
      setHistoryPage(page);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void loadHistory().catch((e: Error) => setError(e.message));
    return () => {
      mounted.current = false;
      void release.current?.();
    };
  }, [loadHistory]);
  const finish = useCallback(() => {
    if (!release.current || finishing.current) return;
    finishing.current = true;
    void Promise.all([release.current(), loadHistory()])
      .catch((e: Error) => {
        if (mounted.current) setError(e.message);
      })
      .finally(() => {
        release.current = null;
        finishing.current = false;
        if (mounted.current) setRevealed(true);
      });
  }, [loadHistory]);
  const cents = /^\d{1,10}([.,]\d{1,2})?$/.test(amount)
    ? Number(
        BigInt(amount.replace(',', '.').split('.')[0]) * 100n +
          BigInt((amount.replace(',', '.').split('.')[1] ?? '').padEnd(2, '0')),
      )
    : null;
  const valid =
    cents !== null &&
    cents >= game.limits.minimum &&
    cents <= game.limits.maximum &&
    cents <= available;
  async function start() {
    if (pending.current || !revealed || !valid) return;
    pending.current = true;
    setBusy(true);
    setError('');
    release.current = holdBalance();
    if (retry.current?.amount !== amount) retry.current = { amount, request_id: requestId() };
    try {
      const result = await api<CasinoRound>('/casino/rounds', 'POST', {
        game: game.id,
        ...retry.current,
        options: {},
      });
      retry.current = null;
      if (mounted.current) {
        setRound(result);
        setRevealed(false);
      }
      await refresh();
    } catch (e) {
      await release.current?.();
      release.current = null;
      if (mounted.current) setError((e as Error).message);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const rules = round?.rules ?? game.rules;
  const bps = rules.sectors_bps as number[];
  const sectors = bps.map(String);
  const payouts: Record<string, [number, number]> = {};
  const appearance: typeof SECTORS = {};
  bps.forEach((value) => {
    payouts[String(value)] = [value, 10000];
    appearance[String(value)] = {
      name: multiplier(value),
      symbol: value === 0 ? '−' : value >= 20000 ? '✦' : '◆',
      color:
        value === 0
          ? '#91394c'
          : value < 10000
            ? '#315783'
            : value === 10000
              ? '#536678'
              : value < 20000
                ? '#236b58'
                : '#80551b',
    };
  });
  return (
    <>
      <h2>Личное колесо</h2>
      <div className="casino-game-layout casino-fortune-layout personal-wheel-layout">
        <section className="casino-felt common-scene game-wheel risk-medium">
          <FortuneWheel
            key={round?.id ?? 'idle'}
            id={round?.id ?? 'idle'}
            phase={round ? 'result' : 'betting'}
            result={round ? Number(round.state.index) : undefined}
            sectors={sectors}
            payouts={payouts}
            appearance={appearance}
            personal
            risk="medium"
            animateResult={!revealed}
            onSettling={() => {}}
            onLanded={finish}
          />
          <div className="personal-wheel-result" role="status">
            {round && revealed ? (
              <Result round={round} />
            ) : (
              <span>{round ? 'Результат после остановки колеса' : 'Выберите сумму участия'}</span>
            )}
          </div>
        </section>
        <aside className="panel casino-controls">
          <p>20 равных секторов. Вы выбираете только сумму участия.</p>
          <label>
            Сумма участия, шейкели
            <input
              value={amount}
              inputMode="decimal"
              disabled={busy || !revealed}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <small>
            {points(game.limits.minimum)}–{points(game.limits.maximum)} ш.
          </small>
          <button
            className="primary"
            disabled={busy || !revealed || !valid || !game.limits.enabled}
            onClick={() => void start()}
          >
            {busy ? 'Запуск…' : !revealed ? 'Вращение…' : 'Вращать колесо'}
          </button>
          <p>
            Выплата включает сумму участия. Коэффициент ниже ×1 означает частичную или полную
            потерю.
          </p>
          <ErrorBox message={error} />
        </aside>
      </div>
      <section className="panel personal-wheel-history">
        <h3>Ваши последние вращения</h3>
        {history
          .filter((item) => revealed || item.id !== round?.id)
          .map((item) => (
            <div key={item.id}>
              <Result round={item} />
            </div>
          ))}
        {!history.length && <p>Вращений пока нет</p>}
        <div className="actions">
          <button
            disabled={historyPage === 1 || !revealed || busy}
            onClick={() =>
              void loadHistory(historyPage - 1).catch((e: Error) => setError(e.message))
            }
          >
            Новее
          </button>
          <button
            disabled={history.length < 24 || !revealed || busy}
            onClick={() =>
              void loadHistory(historyPage + 1).catch((e: Error) => setError(e.message))
            }
          >
            Ранее
          </button>
        </div>
      </section>
      <Rules game={{ ...game, rules, limits: round?.limits ?? game.limits }} />
    </>
  );
}
