import { DecisionTimer, DECISION_WINDOWS } from './DecisionTimer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, points } from '../../shared/api';
import { ErrorBox } from '../../shared/UI';
import { CardGames } from './CardGames';
import { InstantGames } from './InstantGames';
import { PlinkoScene } from './plinko/PlinkoScene';
import { VideoPokerCombinations } from './videoPoker/Combinations';
import { launchCost } from './plinko/model';
import { Rules } from './Rules';
import { SlotGame } from './SlotGame';
import { FeatureSlot } from './slots/FeatureSlot';
import { LockSlot } from './slots/LockSlot';
import { StepGames } from './StepGames';
import { GameArtwork } from './ArcadeScenes';
import { casinoSound } from './sound';
import { requestId, type CasinoGame, type CasinoRound } from './types';

export function GameRoom({
  game,
  initial,
  refresh,
  holdBalance,
}: {
  game: CasinoGame;
  initial: CasinoRound | null;
  refresh: () => Promise<void>;
  holdBalance: () => () => Promise<void>;
}) {
  const [round, setRound] = useState<CasinoRound | null>(
    initial?.game === game.id ? initial : null,
  );
  const [amount, setAmount] = useState('10');
  const [risk, setRisk] = useState(
    game.id === 'plinko' ? String(initial?.state.risk ?? 'low') : 'low',
  );
  const ballLimits = (game.rules.ball_count as
    | { minimum: number; maximum: number }
    | undefined) ?? { minimum: 1, maximum: 1 };
  const [balls, setBalls] = useState(ballLimits.minimum);
  const [animatedPlinko, setAnimatedPlinko] = useState<string | null>(null);
  const totalPlinkoCost = launchCost(amount, balls);
  const [mines, setMines] = useState(3);
  const [low, setLow] = useState(0),
    [high, setHigh] = useState(4999);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [fast, setFast] = useState(false),
    [visualDone, setVisualDone] = useState(true);
  const [autoCount, setAutoCount] = useState(10),
    [remaining, setRemaining] = useState(0);
  const [lossLimit, setLossLimit] = useState('100'),
    [winLimit, setWinLimit] = useState('100');
  const [seriesNet, setSeriesNet] = useState(0);
  const alive = useRef(true),
    actionRevision = useRef(0),
    inFlight = useRef(false),
    lastCounted = useRef('');
  const auto = useRef({ left: 0, net: 0, stake: 0, loss: 0, win: 0 });
  const retry = useRef<{
    path: string;
    payload: Record<string, unknown>;
    signature: string;
  } | null>(null);
  const isSlot = game.id.startsWith('slots_');
  const featureSlot = ['slots_lock', 'slots_streak', 'slots_wheel'].includes(game.id);
  const FeatureScene = game.id === 'slots_lock' ? LockSlot : FeatureSlot;
  const releaseBalance = useRef<(() => Promise<void>) | null>(null);
  const revealing = useRef(false);
  const active = !!round && !round.state.done;
  useEffect(() => {
    alive.current = true;
    const stop = () => {
      auto.current.left = 0;
      setRemaining(0);
    };
    window.addEventListener('offline', stop);
    const visibility = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      auto.current.left = 0;
      void releaseBalance.current?.();
      window.removeEventListener('offline', stop);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  const finished = useCallback(() => {
    if (revealing.current) return;
    const release = releaseBalance.current;
    if (!release) {
      setVisualDone(true);
      return;
    }
    revealing.current = true;
    void release().finally(() => {
      releaseBalance.current = null;
      revealing.current = false;
      if (alive.current) setVisualDone(true);
    });
  }, []);
  useEffect(() => {
    if (!round || round.state.done) return;
    const timer = window.setInterval(() => {
      const revision = actionRevision.current;
      void api<CasinoRound>(`/casino/rounds/${round.id}`)
        .then((value) => {
          if (!alive.current || inFlight.current || revision !== actionRevision.current) return;
          setRound(value);
          if (value.state.done) void refresh();
        })
        .catch((error: Error) => {
          if (alive.current) setError(error.message);
        });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [round?.id, round?.state.done, refresh]);

  async function send(path: string, payload: Record<string, unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    actionRevision.current++;
    setBusy(true);
    setError('');
    if (isSlot) releaseBalance.current = holdBalance();
    casinoSound('click');
    const signature = JSON.stringify({ path, payload });
    if (retry.current?.signature !== signature)
      retry.current = { path, signature, payload: { ...payload, request_id: requestId() } };
    try {
      const result = await api<CasinoRound>(path, 'POST', retry.current.payload);
      retry.current = null;
      if (!alive.current) {
        await refresh();
        return;
      }
      setRound(result);
      setVisualDone(payload.action === 'collect' || (!isSlot && game.id !== 'plinko'));
      if (game.id === 'plinko') setAnimatedPlinko(result.id);
      if (result.state.done) casinoSound('result');
      if (auto.current.left && result.state.done && lastCounted.current !== result.id) {
        lastCounted.current = result.id;
        auto.current.net += (result.state.payout ?? 0) - auto.current.stake;
        auto.current.left--;
        if (auto.current.net <= -auto.current.loss || auto.current.net >= auto.current.win)
          auto.current.left = 0;
        setRemaining(auto.current.left);
        setSeriesNet(auto.current.net);
      }
      await refresh();
    } catch (error) {
      await releaseBalance.current?.();
      releaseBalance.current = null;
      auto.current.left = 0;
      if (alive.current) {
        setRemaining(0);
        setError((error as Error).message);
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function start(buy = false) {
    return send('/casino/rounds', {
      game: game.id,
      amount,
      options: {
        risk,
        mines,
        low,
        high,
        buy_bonus: buy,
        ...(game.id === 'plinko' ? { balls } : {}),
      },
    });
  }
  useEffect(() => {
    if (!remaining || busy || !visualDone || !round?.state.done) return;
    const timer = window.setTimeout(
      () => {
        if (alive.current && auto.current.left && !document.hidden) void start();
      },
      fast ? 150 : 700,
    );
    return () => window.clearTimeout(timer);
  }, [remaining, busy, visualDone, round?.id, fast]);
  const move = (action: string, options: Record<string, unknown> = {}) => {
    if (round)
      void send(`/casino/rounds/${round.id}/actions`, {
        action,
        options: featureSlot ? { ...options, expected_revision: round.state.revision } : options,
      });
  };
  function startAuto() {
    const toMinor = (value: string) => {
      if (!/^\d+([.,]\d{1,2})?$/.test(value)) return 0;
      const [whole, fraction = ''] = value.replace(',', '.').split('.');
      return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
    };
    const loss = toMinor(lossLimit),
      win = toMinor(winLimit),
      stake = toMinor(amount);
    if (!loss || !win || !stake) {
      setError('Укажите положительные ставку и пределы серии.');
      return;
    }
    auto.current = { left: autoCount, net: 0, stake, loss, win };
    setRemaining(autoCount);
    setSeriesNet(0);
    void start();
  }
  const disabled = busy || active || !visualDone || remaining > 0;
  return (
    <>
      <div className={`casino-game-layout ${isSlot ? 'casino-slot-layout' : ''}`}>
        <section className={`casino-felt casino-scene game-${game.id}`}>
          <h2>{game.rules.name}</h2>
          {!round && !isSlot && game.id !== 'plinko' && (
            <div className="casino-idle">
              <GameArtwork game={game.id} />
              <p>Выберите ставку и начните раунд</p>
            </div>
          )}
          {isSlot && !featureSlot && (
            <SlotGame
              key={round?.id ?? 'idle'}
              round={round}
              game={game}
              fast={fast}
              animate={!visualDone}
              onFinished={finished}
            />
          )}
          {featureSlot && (
            <FeatureScene
              key={`${round?.id ?? 'idle'}:${round?.state.revision ?? 0}`}
              round={round}
              game={game}
              fast={fast}
              animate={!visualDone}
              onFinished={finished}
              move={move}
              busy={busy}
            />
          )}
          {game.id === 'plinko' && !round?.state.cancel_reason && (
            <PlinkoScene
              key={round?.state.risk === risk ? round.id : 'preview'}
              round={round?.state.risk === risk ? round : null}
              game={game}
              risk={risk}
              animate={animatedPlinko === round?.id && !visualDone}
              onFinished={finished}
            />
          )}
          {!!round?.state.cancel_reason && (
            <p className="casino-result">
              {String(round.state.cancel_reason)} · Возврат {points(round.state.payout ?? 0)} ш.
            </p>
          )}
          {round && !round.state.cancel_reason && (
            <>
              {['blackjack', 'video_poker', 'higher_lower'].includes(game.id) && (
                <CardGames key={round.id} round={round} move={move} busy={busy} />
              )}
              {['mines', 'ladder', 'penalty'].includes(game.id) && (
                <StepGames round={round} move={move} busy={busy} />
              )}
              {game.id === 'target' && <InstantGames key={round.id} round={round} />}
              {!!round.state.cashout && !round.state.done && (
                <button disabled={busy} onClick={() => move('cashout')}>
                  Забрать {points(Number(round.state.cashout))} ш.
                </button>
              )}
              {round.state.done &&
                visualDone &&
                !isSlot &&
                !['plinko', 'video_poker'].includes(game.id) && (
                  <p className="casino-result" role="status">
                    Раунд завершён · Выплата {points(round.state.payout ?? 0)} шейкелей
                  </p>
                )}
            </>
          )}
          {game.id === 'video_poker' && (
            <VideoPokerCombinations rules={round?.rules ?? game.rules} round={round} />
          )}
        </section>
        <aside className="panel casino-controls">
          {active && round?.deadline && DECISION_WINDOWS[game.id] && (
            <DecisionTimer
              key={`${round.id}:${round.deadline}`}
              deadline={round.deadline}
              duration={DECISION_WINDOWS[game.id]}
              label="Ваше решение"
            />
          )}
          <label>
            {game.id === 'plinko' ? 'Ставка на один шарик, шейкели' : 'Ставка, шейкели'}
            <input
              inputMode="decimal"
              value={amount}
              disabled={disabled}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <p className="muted">
            {points(game.limits.minimum)}–{points(game.limits.maximum)} ш.
          </p>
          {game.id === 'plinko' && (
            <>
              <label>
                Количество шариков
                <input
                  type="number"
                  min={ballLimits.minimum}
                  max={ballLimits.maximum}
                  step="1"
                  value={balls}
                  disabled={disabled}
                  onChange={(event) => setBalls(Number(event.target.value))}
                />
              </label>
              <small>
                От {ballLimits.minimum} до {ballLimits.maximum} шариков одновременно
              </small>
              <div className="plinko-launch-preview">
                <span>
                  {balls} шариков × {amount} ш.
                </span>
                <strong>
                  К списанию: {totalPlinkoCost == null ? '—' : points(totalPlinkoCost)} ш.
                </strong>
                <small>Лимит всей группы: {points(game.limits.maximum)} ш.</small>
              </div>
            </>
          )}
          {['plinko', 'ladder', 'penalty'].includes(game.id) && (
            <label>
              Риск
              <select
                disabled={disabled}
                value={risk}
                onChange={(event) => setRisk(event.target.value)}
              >
                <option value="low">Низкий</option>
                {game.id === 'plinko' && <option value="medium">Средний</option>}
                <option value="high">Высокий</option>
              </select>
            </label>
          )}
          {game.id === 'mines' && (
            <label>
              Число мин
              <input
                type="number"
                min={1}
                max={24}
                value={mines}
                disabled={disabled}
                onChange={(event) => setMines(Number(event.target.value))}
              />
            </label>
          )}
          {game.id === 'target' && (
            <>
              <label>
                От (включительно)
                <input
                  type="number"
                  min={0}
                  max={9999}
                  value={low}
                  disabled={disabled}
                  onChange={(event) => setLow(Number(event.target.value))}
                />
              </label>
              <label>
                До (включительно)
                <input
                  type="number"
                  min={0}
                  max={9999}
                  value={high}
                  disabled={disabled}
                  onChange={(event) => setHigh(Number(event.target.value))}
                />
              </label>
              <p>
                Вероятность: {(high - low + 1) / 100}% · Выплата ×
                {(Number(game.rules.return_bps ?? 9600) / (high - low + 1)).toFixed(4)}
              </p>
            </>
          )}
          <button
            className="primary"
            disabled={disabled || !game.limits.enabled}
            onClick={() => void start()}
          >
            {busy ? 'Сохранение…' : isSlot && !visualDone ? 'Вращение…' : 'Играть'}
          </button>
          {isSlot && (
            <>
              <button disabled={disabled || !game.limits.enabled} onClick={() => void start(true)}>
                Купить бонус ·{' '}
                {/^[0-9]{1,10}([.,][0-9]{1,2})?$/.test(amount)
                  ? points(
                      Number(
                        BigInt(amount.replace(',', '.').split('.')[0]) * 100n +
                          BigInt((amount.replace(',', '.').split('.')[1] ?? '').padEnd(2, '0')),
                      ) * Number(game.rules.buy_cost ?? 100),
                    ) + ' ш.'
                  : `${game.rules.buy_cost ?? 100} ставок`}
              </button>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={fast}
                  onChange={(event) => setFast(event.target.checked)}
                />
                Быстрые анимации
              </label>
              {game.rules.decision ? (
                <p>
                  Этот режим требует ваших решений. Автоспины отключены; после 120 секунд ожидания
                  сервер заберёт доступную выплату.
                </p>
              ) : (
                <details className="casino-autospin-settings">
                  <summary>Автоспины и пределы серии</summary>
                  <label>
                    Вращений в серии
                    <select
                      value={autoCount}
                      disabled={disabled}
                      onChange={(event) => setAutoCount(Number(event.target.value))}
                    >
                      {[10, 25, 50].map((count) => (
                        <option key={count}>{count}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Предел убытка, ш.
                    <input
                      inputMode="decimal"
                      value={lossLimit}
                      disabled={disabled}
                      onChange={(event) => setLossLimit(event.target.value)}
                    />
                  </label>
                  <label>
                    Предел выигрыша, ш.
                    <input
                      inputMode="decimal"
                      value={winLimit}
                      disabled={disabled}
                      onChange={(event) => setWinLimit(event.target.value)}
                    />
                  </label>
                  <button
                    disabled={remaining > 0 ? false : disabled}
                    title={remaining > 0 ? 'Остановка после текущего раунда' : undefined}
                    onClick={() => {
                      if (remaining > 0) {
                        auto.current.left = 0;
                        setRemaining(0);
                      } else startAuto();
                    }}
                  >
                    {remaining > 0 ? 'Остановить серию' : 'Начать серию'}
                  </button>
                </details>
              )}
              {!game.rules.decision && (
                <p className="slot-series-summary">
                  Результат серии: {visualDone ? `${points(seriesNet)} ш.` : 'после остановки'}
                </p>
              )}
            </>
          )}
          <ErrorBox message={error} />
        </aside>
      </div>
      <Rules
        game={{ ...game, rules: round?.rules ?? game.rules, limits: round?.limits ?? game.limits }}
        omitPayout={game.id === 'video_poker'}
      />
    </>
  );
}
