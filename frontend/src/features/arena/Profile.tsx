import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { mapName } from './maps/names';
import { modes } from './types';
import type { Mode } from './types';
type Totals = {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  kills: number;
  deaths: number;
  headshots: number;
  headshots_unavailable: number;
  kd: number;
};
interface Profile {
  total: Totals;
  modes: Record<Mode, Totals>;
  history: {
    id: string;
    date: number;
    mode: Mode;
    map_id?: string;
    map_name?: string;
    map_revision?: number;
    outcome: string;
    kills: number;
    deaths: number;
    headshots: number | null;
    place: number;
    score: Record<string, number>;
  }[];
}
export function ArenaProfile() {
  const [data, setData] = useState<Profile | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    void api<Profile>('/arena/profile')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="arena-profile">
      <h2>Моя статистика Arena</h2>
      {error && <p role="alert">{error}</p>}
      {data ? (
        <>
          <div className="arena-stat-grid">
            {Object.entries({
              Матчи: data.total.matches,
              Победы: data.total.wins,
              Поражения: data.total.losses,
              Ничьи: data.total.draws,
              Убийства: data.total.kills,
              Смерти: data.total.deaths,
              'K/D': data.total.kd,
              Headshots: data.total.headshots,
            }).map(([key, value]) => (
              <div key={key}>
                <b>{value}</b>
                <small>{key}</small>
              </div>
            ))}
          </div>
          {data.total.headshots_unavailable > 0 && (
            <p>
              Для {data.total.headshots_unavailable} старых матчей headshots не записывались; эти
              попадания не включены.
            </p>
          )}
          <div className="arena-mode-cards">
            {Object.entries(data.modes).map(([mode, s]) => (
              <article key={mode}>
                <h3>{modes[mode as Mode]}</h3>
                {s.matches} матчей · {s.wins} побед · K/D {s.kd}
              </article>
            ))}
          </div>
          <details>
            <summary>Мои последние матчи · {data.history.length}</summary>
            <div className="arena-personal-history">
              <table className="arena-scoreboard">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Режим / карта</th>
                    <th>Итог</th>
                    <th>K / D / HS</th>
                    <th>Место</th>
                    <th>Счёт</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((h) => (
                    <tr key={h.id}>
                      <td>{new Date(h.date * 1000).toLocaleString('ru-RU')}</td>
                      <td>
                        {modes[h.mode]} · {h.map_name ?? mapName(h.map_id)}
                        {h.map_revision ? ` · rev ${h.map_revision}` : ''}
                      </td>
                      <td>{{ win: 'Победа', loss: 'Поражение', draw: 'Ничья' }[h.outcome]}</td>
                      <td>
                        {h.kills} / {h.deaths} / {h.headshots ?? '—'}
                      </td>
                      <td>{h.place}</td>
                      <td>
                        {h.mode === 'dm'
                          ? h.kills
                          : `${h.score?.Alpha ?? 0} : ${h.score?.Bravo ?? 0}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p>Загрузка статистики…</p>
      )}
    </section>
  );
}
