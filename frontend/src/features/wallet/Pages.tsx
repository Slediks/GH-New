import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Coins, Clock3, TrendingUp, Trophy } from 'lucide-react';
import { date, points } from '../../shared/api';
import { useResource } from '../../shared/hooks';
import { Empty, ErrorBox, Loading, Pagination } from '../../shared/UI';
import type { Page, Profile } from '../../shared/types';
const operations: Record<string, string> = {
  welcome: 'Приветственные очки',
  activity: 'Активность',
  bet: 'Ставка',
  payout: 'Выигрыш',
  refund: 'Возврат ставки',
  adjustment: 'Корректировка',
};
const statuses: Record<string, string> = {
  pending: 'Ожидает результата',
  won: 'Выигрыш',
  lost: 'Проигрыш',
  refunded: 'Возврат',
};
export function ProfilePage() {
  const [page, setPage] = useState(1);
  const { data, error } = useResource<Profile>(`/profile?page=${page}`);
  if (!data) return error ? <ErrorBox message={error} /> : <Loading />;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</div>
          <h1>{data.user.login}</h1>
          <p>Ваше время, очки и результаты.</p>
        </div>
      </div>
      <div className="metrics">
        <div className="panel">
          <Coins />
          <span>Доступный баланс</span>
          <strong>
            {points(data.user.balance)} <small>очков</small>
          </strong>
        </div>
        <div className="panel">
          <Clock3 />
          <span>Подтверждённая активность</span>
          <strong>
            {Math.floor(data.user.active_seconds / 60)} <small>мин.</small>
          </strong>
        </div>
        <div className="panel">
          <TrendingUp />
          <span>Заработано за активность</span>
          <strong>
            {points(data.user.activity_earned)} <small>очков</small>
          </strong>
        </div>
      </div>
      <h2>Мои ставки</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Матч</th>
              <th>Выбор</th>
              <th>Ставка</th>
              <th>Коэффициент</th>
              <th>Статус</th>
              <th>Выплата</th>
              <th>Результат</th>
            </tr>
          </thead>
          <tbody>
            {data.bets.map((bet) => (
              <tr key={bet.id}>
                <td>
                  <Link to={`/matches/${bet.match_id}`}>Матч №{bet.match_id}</Link>
                </td>
                <td>{bet.team_name}</td>
                <td>{points(bet.amount)}</td>
                <td>× {(bet.odds / 100).toFixed(2)}</td>
                <td>{statuses[bet.status]}</td>
                <td>{points(bet.payout)}</td>
                <td>{bet.net === null ? '—' : points(bet.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.bets.length && <Empty>Вы ещё не сделали ни одной ставки.</Empty>}
      </div>
      <h2>Журнал операций</h2>
      <div className="item-list">
        {data.transactions.map((row) => (
          <div className="list-row" key={row.id}>
            <div>
              <strong>{operations[row.kind]}</strong>
              <p className="muted">
                {date(row.created_at)} {row.reason && `· ${row.reason}`}
              </p>
            </div>
            <div className="transaction-value">
              <strong className={row.amount > 0 ? 'success' : ''}>
                {row.amount > 0 ? '+' : ''}
                {points(row.amount)}
              </strong>
              <small>Баланс {points(row.balance_after)}</small>
            </div>
          </div>
        ))}
      </div>
      <Pagination
        page={page}
        setPage={setPage}
        total={data.transactions.length < 24 && data.bets.length < 24 ? page * 24 : undefined}
      />
    </>
  );
}
interface Leader {
  id: string;
  login: string;
  balance: number;
  active_seconds: number;
  net: number;
}
export function LeaderboardPage() {
  const [metric, setMetric] = useState('balance'),
    [page, setPage] = useState(1);
  const { data, error } = useResource<Page<Leader>>(`/leaderboard?metric=${metric}&page=${page}`);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">СООБЩЕСТВО</div>
          <h1>Таблица лидеров</h1>
          <p>У каждого свой путь к первому месту.</p>
        </div>
        <Trophy className="heading-icon" size={40} />
      </div>
      <div className="tabs">
        {[
          ['balance', 'По балансу'],
          ['activity', 'По активности'],
          ['bets', 'По результату ставок'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={metric === key ? 'active' : ''}
            onClick={() => {
              setMetric(key);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorBox message={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Место</th>
              <th>Пользователь</th>
              <th>Баланс</th>
              <th>Активность</th>
              <th>Результат ставок</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((user, index) => (
              <tr key={user.id}>
                <td>
                  <span className={page === 1 && index < 3 ? 'rank top' : 'rank'}>
                    {(page - 1) * 24 + index + 1}
                  </span>
                </td>
                <td>
                  <strong>{user.login}</strong>
                </td>
                <td>{points(user.balance)}</td>
                <td>{Math.floor(user.active_seconds / 60)} мин.</td>
                <td>{points(user.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        setPage={setPage}
        total={(data?.items.length ?? 0) < 24 ? page * 24 : undefined}
      />
    </>
  );
}
