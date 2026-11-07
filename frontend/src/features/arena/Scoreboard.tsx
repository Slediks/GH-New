import type { Player } from './types';
export function Scoreboard({
  players,
  mode,
  self,
}: {
  players: Player[];
  mode: string;
  self?: string;
}) {
  return (
    <table className="arena-scoreboard">
      <thead>
        <tr>
          <th>Место / игрок</th>
          {mode !== 'dm' && <th>Команда</th>}
          <th>Убийства</th>
          <th>Смерти</th>
          <th>Помощь</th>
          <th>Headshots</th>
          <th>K/D</th>
          <th>Ping</th>
        </tr>
      </thead>
      <tbody>
        {[...players]
          .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
          .map((p, i) => (
            <tr key={p.id} className={p.id === self ? 'arena-own-row' : ''}>
              <td>
                {i + 1}. {p.name} {p.alive === false ? '†' : ''}
              </td>
              {mode !== 'dm' && <td>{p.team}</td>}
              <td>{p.kills}</td>
              <td>{p.deaths}</td>
              <td>{p.assists}</td>
              <td>{p.headshots ?? '—'}</td>
              <td>{(p.kills / Math.max(1, p.deaths)).toFixed(1)}</td>
              <td>{p.ping ?? '—'}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
