import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { mapName } from './maps/names';
import { Scoreboard } from './Scoreboard';
import { modes, type Config, type Result } from './types';
interface History {
  page: number;
  has_more: boolean;
  matches: { id: string; settings: Config; result: Result; finished_at: number; status: string }[];
}
export function ArenaHistory() {
  const [page, setPage] = useState(1),
    [data, setData] = useState<History | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setData(null);
    setError('');
    void api<History>(`/arena/history?page=${page}`)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [page]);
  return (
    <section className="arena-admin-history">
      <h3>Общая история матчей</h3>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Загрузка истории…</p>}
      {data?.matches.map((m) => {
        const winner =
          m.result.players?.find((p) => p.id === m.result.winner)?.name ??
          m.result.winner ??
          'Нет победителя';
        return (
          <details key={m.id}>
            <summary>
              {new Date(m.finished_at * 1000).toLocaleString('ru-RU')} · {modes[m.settings.mode]} ·{' '}
              {m.settings.map_name ?? mapName(m.settings.map_id)}
              {m.settings.map_revision ? ` · rev ${m.settings.map_revision}` : ''} · {winner} ·{' '}
              {m.status === 'finished' ? 'Завершён' : 'Отменён'}
            </summary>
            <p>
              {m.result.reason} · {m.result.duration ?? '—'} с · Счёт:{' '}
              {m.settings.mode === 'dm'
                ? Math.max(0, ...(m.result.players ?? []).map((p) => p.kills))
                : `${m.result.scores?.Alpha ?? 0} : ${m.result.scores?.Bravo ?? 0}`}
            </p>
            <Scoreboard players={m.result.players ?? []} mode={m.settings.mode} />
          </details>
        );
      })}
      {data && !data.matches.length && <p>Матчей пока нет</p>}
      <div className="arena-actions">
        <button disabled={page === 1 || !data} onClick={() => setPage(page - 1)}>
          Предыдущие
        </button>
        <span>Страница {page}</span>
        <button disabled={!data?.has_more} onClick={() => setPage(page + 1)}>
          Следующие
        </button>
      </div>
    </section>
  );
}
