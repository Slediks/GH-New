import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { io } from 'socket.io-client';
import { api, points } from '../../shared/api';
import { ErrorBox, Loading } from '../../shared/UI';
import { Rules } from './Rules';
import { CasinoChat } from './Chat';
import { casinoSound } from './sound';
import { requestId, type CasinoGame } from './types';
import { RouletteTable, RouletteWheel, rouletteColor } from './RouletteTable';
import { CrashScene } from './ArcadeScenes';
import { HorseRace } from './HorseRace';
import { FortuneWheel } from './fortune/FortuneWheel';
import { displayOrder, sumChips } from './fortune/order';
import { SECTORS } from './fortune/model';

interface CommonState {
  id: string;
  rules_version: number;
  rules?: CasinoGame['rules'];
  limits?: CasinoGame['limits'];
  state: {
    phase: string;
    opens: number;
    starts: number;
    ends?: number;
    next?: number;
    server_time: number;
    multiplier?: number;
    cancel_reason?: string;
    result?: {
      number?: number;
      sector?: string;
      index?: number;
      point?: number;
      winners?: number[];
      times?: number[];
    };
    horses?: {
      name: string;
      color: string;
      speed: number;
      stamina: number;
      variation: number;
      probability: string[];
    }[];
    positions?: number[];
    odds?: number[];
    mine: {
      stake: number;
      payout: number;
      settled: boolean;
      auto?: number;
      chips: { amount: number; choice: string }[];
    } | null;
    participants: { label: string; bot: boolean; payout?: number }[];
    total_stake?: number;
  };
}
interface Snapshot {
  round: CommonState | null;
  zones?: Record<string, { label: string; multiplier: number; numbers: number[] }>;
  sectors?: string[];
  payouts?: Record<string, [number, number]>;
  history?: { id: string; result: { number?: number; point?: number; sector?: string } }[];
}
const names: Record<string, string> = {
  bronze: 'Бронза',
  silver: 'Серебро',
  gold: 'Золото',
  diamond: 'Алмаз',
};
export function CommonRoom({
  game,
  refresh,
  holdBalance,
}: {
  game: CasinoGame;
  refresh: () => Promise<void>;
  holdBalance: () => () => Promise<void>;
}) {
  const fortuneLanded = useRef('');
  const walletHold = useRef<{ id: string; release: () => Promise<void> } | null>(null);
  const protectBalance = (record: CommonState | null) => {
    if (
      game.id !== 'wheel' ||
      !record ||
      record.state.phase === 'betting' ||
      fortuneLanded.current === record.id
    )
      return;
    if (!walletHold.current) walletHold.current = { id: record.id, release: holdBalance() };
  };
  const [risk, setRisk] = useState('low');
  const [landedRound, setLandedRound] = useState('');
  const [pendingWheel, setPendingWheel] = useState('');
  const [lastWheelNumber, setLastWheelNumber] = useState<number>();
  const roomId = game.id === 'wheel' ? `wheel-${risk}` : game.id;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [liveDelivery, setLiveDelivery] = useState(false);
  const [amount, setAmount] = useState('10'),
    [auto, setAuto] = useState('2.00');
  const [autoEnabled, setAutoEnabled] = useState(true),
    [choice] = useState('red');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false),
    retry = useRef<{ key: string; payload: Record<string, unknown> } | null>(null);
  const lastSettlement = useRef('');
  useEffect(() => {
    let alive = true,
      running = false;
    let lastFrame = 0,
      lastLoad = 0,
      loadedId: string | undefined,
      loadedPhase: string | undefined;
    let ownBet: CommonState['state']['mine'] = null;
    setLiveDelivery(false);
    setSnapshot(null);
    const load = async () => {
      if (running) return;
      running = true;
      lastLoad = Date.now();
      try {
        const value = await api<Snapshot>(`/casino/rooms/${roomId}`);
        if (!alive) return;
        protectBalance(value.round);
        setSnapshot(value);
        const record = value.round;
        loadedId = record?.id;
        loadedPhase = record?.state.phase;
        ownBet = record?.state.mine ?? null;
        if (record?.state.mine?.settled && lastSettlement.current !== record.id) {
          lastSettlement.current = record.id;
          if (!['roulette', 'wheel', 'horses'].includes(game.id)) casinoSound('result');
          void refresh();
        }
      } catch (error) {
        if (alive) setError((error as Error).message);
      } finally {
        running = false;
      }
    };
    void load();
    const socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      socket.emit('casino:watch', { room: roomId });
      void load();
    });
    socket.on('disconnect', () => {
      if (alive) setLiveDelivery(false);
    });
    socket.on(
      'casino:room',
      (message: {
        room: string;
        round: Omit<CommonState, 'state'> & { state: Omit<CommonState['state'], 'mine'> };
      }) => {
        if (!alive || message.room !== roomId) return;
        lastFrame = Date.now();
        setLiveDelivery(true);
        const frame = message.round;
        protectBalance({ ...frame, state: { ...frame.state, mine: ownBet } });
        // Fetch private settlement/history on transitions, never derive a payment
        // from the public multiplier. Auto-cashout remains entirely server-owned.
        if (
          loadedId !== frame.id ||
          loadedPhase !== frame.state.phase ||
          (ownBet?.auto && !ownBet.settled && (frame.state.multiplier ?? 0) >= ownBet.auto)
        )
          void load();
        setSnapshot((previous) => {
          if (
            !previous?.round ||
            previous.round.id !== frame.id ||
            previous.round.state.server_time > frame.state.server_time
          )
            return previous;
          return {
            ...previous,
            round: { ...frame, state: { ...frame.state, mine: previous.round.state.mine } },
          };
        });
      },
    );
    const timer = window.setInterval(() => {
      const healthy = socket.connected && Date.now() - lastFrame < 3500;
      setLiveDelivery(healthy);
      if (Date.now() - lastLoad >= (healthy ? 15000 : 2000)) void load();
    }, 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      socket.disconnect();
      void walletHold.current?.release();
      walletHold.current = null;
    };
  }, [roomId]);
  async function action(action: string, selected?: string | number) {
    if (inFlight.current || !snapshot?.round) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    casinoSound('click');
    const payload = {
      action,
      round_id: snapshot.round.id,
      amount,
      choice: selected ?? choice,
      auto: autoEnabled ? auto : null,
    };
    const key = JSON.stringify(payload);
    if (retry.current?.key !== key)
      retry.current = { key, payload: { ...payload, request_id: requestId() } };
    try {
      const round = await api<CommonState>(
        `/casino/rooms/${roomId}/actions`,
        'POST',
        retry.current.payload,
      );
      retry.current = null;
      setSnapshot({ ...snapshot, round });
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const record = snapshot?.round,
    state = record?.state;
  const roulettePending =
    game.id === 'roulette' && state?.result?.number !== undefined && landedRound !== record?.id;
  const rouletteResult = roulettePending ? undefined : state?.result?.number;
  const fortunePending =
    game.id === 'wheel' &&
    (!!pendingWheel || (state?.phase !== 'betting' && landedRound !== record?.id));
  const resultPending = roulettePending || fortunePending;
  const betting = state?.phase === 'betting';
  const order = displayOrder(risk, snapshot?.sectors?.length ?? 0);
  const myChips = sumChips(state?.mine?.chips ?? []);
  const participants = state?.participants.map((participant, index) => (
    <p key={index}>
      {participant.label}
      {participant.bot ? ' · БОТ' : ''}
      {participant.payout !== undefined && !resultPending
        ? ` · ${points(participant.payout)} ш.`
        : ''}
    </p>
  ));
  const next = state
    ? betting
      ? state.starts
      : state.phase === 'result'
        ? state.next
        : state.ends
    : null;
  return (
    <>
      <h2>{game.rules.name}</h2>
      {game.id === 'wheel' && (
        <div className="tabs">
          {['low', 'medium', 'high'].map((value) => (
            <button
              key={value}
              className={value === risk ? 'active' : ''}
              onClick={() => setRisk(value)}
            >
              {
                (
                  { low: 'Низкий риск', medium: 'Средний риск', high: 'Высокий риск' } as Record<
                    string,
                    string
                  >
                )[value]
              }
            </button>
          ))}
        </div>
      )}
      <ErrorBox message={error} />
      {!snapshot ? (
        <Loading />
      ) : !state ? (
        <p className="panel">Ожидание нового общего раунда.</p>
      ) : (
        <div
          className={`casino-game-layout casino-common-layout ${game.id === 'roulette' ? 'casino-roulette-layout' : game.id === 'wheel' ? 'casino-fortune-layout' : game.id === 'horses' ? 'casino-horses-layout' : ''}`}
        >
          <section className={`casino-felt common-scene game-${game.id} risk-${risk}`}>
            {game.id !== 'horses' && (
              <p className="casino-phase">
                <small className="casino-delivery">
                  {liveDelivery ? '● Прямой эфир' : 'Обновление состояния'} ·{' '}
                </small>
                {fortunePending && state.phase === 'result'
                  ? 'Замедление колеса'
                  : roulettePending
                    ? 'Остановка шарика'
                    : betting
                      ? 'Приём ставок'
                      : state.phase === 'live'
                        ? game.id === 'crash'
                          ? 'Полёт'
                          : game.id === 'horses'
                            ? 'Заезд'
                            : 'Вращение'
                        : 'Результат'}
                {next && !resultPending
                  ? ` · ${Math.max(0, Math.ceil(next - state.server_time))} сек.`
                  : ''}
              </p>
            )}
            {state.cancel_reason && <p className="casino-result">{state.cancel_reason}</p>}
            {game.id === 'horses' ? (
              <HorseRace
                horses={state.horses ?? []}
                positions={state.positions ?? []}
                phase={state.phase}
                winners={state.result?.winners}
                times={state.result?.times}
                roundId={record.id}
                secondsToStart={Math.max(0, Math.ceil(state.starts - state.server_time))}
                liveDelivery={liveDelivery}
              />
            ) : game.id === 'crash' ? (
              <CrashScene
                key={record.id}
                phase={state.phase}
                multiplier={state.multiplier ?? 100}
                history={snapshot.history ?? []}
                auto={auto}
                autoEnabled={autoEnabled}
                serverTime={state.server_time}
              />
            ) : game.id === 'roulette' ? (
              <div className="roulette-stage">
                <RouletteWheel
                  roundId={record.id}
                  phase={state.phase}
                  result={state.result?.number}
                  onSettling={setPendingWheel}
                  onLanded={(id, number) => {
                    setPendingWheel('');
                    setLastWheelNumber(number);
                    setLandedRound(id);
                    if (state.mine?.settled) casinoSound('result');
                  }}
                />
                <div className="roulette-stage-info">
                  <small>ОДНО ЗЕРО · 37 ЧИСЕЛ</small>
                  <h3>
                    {fortunePending && state.phase === 'result'
                      ? 'Замедление колеса'
                      : roulettePending
                        ? 'Шарик замедляется…'
                        : rouletteResult === undefined
                          ? lastWheelNumber === undefined
                            ? 'Ваше место за столом'
                            : `Последний результат: ${lastWheelNumber}`
                          : `Выпало ${rouletteResult}`}
                  </h3>
                  <p>Выберите фишку и поле — можно поставить несколько ставок.</p>
                  {!!snapshot.history?.length && (
                    <div className="roulette-history" aria-label="Последние результаты">
                      {snapshot.history
                        .filter(
                          (item) =>
                            item.id !== pendingWheel && (!roulettePending || item.id !== record.id),
                        )
                        .map((item) => (
                          <span key={item.id} className={rouletteColor(item.result.number!)}>
                            {item.result.number}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
                <section className="roulette-participants" aria-label="Участники рулетки">
                  <h3>Участники · {state.participants.length}</h3>
                  <p>Ставки {points(state.total_stake ?? 0)} ш.</p>
                  <div
                    className="roulette-participants-list"
                    tabIndex={0}
                    role="region"
                    aria-label="Список участников рулетки"
                  >
                    {participants}
                  </div>
                </section>
              </div>
            ) : (
              <FortuneWheel
                key={roomId}
                id={record.id}
                phase={state.phase}
                result={
                  state.result?.index === undefined ? undefined : order.indexOf(state.result.index)
                }
                sectors={order.map((index) => snapshot.sectors![index])}
                payouts={snapshot.payouts ?? {}}
                risk={risk}
                onSettling={setPendingWheel}
                onLanded={(id) => {
                  fortuneLanded.current = id;
                  setLandedRound(id);
                  setPendingWheel('');
                  void walletHold.current?.release();
                  walletHold.current = null;
                  if (state.mine?.settled) casinoSound('result');
                }}
              />
            )}
            {state.result &&
              !['roulette', 'wheel', 'horses'].includes(game.id) &&
              !fortunePending && (
                <p className="casino-result">
                  Результат:{' '}
                  {state.result.winners
                    ? state.result.winners.map((index) => state.horses?.[index].name).join(' / ')
                    : (state.result.number ??
                      names[state.result.sector ?? ''] ??
                      `×${(state.result.point ?? 100) / 100}`)}
                </p>
              )}
            {game.id === 'roulette' && (
              <>
                <RouletteTable
                  zones={snapshot.zones ?? {}}
                  chips={state.mine?.chips ?? []}
                  disabled={busy || !betting}
                  amount={amount}
                  setAmount={setAmount}
                  bet={(zone) => void action('bet', zone)}
                  undo={() => void action('undo')}
                  clear={() => void action('clear')}
                  result={rouletteResult}
                />
                <p className="roulette-bet-limits">
                  {points(record.limits?.minimum ?? game.limits.minimum)}–
                  {points(record.limits?.maximum ?? game.limits.maximum)} ш. на раунд.
                </p>
              </>
            )}
            {state.mine && (
              <div className="casino-result">
                <p>
                  {game.id === 'horses' && (
                    <strong>{state.horses?.[Number(state.mine.chips[0]?.choice)]?.name} · </strong>
                  )}
                  Ваша ставка: {points(state.mine.stake)} ш.
                </p>
                {state.mine.settled && !resultPending ? (
                  <p>Выплата: {points(state.mine.payout)} ш.</p>
                ) : (
                  <p>
                    {fortunePending
                      ? 'Выплата после остановки колеса'
                      : 'Зарезервирована до расчёта.'}
                  </p>
                )}
              </div>
            )}
          </section>
          {game.id !== 'roulette' && (
            <aside className="panel casino-controls">
              <label>
                Ставка / фишка, шейкели
                <input
                  inputMode="decimal"
                  value={amount}
                  disabled={busy || !betting}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <p>
                {points(record.limits?.minimum ?? game.limits.minimum)}–
                {points(record.limits?.maximum ?? game.limits.maximum)} ш. на раунд.
              </p>
              {game.id === 'wheel' &&
                [...new Set(snapshot.sectors)].map((sector) => (
                  <button
                    key={sector}
                    style={{ '--sector-color': SECTORS[sector]?.color } as CSSProperties}
                    disabled={busy || !betting || !!pendingWheel}
                    onClick={() => void action('bet', sector)}
                  >
                    {myChips[sector] ? (
                      <small className="fortune-bet-badge">
                        Поставлено: {points(myChips[sector])} ш.
                      </small>
                    ) : null}
                    {names[sector]} · {snapshot.sectors!.filter((value) => value === sector).length}
                    /{snapshot.sectors!.length}
                    {snapshot.payouts?.[sector] &&
                      ` · ×${(snapshot.payouts[sector][0] / snapshot.payouts[sector][1]).toLocaleString('ru-RU', { maximumFractionDigits: 4 })}`}
                  </button>
                ))}
              {game.id === 'wheel' && (
                <section className="fortune-my-bets" aria-label="Ваши ставки">
                  <h3>
                    {state.mine?.settled && !fortunePending
                      ? 'Ставки завершённого раунда'
                      : 'Ваши ставки'}
                  </h3>
                  {Object.entries(myChips).map(([sector, value]) => (
                    <p key={sector}>
                      <span>{names[sector]}</span>
                      <strong>{points(value)} ш.</strong>
                    </p>
                  ))}
                  {!state.mine && <p>Ставок пока нет</p>}
                  <p>
                    <span>Всего поставлено</span>
                    <strong>{points(state.mine?.stake ?? 0)} ш.</strong>
                  </p>
                </section>
              )}
              {game.id === 'horses' && (
                <div className="race-bet-options">
                  {state.horses?.map((horse, index) => (
                    <div
                      key={horse.name}
                      className={
                        state.mine?.chips.some((chip) => Number(chip.choice) === index)
                          ? 'selected'
                          : ''
                      }
                    >
                      <button
                        style={{ '--silk': horse.color } as CSSProperties}
                        disabled={busy || !betting || !!state.mine}
                        onClick={() => void action('bet', index)}
                      >
                        <span className="race-entry-number">{index + 1}</span>
                        <strong>
                          {horse.name} · ×{(state.odds![index] / 100).toFixed(2)}
                        </strong>
                        <small>Ставка на первое место</small>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {game.id === 'crash' && (
                <>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={autoEnabled}
                      disabled={busy || !betting || !!state.mine}
                      onChange={(event) => setAutoEnabled(event.target.checked)}
                    />
                    Auto-cashout
                  </label>
                  <label>
                    Порог ×
                    <input
                      inputMode="decimal"
                      value={auto}
                      disabled={busy || !betting || !!state.mine || !autoEnabled}
                      onChange={(event) => setAuto(event.target.value)}
                    />
                  </label>
                  <button
                    disabled={busy || !betting || !!state.mine}
                    onClick={() => void action('bet')}
                  >
                    Принять ставку
                  </button>
                  <button
                    disabled={busy || state.phase !== 'live' || !state.mine || state.mine.settled}
                    onClick={() => void action('cashout')}
                  >
                    Забрать сейчас
                  </button>
                  <p className="muted">При совпадении порога с точкой падения приоритет у crash.</p>
                </>
              )}
              <details className="common-participants">
                <summary>
                  Участники · {state.participants.length} · Ставки {points(state.total_stake ?? 0)}{' '}
                  ш.
                </summary>
                {participants}
              </details>
            </aside>
          )}
        </div>
      )}
      <CasinoChat key={roomId} channel={roomId} title="Чат общего раунда" />
      <Rules
        game={{
          ...game,
          rules: record?.rules ?? game.rules,
          limits: record?.limits ?? game.limits,
        }}
      />
    </>
  );
}
