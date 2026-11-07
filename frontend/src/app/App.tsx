import { lazy, Suspense, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import {
  Gamepad2,
  Sun,
  Moon,
  Coins,
  LogOut,
  Heart,
  Trophy,
  UserRound,
  Radio,
  History,
  Upload,
  Settings2,
} from 'lucide-react';
import { useAuth } from './Auth';
import { points } from '../shared/api';
import { ErrorBox, Loading } from '../shared/UI';
import { Catalog, GamePage, AuthorPage } from '../features/games/Pages';
import { FootballPage, HistoryPage, MatchPage } from '../features/football/Pages';
import { ProfilePage, LeaderboardPage } from '../features/wallet/Pages';
import { AdminPage } from '../features/admin/Page';
import { CasinoPage } from '../features/casino/Page';
const ArenaPage = lazy(() =>
  import('../features/arena/Page').then((m) => ({ default: m.ArenaPage })),
);

function ThemeButton() {
  const [theme, setTheme] = useState(() => localStorage.getItem('gamehub-theme') ?? 'dark');
  document.documentElement.dataset.theme = theme;
  return (
    <button
      className="icon-button"
      aria-label="Переключить тему"
      onClick={() => {
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        localStorage.setItem('gamehub-theme', next);
      }}
    >
      {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
    </button>
  );
}
function Login() {
  const { login, error: connectionError, refresh } = useAuth();
  const [name, setName] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <div className="login-toolbar">
        <Link className="brand" to="/">
          <span className="brand-icon">
            <Gamepad2 />
          </span>
          GameHub
        </Link>
        <ThemeButton />
      </div>
      <main className="login-card">
        <div className="eyebrow">ВАША ЛОКАЛЬНАЯ ИГРОВАЯ ПЛОЩАДКА</div>
        <h1>Время для игры.</h1>
        <p>Любимые игры и общий футбольный эфир — в одном месте.</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              await login(name);
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Ваш логин
            <input
              autoComplete="username"
              autoFocus
              maxLength={100}
              required
              placeholder="Введите логин"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <ErrorBox message={error || connectionError} />
          <button className="primary" disabled={busy || !!connectionError}>
            {busy ? 'Проверяем доступ…' : 'Войти в GameHub'}
            <span>→</span>
          </button>
        </form>
        {connectionError && <button onClick={() => void refresh()}>Повторить подключение</button>}
        <div className="login-note">
          <Coins size={19} />
          <span>
            100 приветственных очков при первом входе.
            <br />
            Очки виртуальные и не обмениваются на деньги.
          </span>
        </div>
      </main>
      <div className="login-footer">Играйте. Отдыхайте. Болейте за своих.</div>
    </div>
  );
}
export function App() {
  const { user, loading, error, logout } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Login />;
  return (
    <div className="shell">
      <header>
        <Link to="/" className="brand">
          <span className="brand-icon">
            <Gamepad2 />
          </span>
          GameHub
        </Link>
        <nav aria-label="Основная навигация">
          <NavLink to="/" end>
            <Gamepad2 size={18} />
            Игры
          </NavLink>
          <NavLink to="/football">
            <Radio size={18} />
            Футбол
            <span className="live-dot" />
          </NavLink>
          <NavLink to="/leaderboard">
            <Trophy size={18} />
            Рейтинг
          </NavLink>
          <NavLink to="/casino">
            <Coins size={18} />
            Казино
          </NavLink>
          <NavLink to="/arena">
            <Gamepad2 size={18} />
            Арена
          </NavLink>
        </nav>
        <div className="account">
          <Link className="balance" to="/profile">
            <Coins size={17} />
            {points(user.balance)}
            <small>очков</small>
          </Link>
          <ThemeButton />
          <Link className="user-link" to="/profile">
            <span className="avatar">{user.login.slice(0, 1).toUpperCase()}</span>
            <span>{user.login}</span>
          </Link>
          <button className="icon-button" aria-label="Выйти" onClick={() => void logout()}>
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <div className="subnav">
        <NavLink to="/favorites">
          <Heart size={16} />
          Избранное
        </NavLink>
        <NavLink to="/matches">
          <History size={16} />
          История матчей
        </NavLink>
        <NavLink to="/profile">
          <UserRound size={16} />
          Личный кабинет
        </NavLink>
        {user.role !== 'user' && (
          <NavLink to="/author">
            <Upload size={16} />
            Кабинет автора
          </NavLink>
        )}
        {user.role === 'admin' && (
          <NavLink to="/admin">
            <Settings2 size={16} />
            Управление
          </NavLink>
        )}
      </div>
      <main>
        <ErrorBox message={error} />
        <Routes>
          <Route path="/" element={<Catalog />} />
          <Route path="/favorites" element={<Catalog favorites />} />
          <Route path="/games/:id" element={<GamePage />} />
          <Route path="/football" element={<FootballPage />} />
          <Route
            path="/arena"
            element={
              <Suspense fallback={<Loading />}>
                <ArenaPage />
              </Suspense>
            }
          />
          <Route path="/casino" element={<CasinoPage />} />
          <Route path="/casino/:gameId" element={<CasinoPage />} />
          <Route path="/matches" element={<HistoryPage />} />
          <Route path="/matches/:id" element={<MatchPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route
            path="/author"
            element={
              user.role !== 'user' ? <AuthorPage /> : <ErrorBox message="Требуется право автора" />
            }
          />
          <Route
            path="/admin"
            element={
              user.role === 'admin' ? (
                <AdminPage />
              ) : (
                <ErrorBox message="Требуется право администратора" />
              )
            }
          />
          <Route
            path="*"
            element={
              <div className="empty">
                Страница не найдена. <Link to="/">Перейти к играм</Link>
              </div>
            }
          />
        </Routes>
      </main>
      <footer>
        <span className="brand">
          <Gamepad2 size={18} />
          GameHub
        </span>
        <span>Локальная сеть. Настоящий отдых.</span>
        <span>Только виртуальные очки</span>
      </footer>
    </div>
  );
}
