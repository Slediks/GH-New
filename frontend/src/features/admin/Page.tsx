import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/Auth';
import { AdminUserCard } from './UserCard';
import { FootballAdmin } from '../football/Admin';
import { ArenaAdmin } from '../arena/Admin';
import { CasinoAdmin } from '../casino/Admin';
import { api, date, points } from '../../shared/api';
import { useResource } from '../../shared/hooks';
import { ErrorBox, Loading, Pagination } from '../../shared/UI';
import type { Category, Game, Page, Team, User } from '../../shared/types';

interface Overview {
  rules: Record<string, number | boolean>;
  metrics: Record<string, number>;
  teams: Team[];
  simulation: { phase?: string; match_id?: number; updated_at?: number; error?: string } | null;
  audit: { id: number; action: string; details: Record<string, unknown>; created_at: number }[];
}
const settingLabels: Record<string, string> = {
  activity_seconds: 'Секунд на начисление',
  activity_reward: 'Начисление, сотых очка',
  minimum_bet: 'Минимальная ставка, сотых',
  maximum_bet: 'Максимальная ставка, сотых',
  betting_seconds: 'Окно ставок, секунд',
  match_seconds: 'Длительность матча, секунд',
  max_substitutions: 'Лимит замен на команду',
  html_limit_mb: 'HTML, МБ',
  cover_limit_mb: 'Обложка, МБ',
};

export function AdminPage() {
  const { refresh } = useAuth();
  const { data, error, reload } = useResource<Overview>('/admin');
  const [tab, setTab] = useState('users'),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1),
    [message, setMessage] = useState(''),
    [success, setSuccess] = useState('');
  const users = useResource<Page<User>>(`/admin/users?q=${encodeURIComponent(query)}&page=${page}`);
  const games = useResource<Page<Game>>(`/admin/games?page=${page}`);
  const reviews = useResource<
    Page<{ game_id: string; user_id: string; text: string; hidden: boolean }>
  >(`/admin/reviews?page=${page}`);
  const categories = useResource<Page<Category>>('/categories');

  async function action(name: string, payload: unknown) {
    setMessage('');
    setSuccess('');
    try {
      await api(`/admin/${name}`, 'POST', payload);
      await Promise.all([
        reload(),
        users.reload(),
        games.reload(),
        reviews.reload(),
        categories.reload(),
      ]);
      setSuccess('Изменения сохранены');
      return true;
    } catch (error) {
      setMessage((error as Error).message);
      return false;
    }
  }
  if (!data) return error ? <ErrorBox message={error} /> : <Loading />;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">УПРАВЛЕНИЕ GAMEHUB</div>
          <h1>Панель администратора</h1>
          <p>Пользователи, контент, экономика и трансляция.</p>
        </div>
      </div>
      <ErrorBox message={message || error} />
      {success && (
        <p role="status" className="success">
          {success}
        </p>
      )}
      <div className="tabs">
        {[
          ['users', 'Пользователи'],
          ['content', 'Контент'],
          ['settings', 'Экономика'],
          ['teams', 'Команды'],
          ['simulation', 'Симулятор'],
          ['audit', 'Журнал'],
          ['casino', 'Казино'],
          ['arena', 'Арена'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'users' && (
        <>
          <input
            aria-label="Поиск пользователей"
            placeholder="Поиск по логину"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ErrorBox message={users.error} />
          {users.data?.items.map((user) => (
            <AdminUserCard
              key={user.id}
              user={user}
              action={action}
              onBalanceChanged={async () => {
                await Promise.all([users.reload(), reload(), refresh()]);
              }}
            />
          ))}
          <Pagination
            page={page}
            setPage={setPage}
            total={(users.data?.items.length ?? 0) < 24 ? page * 24 : undefined}
          />
        </>
      )}
      {tab === 'casino' && <CasinoAdmin />}
      {tab === 'arena' && <ArenaAdmin />}
      {tab === 'content' && (
        <>
          <section className="panel">
            <h2>Категории</h2>
            {categories.data?.items.map((category) => (
              <form
                className="inline-form"
                key={category.id}
                onSubmit={(event) => {
                  event.preventDefault();
                  void action('category', {
                    id: category.id,
                    name: new FormData(event.currentTarget).get('name'),
                  });
                }}
              >
                <input
                  aria-label="Название категории"
                  name="name"
                  defaultValue={category.name}
                  required
                />
                <button>Переименовать</button>
              </form>
            ))}
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                void action('category', { name: new FormData(event.currentTarget).get('name') });
              }}
            >
              <input
                aria-label="Новая категория"
                name="name"
                required
                placeholder="Новая категория"
              />
              <button>Добавить</button>
            </form>
          </section>
          <h2>Игры и авторы</h2>
          {games.data?.items.map((game) => (
            <div className="list-row" key={game.id}>
              <div>
                <Link to={`/games/${game.id}`}>
                  <strong>{game.title}</strong>
                </Link>
                <p className="muted">
                  {game.author} · {game.status}
                </p>
              </div>
              <button
                onClick={() =>
                  void action('game', { game_id: game.id, hidden: game.status !== 'hidden' })
                }
              >
                {game.status === 'hidden' ? 'Вернуть в черновики' : 'Скрыть'}
              </button>
            </div>
          ))}
          <h2>Отзывы</h2>
          {reviews.data?.items.map((review) => (
            <div className="list-row" key={review.game_id + review.user_id}>
              <p>{review.text}</p>
              <button
                onClick={() =>
                  void action('review', {
                    game_id: review.game_id,
                    user_id: review.user_id,
                    hidden: !review.hidden,
                  })
                }
              >
                {review.hidden ? 'Показать' : 'Скрыть'}
              </button>
            </div>
          ))}
          <Pagination page={page} setPage={setPage} />
        </>
      )}
      {tab === 'settings' && (
        <>
          <section className="panel">
            <h2>Правила экономики и матчей</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void action(
                  'settings',
                  Object.fromEntries(
                    Object.keys(settingLabels).map((key) => [key, Number(form.get(key))]),
                  ),
                );
              }}
            >
              <div className="form-grid">
                {Object.entries(settingLabels).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="number"
                      name={key}
                      defaultValue={Number(data.rules[key])}
                      required
                    />
                  </label>
                ))}
              </div>
              <p className="muted">
                Изменения футбольных правил применяются до открытия ставок. В открытом матче правила
                зафиксированы.
              </p>
              <button className="primary">Сохранить правила</button>
            </form>
          </section>
          <h2>Операции экономики, очки</h2>
          <div className="metrics">
            {Object.entries(data.metrics).map(([kind, amount]) => (
              <div className="panel" key={kind}>
                <span>
                  {(
                    {
                      welcome: 'Стартовые начисления',
                      activity: 'За активность',
                      bet: 'Списано на ставки',
                      payout: 'Выплаты',
                      refund: 'Возвраты',
                      adjustment: 'Корректировки',
                    } as Record<string, string>
                  )[kind] ?? kind}
                </span>
                <strong>{points(amount)}</strong>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === 'teams' && <FootballAdmin />}
      {tab === 'simulation' && (
        <section className="panel">
          <h2>Состояние трансляции</h2>
          <p>Фаза: {data.simulation?.phase ?? 'Нет свежего статуса'}</p>
          <p>Обновлено: {date(data.simulation?.updated_at ?? null)}</p>
          <ErrorBox message={data.simulation?.error ?? ''} />
          <div className="actions">
            <button onClick={() => void action('settings', { paused: !data.rules.paused })}>
              {data.rules.paused ? 'Возобновить новые матчи' : 'Приостановить после текущего матча'}
            </button>
            <button onClick={() => void reload()}>Обновить статус</button>
          </div>
          <form
            className="cancel-form"
            onSubmit={(event) => {
              event.preventDefault();
              void action('cancel', {
                match_id: Number(new FormData(event.currentTarget).get('match_id')),
              });
            }}
          >
            <h3>Техническая отмена с возвратом ставок</h3>
            <label>
              Номер матча
              <input
                type="number"
                name="match_id"
                min={1}
                required
                defaultValue={data.simulation?.match_id}
              />
            </label>
            <label className="checkbox">
              <input type="checkbox" required />
              Подтверждаю отмену матча и возврат ставок
            </label>
            <button className="danger">Отменить матч</button>
          </form>
        </section>
      )}
      {tab === 'audit' && (
        <div className="item-list">
          {data.audit.map((event) => (
            <div className="panel" key={event.id}>
              <strong>{event.action}</strong>
              <p className="muted">{date(event.created_at)}</p>
              <pre>{JSON.stringify(event.details, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
