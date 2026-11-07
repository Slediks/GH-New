import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useResource } from '../../shared/hooks';
import { ErrorBox } from '../../shared/UI';
import type { ClubsData, RosterData } from './rosterTypes';

interface Season {
  id: number;
  name: string;
  stage: string;
  stage_label?: string;
  champion: number | null;
  status: string;
}
interface Standing {
  id: number;
  name: string;
  color: string;
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  against: number;
  difference: number;
  points: number;
}
interface CompetitionData {
  season: Season | null;
  seasons: Season[];
  standings: Standing[];
  bracket: {
    key: string;
    stage: string;
    teams: number[];
    winner: number | null;
    aggregate?: number[];
  }[];
  fixtures: {
    id: number;
    tie_key: string;
    leg: number;
    state: string;
    teams: number[];
    score: number[];
    penalties: number[];
  }[];
  statistics: ({ id: number; name: string } & Record<string, number | string>)[];
}
const stages: Record<string, string> = {
  playoff: 'Стыки',
  round16: '1/8 финала',
  quarter: 'Четвертьфиналы',
  semi: 'Полуфиналы',
  final: 'Финал',
};

export function Competition({ matchId }: { matchId?: number }) {
  const [tab, setTab] = useState(''),
    [seasonId, setSeasonId] = useState('');
  const { data, error, reload } = useResource<CompetitionData>(
    `/football/competition${seasonId ? `?season_id=${seasonId}` : ''}`,
  );
  useEffect(() => {
    void reload();
  }, [matchId, reload]);
  const names = Object.fromEntries(data?.standings.map((t) => [t.id, t.name]) ?? []);
  return (
    <section className="football-competition panel">
      <ErrorBox message={error} />
      <div className="section-heading">
        <div>
          <strong>{data?.season?.name ?? 'Подготовка турнира'}</strong>
          <p className="muted">
            {data?.season?.stage_label}
            {data?.season?.champion && ` · Чемпион: ${names[data.season.champion]}`}
          </p>
        </div>
        <select aria-label="Сезон" value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
          <option value="">Текущий сезон</option>
          {data?.seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="tabs">
        {[
          ['table', 'Таблица'],
          ['bracket', 'Плей-офф'],
          ['rosters', 'Составы'],
          ['stats', 'Футболисты'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            aria-expanded={tab === key}
            onClick={() => setTab(tab === key ? '' : key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'table' && (
        <div className="football-tournament-scroll">
          <p className="muted">1–8: в 1/8 · 9–24: стыки · 25–36: выбывание</p>
          <table>
            <thead>
              <tr>
                {['#', 'Клуб', 'И', 'В', 'Н', 'П', 'Мячи', '±', 'Очки'].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.standings.map((r) => (
                <tr
                  key={r.id}
                  className={
                    r.rank <= 8
                      ? 'qualification-direct'
                      : r.rank <= 24
                        ? 'qualification-playoff'
                        : ''
                  }
                >
                  <td>{r.rank}</td>
                  <th>{r.name}</th>
                  <td>{r.played}</td>
                  <td>{r.wins}</td>
                  <td>{r.draws}</td>
                  <td>{r.losses}</td>
                  <td>
                    {r.goals}:{r.against}
                  </td>
                  <td>{r.difference}</td>
                  <td>
                    <b>{r.points}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'bracket' && (
        <div className="football-bracket">
          {!data?.bracket.length && <p>Сетка появится после завершения восьми туров.</p>}
          {Object.entries(stages).map(([key, label]) => (
            <section key={key}>
              <h3>{label}</h3>
              {data?.bracket
                .filter((t) => t.stage === key)
                .map((t) => (
                  <article key={t.key} className="panel">
                    <p>
                      {t.teams.map((id, i) => (
                        <span key={id} className={id === t.winner ? 'success' : ''}>
                          {names[id]} {t.aggregate?.[i] ?? ''}
                          {i === 0 && ' — '}
                        </span>
                      ))}
                    </p>
                    {data.fixtures
                      .filter((m) => m.tie_key === t.key)
                      .map((m) => (
                        <Link key={m.id} to={`/matches/${m.id}`}>
                          Матч {m.leg} · {m.state === 'finished' ? m.score.join(':') : 'ожидание'}{' '}
                          {m.penalties.some(Boolean) ? ` · пен. ${m.penalties.join(':')}` : ''}
                        </Link>
                      ))}
                  </article>
                ))}
            </section>
          ))}
        </div>
      )}
      {tab === 'rosters' && <Rosters />}
      {tab === 'stats' && (
        <div className="football-tournament-scroll">
          <table>
            <thead>
              <tr>
                <th>Футболист</th>
                {['Матчи', 'Голы', 'Удары', 'Сейвы', 'ЖК', 'КК', 'Вышел', 'Заменён'].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.statistics.map((p) => (
                <tr key={p.id}>
                  <th>{p.name}</th>
                  {['matches', 'goals', 'shots', 'saves', 'yellow', 'red', 'sub_on', 'sub_off'].map(
                    (k) => (
                      <td key={k}>{p[k] ?? 0}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Rosters() {
  const { data } = useResource<ClubsData>('/football/clubs');
  const [id, setId] = useState(0);
  const selected = id || data?.clubs[0]?.id;
  return (
    <>
      <label>
        Клуб
        <select value={selected ?? ''} onChange={(e) => setId(Number(e.target.value))}>
          {data?.clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {selected && <Roster key={selected} id={selected} />}
    </>
  );
}
function Roster({ id }: { id: number }) {
  const { data, error } = useResource<RosterData>(`/football/clubs/${id}`);
  return (
    <div className="football-tournament-scroll">
      <ErrorBox message={error} />
      <table>
        <thead>
          <tr>
            {['№', 'Футболист', 'Позиция', 'Матчи', 'Голы', 'ЖК', 'КК', 'Доступность'].map((x) => (
              <th key={x}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data?.players.map((p) => (
            <tr key={p.id}>
              <td>{p.number}</td>
              <th>{p.name}</th>
              <td>{p.role}</td>
              <td>{p.statistics?.matches ?? 0}</td>
              <td>{p.statistics?.goals ?? 0}</td>
              <td>{p.statistics?.yellow ?? 0}</td>
              <td>{p.statistics?.red ?? 0}</td>
              <td>
                {p.suspended
                  ? `Пропускает ${p.suspended} матч`
                  : !p.active
                    ? 'Неактивен'
                    : !p.eligible
                      ? 'Не допущен'
                      : 'Доступен'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
