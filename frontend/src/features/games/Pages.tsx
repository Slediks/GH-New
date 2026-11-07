import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Search,
  Play,
  Heart,
  Star,
  Maximize2,
  Gamepad2,
  Radio,
  Coins,
  Plus,
} from 'lucide-react';
import { api, date, phases } from '../../shared/api';
import { useResource } from '../../shared/hooks';
import { ErrorBox, Loading, Empty, Pagination } from '../../shared/UI';
import type { Category, FootballData, Game, Page } from '../../shared/types';
import { useActivity } from '../activity/useActivity';
import { megabytes, uploadError, type UploadLimits } from './uploads';

export function Catalog({ favorites = false }: { favorites?: boolean }) {
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [sort, setSort] = useState('new'),
    [page, setPage] = useState(1),
    [actionError, setActionError] = useState('');
  const { data, error, loading, reload } = useResource<Page<Game>>(
    `/games?q=${encodeURIComponent(query)}&category=${category}&sort=${sort}&page=${page}${favorites ? '&favorites=1' : ''}`,
  );
  const categories = useResource<Page<Category>>('/categories');
  const football = useResource<FootballData>('/football');
  const match = football.data?.matches[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ИГРОВАЯ БИБЛИОТЕКА</div>
          <h1>{favorites ? 'Ваше избранное' : 'Во что сыграем?'}</h1>
          <p>
            {favorites
              ? 'Игры, к которым хочется возвращаться.'
              : 'Небольшой перерыв. Большое удовольствие.'}
          </p>
        </div>
        <span className="count-badge">{data?.total ?? 0} игры</span>
      </div>
      {!favorites && (
        <div className="catalog-highlights">
          <Link to="/football" className="football-promo">
            <div>
              <span className="badge">
                <Radio size={14} />
                ФУТБОЛ · {match ? phases[match.state] : 'ОБЩИЙ ЭФИР'}
              </span>
              <h2>
                {match
                  ? `${match.teams[0].name} — ${match.teams[1].name}`
                  : 'Матч начинается здесь'}
              </h2>
              <p>Одна трансляция для всех. Выберите свою команду.</p>
              <span className="inline-link">
                На трибуны <ArrowRight size={18} />
              </span>
            </div>
            <div className="mini-score">
              {match?.score.join(' : ') ?? '5 × 5'}
              <small>ЛИГА GAMEHUB</small>
            </div>
          </Link>
          <div className="points-promo">
            <Coins size={28} />
            <h3>Играйте с пользой</h3>
            <p>Каждая минута активности приносит очки для футбольных ставок.</p>
            <Link to="/profile">
              Мой баланс <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      )}
      <div className="section-heading">
        <h2>{favorites ? 'Сохранённые игры' : 'Все игры'}</h2>
        <span className="muted">Запускаются прямо в браузере</span>
      </div>
      <div className="filters">
        <label className="search">
          <Search size={19} />
          <input
            aria-label="Поиск игр"
            value={query}
            placeholder="Найти игру…"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <select
          aria-label="Категория"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Все категории</option>
          {categories.data?.items.map((c) => (
            <option value={c.id} key={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Сортировка"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
        >
          <option value="new">Сначала новые</option>
          <option value="popular">По популярности</option>
          <option value="rating">По оценке</option>
        </select>
      </div>
      <ErrorBox message={error || actionError} />
      {loading ? (
        <Loading />
      ) : data?.items.length ? (
        <div className="game-grid">
          {data.items.map((game) => (
            <article className="game-card" key={game.id}>
              <Link to={`/games/${game.id}`} className="game-cover">
                <img src={game.cover} alt="" />
                <span className="cover-play">
                  <Play size={24} />
                </span>
                <span className="category-badge">{game.category}</span>
              </Link>
              <div className="game-card-content">
                <div className="card-title">
                  <Link to={`/games/${game.id}`}>
                    <h3>{game.title}</h3>
                  </Link>
                  <button
                    className={`icon-button ${game.favorite ? 'selected' : ''}`}
                    aria-label={game.favorite ? 'Убрать из избранного' : 'В избранное'}
                    onClick={async () => {
                      try {
                        await api(`/games/${game.id}/favorite`, 'PUT', {
                          favorite: !game.favorite,
                        });
                        await reload();
                      } catch (error) {
                        setActionError((error as Error).message);
                      }
                    }}
                  >
                    <Heart size={19} fill={game.favorite ? 'currentColor' : 'none'} />
                  </button>
                </div>
                <p>{game.description}</p>
                <div className="game-meta">
                  <span>
                    <Star size={14} />
                    {game.rating || '—'} <small>({game.rating_count})</small>
                  </span>
                  <span>
                    <Play size={13} />
                    {game.launches}
                  </span>
                  <span>{game.author}</span>
                </div>
                <Link className="button play-button" to={`/games/${game.id}`}>
                  <Play size={16} />
                  Играть
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty>
          <Gamepad2 />
          Игр пока нет. Попробуйте изменить фильтры.
        </Empty>
      )}
      <Pagination page={page} setPage={setPage} total={data?.total} />
    </>
  );
}

export function GamePage() {
  const { id } = useParams();
  const { data: game, error, reload } = useResource<Game>(`/games/${id}`);
  const [launch, setLaunch] = useState<{ url: string; session_id: string } | null>(null),
    [review, setReview] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null),
    container = useRef<HTMLDivElement>(null);
  const activity = useActivity(launch?.session_id ?? null);
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        !launch ||
        !event.data ||
        typeof event.data !== 'object' ||
        Array.isArray(event.data) ||
        Object.keys(event.data).length !== 2 ||
        typeof event.data.type !== 'string' ||
        typeof event.data.session !== 'string'
      )
        return;
      if (event.data.type === 'gamehub:input' && event.data.session === launch.session_id)
        activity.signal();
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [launch, activity]);
  if (!game) return error ? <ErrorBox message={error} /> : <Loading />;
  return (
    <>
      <Link className="back-link" to="/">
        ← Каталог игр
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {game.category} · {game.author}
          </div>
          <h1>{game.title}</h1>
          <p>{game.description}</p>
        </div>
        <span className="badge">
          <Star size={16} />
          {game.rating || 'Нет оценок'}
        </span>
      </div>
      <ErrorBox message={message} />
      <div className="game-container" ref={container}>
        {launch ? (
          <iframe
            ref={frame}
            src={launch.url}
            title={game.title}
            sandbox="allow-scripts"
            allow="fullscreen"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="game-start">
            <img src={game.cover} alt="" />
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setLaunch(await api(`/games/${id}/launch`, 'POST', {}));
                } catch (error) {
                  setMessage((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Play size={20} />
              {busy ? 'Запуск…' : 'Запустить игру'}
            </button>
          </div>
        )}
      </div>
      <div className="player-toolbar">
        <span className={activity.active ? 'activity-on' : 'muted'}>
          <Coins size={16} />
          {launch ? activity.reason : 'Игра готова к запуску'}
        </span>
        <button onClick={() => void container.current?.requestFullscreen()}>
          <Maximize2 size={16} />
          На весь экран
        </button>
      </div>
      <div className="detail-columns">
        <section className="panel">
          <h2>Об игре</h2>
          <p>{game.description}</p>
          <p className="muted">
            Добавлена {date(game.created_at)} · {game.launches} запусков
          </p>
          <div className="tags">
            {game.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <h3>Ваша оценка</h3>
          {!!game.versions?.length && (
            <details className="version-list">
              <summary>Версии игры ({game.versions.length})</summary>
              {game.versions.map((version, index) => (
                <p key={version.id}>
                  {index === 0 ? 'Текущая версия' : 'Предыдущая версия'} ·{' '}
                  {date(version.created_at)}
                  <br />
                  <small>{version.id}</small>
                </p>
              ))}
            </details>
          )}
          <div className="stars">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                aria-label={`Оценка ${value}`}
                onClick={async () => {
                  try {
                    await api(`/games/${id}/rating`, 'PUT', { value });
                    await reload();
                  } catch (error) {
                    setMessage((error as Error).message);
                  }
                }}
              >
                <Star fill={value <= (game.my_rating ?? 0) ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Отзывы</h2>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await api(`/games/${id}/review`, 'PUT', { text: review });
                setReview('');
                await reload();
              } catch (error) {
                setMessage((error as Error).message);
              }
            }}
          >
            <label>
              Ваш отзыв
              <textarea
                maxLength={2000}
                required
                value={review}
                placeholder="Поделитесь впечатлением…"
                onChange={(e) => setReview(e.target.value)}
              />
            </label>
            <button className="primary">Сохранить отзыв</button>
          </form>
          {game.reviews?.map((review) => (
            <div className="review" key={review.user_id}>
              <strong>{review.login}</strong>
              <p>{review.text}</p>
            </div>
          ))}
          {!game.reviews?.length && <p className="muted">Станьте первым, кто оставит отзыв.</p>}
        </section>
      </div>
    </>
  );
}

export function AuthorPage() {
  const limits = useResource<UploadLimits>('/games/upload-limits');
  const { data, reload, error } = useResource<Page<Game>>('/games?mine=1');
  const categories = useResource<Page<Category>>('/categories');
  const [editing, setEditing] = useState<Game | null>(null),
    [open, setOpen] = useState(false),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">МАСТЕРСКАЯ</div>
          <h1>Кабинет автора</h1>
          <p>Ваши игры, версии и публикации.</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus size={18} />
          Добавить игру
        </button>
      </div>
      <ErrorBox message={message || error || limits.error} />
      {open && (
        <section className="panel">
          <h2>{editing ? 'Редактирование игры' : 'Новая игра'}</h2>
          <form
            key={editing?.id ?? 'new'}
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              if (!limits.data) return;
              const invalid =
                uploadError(form.get('cover') as File | null, limits.data.cover_bytes, 'cover') ||
                uploadError(form.get('html') as File | null, limits.data.html_bytes, 'html');
              if (invalid) {
                setMessage(invalid);
                return;
              }
              setBusy(true);
              try {
                await api(
                  editing ? `/games/${editing.id}` : '/games',
                  editing ? 'PUT' : 'POST',
                  form,
                );
                setOpen(false);
                await reload();
                setMessage('');
              } catch (error) {
                setMessage((error as Error).message);
                void limits.reload();
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label>
                Название
                <input name="title" required maxLength={120} defaultValue={editing?.title} />
              </label>
              <label>
                Категория
                <select name="category_id" defaultValue={editing?.category_id}>
                  {categories.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wide">
                Описание
                <textarea
                  name="description"
                  required
                  maxLength={5000}
                  defaultValue={editing?.description}
                />
              </label>
              <label>
                Теги через запятую
                <input name="tags" defaultValue={editing?.tags.join(', ')} />
              </label>
              <label>
                Статус
                <select
                  name="status"
                  defaultValue={editing?.status === 'published' ? 'published' : 'draft'}
                >
                  <option value="draft">Черновик / снять с публикации</option>
                  <option value="published">Опубликовать</option>
                </select>
              </label>
              <label>
                HTML-файл {limits.data && `(до ${megabytes(limits.data.html_bytes)} МБ)`}
                <input type="file" name="html" accept=".html" />
              </label>
              <label>
                Обложка {limits.data && `(до ${megabytes(limits.data.cover_bytes)} МБ)`}
                <input
                  type="file"
                  name="cover"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={!limits.data}
                  onChange={(event) =>
                    setMessage(
                      uploadError(
                        event.target.files?.[0] ?? null,
                        limits.data!.cover_bytes,
                        'cover',
                      ),
                    )
                  }
                />
              </label>
            </div>
            <div className="actions">
              <button className="primary" disabled={busy || !limits.data}>
                {busy ? 'Сохраняем…' : 'Сохранить'}
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                Отмена
              </button>
            </div>
          </form>
        </section>
      )}
      <div className="item-list">
        {data?.items.map((game) => (
          <div className="list-row" key={game.id}>
            <div>
              <h3>{game.title}</h3>
              <span className="muted">
                {game.status === 'published'
                  ? 'Опубликована'
                  : game.status === 'hidden'
                    ? 'Скрыта администратором'
                    : 'Черновик'}{' '}
                · {game.launches} запусков
              </span>
            </div>
            <div className="actions">
              <Link className="button" to={`/games/${game.id}`}>
                Предпросмотр
              </Link>
              <button
                onClick={() => {
                  setEditing(game);
                  setOpen(true);
                }}
              >
                Изменить
              </button>
            </div>
          </div>
        ))}
      </div>
      {!data?.items.length && <Empty>Загрузите свою первую HTML-игру.</Empty>}
    </>
  );
}
