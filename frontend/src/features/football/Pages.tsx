import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Coins, Radio, WifiOff, ArrowRight, Shield, Clock3 } from 'lucide-react';
import { api, date, phases, points } from '../../shared/api';
import { useResource } from '../../shared/hooks';
import { Empty, ErrorBox, Loading, Pagination } from '../../shared/UI';
import type { FootballData, Match, MatchEvent, Page, Snapshot } from '../../shared/types';
import { useActivity } from '../activity/useActivity';
import { useAuth } from '../../app/Auth';
import { Pitch } from './Pitch';
import { acceptsSnapshot } from './interpolation';
import { mergeComments } from './comments';
import { Statistics } from './Statistics';
import { Competition } from './Competition';
import { useMatchFullscreen } from './fullscreen';
import './football.css';

function TeamName({ match, side }: { match: Match; side: number }) {
  return (
    <span className="team-name">
      <span className="team-emblem" style={{ color: match.teams[side].color }}>
        <Shield size={27} />
        <b>{match.teams[side].name.slice(0, 1)}</b>
      </span>
      {match.teams[side].name}
    </span>
  );
}

export function FootballPage() {
  const { data, error, reload } = useResource<FootballData>('/football');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [connected, setConnected] = useState(false),
    [comments, setComments] = useState<MatchEvent[]>([]),
    [session, setSession] = useState<string | null>(null),
    [currentTime, setCurrentTime] = useState(Date.now());
  const latest = useRef<Snapshot | null>(null);
  const { refresh } = useAuth();
  const activity = useActivity(session);
  const match = data?.matches[0];
  const screen = useMatchFullscreen(match?.id);
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let stopped = false;
    void api<{ session_id: string }>('/activity/start', 'POST', { source: 'football' })
      .then((result) => {
        if (!stopped) setSession(result.session_id);
      })
      .catch(() => {
        if (!stopped) setSession(null);
      });
    return () => {
      stopped = true;
    };
  }, []);
  useEffect(() => {
    if (data?.snapshot && acceptsSnapshot(latest.current, data.snapshot)) {
      latest.current = data.snapshot;
      setSnapshot(data.snapshot);
    }
  }, [data]);
  useEffect(() => {
    if (!match || !connected) return;
    let cancelled = false;
    const id = match.id;
    void api<Match>(`/matches/${id}`)
      .then((result) => {
        if (!cancelled)
          setComments((previous) =>
            mergeComments(
              previous.filter((e) => e.match_id === id),
              (result.events ?? []).map((e) => ({ ...e, match_id: id })),
            ),
          );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [match?.id, connected]);
  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      setConnected(true);
      void reload();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('snapshot', (incoming: Snapshot) => {
      if (acceptsSnapshot(latest.current, incoming)) {
        latest.current = incoming;
        setSnapshot(incoming);
      }
    });
    socket.on('phase', () => void reload());
    socket.on('comment', (event: MatchEvent) =>
      setComments((previous) =>
        mergeComments(
          previous.filter((e) => e.match_id === event.match_id),
          [event],
        ),
      ),
    );
    socket.on('balance', () => void refresh());
    const offline = () => {
      setConnected(false);
      socket.disconnect();
    };
    const online = () => socket.connect();
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      socket.disconnect();
    };
  }, [reload]);
  const current = snapshot?.match_id === match?.id ? snapshot : null;
  const score = current?.score ?? match?.score;
  const phase = current?.phase ?? match?.state;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ЛИГА ЧЕМПИОНОВ · GAMEHUB · 5 НА 5</div>
          <h1>На одной трибуне</h1>
          <p>Общий матч. Живые эмоции. Ваша команда.</p>
        </div>
        <Link className="button" to="/matches">
          История матчей <ArrowRight size={16} />
        </Link>
      </div>
      <ErrorBox message={error} />
      <Competition matchId={match?.id} />
      {!connected && (
        <div className="connection-warning">
          <WifiOff size={17} />
          Восстанавливаем соединение с трансляцией…
        </div>
      )}
      {!match ? (
        <Empty>Расписание готовится или новые матчи приостановлены.</Empty>
      ) : (
        <div
          ref={screen.root}
          className={`football-layout ${screen.open ? 'football-fullscreen' : ''} ${screen.comments ? 'with-comments' : ''} ${screen.betting ? 'with-bet' : ''}`}
          role={screen.open ? 'dialog' : undefined}
          aria-modal={screen.open || undefined}
          aria-label={screen.open ? 'Полноэкранный матч' : undefined}
        >
          <div className="football-screen-controls">
            <button ref={screen.trigger} onClick={screen.toggle}>
              {screen.open ? 'Свернуть · Esc' : 'Открыть на весь экран'}
            </button>
            {screen.open && (
              <button
                aria-expanded={screen.betting}
                onClick={() => screen.setBetting(!screen.betting)}
              >
                {screen.betting ? 'Скрыть ставку' : 'Сделать прогноз'}
              </button>
            )}
            {screen.open && (
              <button
                aria-expanded={screen.comments}
                onClick={() => screen.setComments(!screen.comments)}
              >
                {screen.comments ? 'Закрыть комментарии' : 'Комментарии матча'}
              </button>
            )}
          </div>
          <section className="match-main">
            <div className="scoreboard">
              <TeamName match={match} side={0} />
              <div className="score">
                <span className="badge">
                  <Radio size={13} />
                  {phases[phase ?? 'scheduled']}
                </span>
                <strong>{score?.join(' : ')}</strong>
                <small>
                  {phase === 'betting_open'
                    ? `До начала ${Math.max(0, Math.ceil((match.starts_at ?? 0) - currentTime / 1000))} сек.`
                    : phase === 'live'
                      ? `${current?.extra_time ? 'Доп. время · ' : ''}${Math.floor(current?.clock ?? current?.elapsed ?? 0)} / ${match.rules.match_seconds} сек.`
                      : phase === 'penalties'
                        ? `Пенальти ${(current?.penalties ?? match.penalties).join(' : ')}`
                        : 'Матч готовится'}
                </small>
              </div>
              <TeamName match={match} side={1} />
            </div>
            <div className="team-styles">
              {match.teams.map((team) => (
                <span key={team.id}>{team.style_label ?? 'Сбалансированная игра'}</span>
              ))}
            </div>
            <Pitch snapshot={current} teams={match.teams} />
            <details className="football-lineups">
              <summary>Составы матча и запасные</summary>
              <div className="football-lineup-columns">
                {match.teams.map((t) => (
                  <div key={t.id}>
                    <h3>{t.name}</h3>
                    {t.lineup?.map((p) => (
                      <p key={p.id}>
                        {p.number} · {p.name} · {p.role}
                      </p>
                    ))}
                    <details>
                      <summary>Запасные · {t.bench?.length ?? 0}</summary>
                      {t.bench?.map((p) => (
                        <p key={p.id}>
                          {p.number} · {p.name} · {p.role}
                        </p>
                      ))}
                    </details>
                  </div>
                ))}
              </div>
            </details>
            {phase === 'penalties' && (
              <div className="penalty-strip" aria-label="Серия пенальти">
                {match.teams.map((team, side) => (
                  <span key={team.id}>
                    {team.name}:{' '}
                    {(current?.penalty_results?.[side] ?? []).map((goal, i) => (
                      <b
                        key={i}
                        aria-label={`Удар ${i + 1}: ${goal ? 'гол' : 'не забит'}`}
                        className={goal ? 'scored' : 'missed'}
                      >
                        {goal ? '●' : '×'}
                      </b>
                    ))}{' '}
                    ({current?.attempts?.[side] ?? 0} ударов)
                  </span>
                ))}
              </div>
            )}
            <Statistics statistics={current?.statistics ?? match.statistics} />
            <div className="player-toolbar">
              <span className={activity.active ? 'activity-on' : 'muted'}>
                <Coins size={17} />
                {activity.reason}
              </span>
              <button onClick={activity.signal}>Я смотрю</button>
            </div>
            <BetPanel key={match.id} match={match} onBet={refresh} />
          </section>
          <aside className="commentary panel" aria-label="Комментарии матча">
            <div className="section-heading">
              <h2>Комментарии матча</h2>
              <span className="live-dot" />
            </div>
            <p className="muted">События и комментарии матча</p>
            <div className="comment-feed">
              {comments
                .filter((event) => !event.match_id || event.match_id === match.id)
                .slice(-30)
                .reverse()
                .map((event, index) => (
                  <div
                    className={`comment ${event.kind}`}
                    key={event.id ?? `${event.elapsed}-${index}`}
                  >
                    <small>{Math.floor(event.elapsed)}″</small>
                    <p>{event.text}</p>
                  </div>
                ))}
              {!comments.length && (
                <div className="empty">
                  <Radio />
                  Ждём стартовый свисток.
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
      <section className="schedule">
        <div className="section-heading">
          <h2>Далее в эфире</h2>
          <span className="muted">Последовательный эфир турнира</span>
        </div>
        <div className="schedule-grid">
          {data?.matches.slice(1, 5).map((upcoming, index) => (
            <Link className="panel upcoming" key={upcoming.id} to={`/matches/${upcoming.id}`}>
              <span className="muted">
                <Clock3 size={14} />
                Матч {index + 2}
              </span>
              <TeamName match={upcoming} side={0} />
              <TeamName match={upcoming} side={1} />
              <small>{phases[upcoming.state]}</small>
            </Link>
          ))}
        </div>
      </section>
      {data?.previous && (
        <div className="panel previous">
          <span className="muted">Предыдущий матч</span>
          <Link to={`/matches/${data.previous.id}`}>
            {data.previous.teams.map((team) => team.name).join(' — ')}{' '}
            <strong>{data.previous.score.join(' : ')}</strong> · {phases[data.previous.state]}
            {data.previous.penalties.some(Boolean) &&
              ` · пен. ${data.previous.penalties.join(' : ')}`}
          </Link>
        </div>
      )}
    </>
  );
}

function BetPanel({ match, onBet }: { match: Match; onBet: () => Promise<void> }) {
  const [side, setSide] = useState(0),
    [amount, setAmount] = useState('10'),
    [error, setError] = useState(''),
    [accepted, setAccepted] = useState(false),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const cents = Math.round(Number(amount) * 100),
    odds = match.odds[side];
  const open = match.state === 'betting_open' && Date.now() / 1000 < (match.starts_at ?? 0);
  return (
    <section className="panel bet-panel">
      <div className="section-heading">
        <h2>Ваш прогноз</h2>
        <span className="muted">
          {match.season_id ? '1X2 · только основное время' : 'Победа с учётом пенальти'}
        </span>
      </div>
      <ErrorBox message={error} />
      {accepted ? (
        <p className="success">Ставка принята. Результат появится в личном кабинете.</p>
      ) : !open ? (
        <p className="muted">
          {match.state === 'scheduled'
            ? 'Коэффициенты рассчитываются. Приём ставок откроется перед матчем.'
            : 'Приём ставок закрыт. Следующая возможность — перед новым матчем.'}
        </p>
      ) : (
        <>
          <div className="bet-options">
            {(match.season_id ? [...match.teams, { id: -1, name: 'Ничья' }] : match.teams).map(
              (team, index) => (
                <button
                  className={side === index ? 'chosen' : ''}
                  key={team.id}
                  onClick={() => {
                    setSide(index);
                    setConfirm(false);
                  }}
                >
                  <span>{team.name}</span>
                  <strong>× {(match.odds[index] / 100).toFixed(2)}</strong>
                </button>
              ),
            )}
          </div>
          <div className="bet-entry">
            <label>
              Сумма, очки
              <input
                type="number"
                step="0.01"
                min={match.rules.minimum_bet / 100}
                max={Math.min(match.rules.maximum_bet, user?.balance ?? 0) / 100}
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setConfirm(false);
                }}
              />
            </label>
            <div>
              <small>Возможная выплата</small>
              <strong>{points(Math.floor((cents * odds) / 100))} очков</strong>
            </div>
            <button
              className="primary"
              disabled={
                busy ||
                !Number.isFinite(cents) ||
                cents < match.rules.minimum_bet ||
                cents > Math.min(match.rules.maximum_bet, user?.balance ?? 0)
              }
              onClick={async () => {
                if (!confirm) {
                  setConfirm(true);
                  return;
                }
                setBusy(true);
                try {
                  await api(`/matches/${match.id}/bet`, 'POST', { side, amount: cents });
                  setAccepted(true);
                  await onBet();
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirm ? 'Подтвердить ставку' : 'Проверить ставку'}
            </button>
          </div>
          {confirm && (
            <p className="bet-confirm">
              {side === 2 ? 'Ничья' : match.teams[side].name} · {points(cents)} очков · ×{' '}
              {(odds / 100).toFixed(2)} · выплата {points(Math.floor((cents * odds) / 100))}. После
              подтверждения изменить или отменить ставку нельзя.
            </p>
          )}
          <p className="fine-print">
            От {points(match.rules.minimum_bet)} до {points(match.rules.maximum_bet)} очков. Выплата
            включает сумму ставки.
          </p>
        </>
      )}
    </section>
  );
}

export function HistoryPage() {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useResource<Page<Match>>(`/matches?page=${page}`);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ЛИГА GAMEHUB</div>
          <h1>История матчей</h1>
          <p>Результаты, статистика и ключевые моменты.</p>
        </div>
      </div>
      <ErrorBox message={error} />
      {loading ? (
        <Loading />
      ) : (
        <div className="item-list">
          {data?.items.map((match) => (
            <Link className="list-row" to={`/matches/${match.id}`} key={match.id}>
              <div>
                <span className="muted">
                  {date(match.finished_at)} · {phases[match.state]}
                </span>
                <h3>
                  {match.teams[0].name} — {match.teams[1].name}
                </h3>
              </div>
              <div className="result-score">
                <strong>{match.score.join(' : ')}</strong>
                {match.penalties.some(Boolean) && <small>пен. {match.penalties.join(' : ')}</small>}
              </div>
              <ArrowRight size={18} />
            </Link>
          ))}
        </div>
      )}
      {!loading && !data?.items.length && <Empty>Завершённых матчей пока нет.</Empty>}
      <Pagination page={page} setPage={setPage} total={data?.total} />
    </>
  );
}
export function MatchPage() {
  const { id } = useParams();
  const { data: match, error } = useResource<Match>(`/matches/${id}`);
  if (!match) return error ? <ErrorBox message={error} /> : <Loading />;
  return (
    <>
      <Link className="back-link" to="/matches">
        ← История матчей
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            МАТЧ №{id} · {phases[match.state]}
          </div>
          <h1>
            {match.teams[0].name} — {match.teams[1].name}
          </h1>
          <p>{date(match.finished_at ?? match.starts_at)}</p>
        </div>
      </div>
      <div className="scoreboard panel">
        <TeamName match={match} side={0} />
        <div className="score">
          <strong>{match.score.join(' : ')}</strong>
          <small>Основное время {(match.regulation_score ?? match.score).join(' : ')}</small>
          <small>Пенальти {match.penalties.join(' : ')}</small>
        </div>
        <TeamName match={match} side={1} />
      </div>
      {match.winner !== null && (
        <p className="success">
          {match.winner === 2 ? 'Ничья' : `Победитель: ${match.teams[match.winner].name}`}
        </p>
      )}
      <div className="detail-columns">
        <section className="panel">
          <h2>Статистика</h2>
          <Statistics statistics={match.statistics} />
          {Object.entries(match.statistics)
            .filter(([key]) =>
              ['passes', 'completed_passes', 'interceptions', 'tackles', 'blocks'].includes(key),
            )
            .map(([key, value]) => (
              <div className="stat-row" key={key}>
                <span>
                  {(
                    {
                      shots: 'Удары',
                      saves: 'Сейвы',
                      passes: 'Передачи',
                      interceptions: 'Перехваты',
                      completed_passes: 'Точные передачи',
                      tackles: 'Отборы',
                      blocks: 'Блоки',
                    } as Record<string, string>
                  )[key] ?? key}
                </span>
                <strong>{value.join(' : ')}</strong>
              </div>
            ))}
          <div className="stat-row">
            <span>Коэффициенты</span>
            <strong>
              {match.model_version
                ? match.odds.map((odd) => (odd / 100).toFixed(2)).join(' / ')
                : 'Расчёт ожидается'}
            </strong>
          </div>
          <small className="muted">Модель: {match.model_version || 'Расчёт ожидается'}</small>
        </section>
        <section className="panel">
          <h2>Ход матча</h2>
          {match.events?.map((event) => (
            <div className={`comment ${event.kind}`} key={event.id}>
              <small>{Math.floor(event.elapsed)}″</small>
              <p>{event.text}</p>
            </div>
          ))}
          {!match.events?.length && <p className="muted">Матч ещё не начался.</p>}
        </section>
      </div>
    </>
  );
}
