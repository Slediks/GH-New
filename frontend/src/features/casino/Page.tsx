import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Coins, Diamond, Volume2, VolumeX } from 'lucide-react';
import { useAuth } from '../../app/Auth';
import { api, points } from '../../shared/api';
import { useResource } from '../../shared/hooks';
import { ErrorBox, Loading } from '../../shared/UI';
import { Exchange } from './Exchange';
import { CasinoHistory } from './History';
import { CasinoDialog } from './CasinoDialog';
import { GameRoom } from './GameRoom';
import { PersonalWheel } from './fortune/PersonalWheel';
import { CommonRoom } from './CommonRoom';
import { DuelTables } from './DuelTables';
import { BoardTables, BOARD_GAMES } from './boards/BoardTables';
import { PokerTables } from './PokerTables';
import { PLAYER_RULES } from './playerRules';
import { CasinoChat } from './Chat';
import { FloatingChatProvider } from './FloatingChat';
import { GameArtwork } from './ArcadeScenes';
import { useBalancePresentation } from './slots/useBalancePresentation';
import { SLOT_DESCRIPTIONS } from './slots/model';
import type { CasinoGame, CasinoRound, CasinoWallet } from './types';
import './casino.css';

const categories = ['Все', 'Слоты', 'Карточные', 'Быстрые', 'Общие раунды', 'Против игроков'];
function category(id: string) {
  if (['dice', 'durak', 'holdem', ...BOARD_GAMES].includes(id)) return 'Против игроков';
  if (['roulette', 'crash', 'wheel', 'horses'].includes(id)) return 'Общие раунды';
  if (id.startsWith('slots_')) return 'Слоты';
  if (['blackjack', 'video_poker', 'higher_lower'].includes(id)) return 'Карточные';
  return 'Быстрые';
}
export function CasinoPage() {
  const { gameId } = useParams();
  const { refresh: refreshAuth } = useAuth();
  const wallet = useResource<CasinoWallet>('/casino/wallet');
  const balance = useBalancePresentation(wallet.data, wallet.reload);
  const games = useResource<{ items: CasinoGame[] }>('/casino/games');
  const [filter, setFilter] = useState('Все');
  const [exchange, setExchange] = useState<'deposit' | 'withdraw' | null>(null);
  const [history, setHistory] = useState(false);
  const [initial, setInitial] = useState<CasinoRound | null>(null);
  const [loadingRound, setLoadingRound] = useState(true);
  const [roundError, setRoundError] = useState('');
  const [sound, setSound] = useState(() => localStorage.getItem('casino-sound') === 'on');
  const refresh = useCallback(async () => {
    await wallet.reload();
    await refreshAuth();
  }, [wallet.reload, refreshAuth]);
  useEffect(() => {
    let alive = true;
    setLoadingRound(true);
    void api<{ items: CasinoRound[] }>('/casino/rounds')
      .then((result) => {
        if (alive) {
          setInitial(
            result.items.find((round) => round.status === 'active') ??
              result.items.find((round) => round.game === gameId) ??
              null,
          );
          setRoundError('');
        }
      })
      .catch((error: Error) => {
        if (alive) setRoundError(error.message);
      })
      .finally(() => {
        if (alive) setLoadingRound(false);
      });
    return () => {
      alive = false;
    };
  }, [gameId]);
  function toggleSound() {
    const enabled = !sound;
    setSound(enabled);
    localStorage.setItem('casino-sound', enabled ? 'on' : 'off');
    if (enabled) {
      // Local synthesized chime. Audio starts exclusively inside a user gesture.
      const context = new AudioContext();
      const oscillator = context.createOscillator(),
        gain = context.createGain();
      oscillator.frequency.value = 660;
      gain.gain.value = 0.05;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
      oscillator.stop(context.currentTime + 0.2);
      oscillator.onended = () => {
        void context.close();
      };
    }
  }
  if (!wallet.data || !games.data)
    return (
      <>
        <ErrorBox message={wallet.error || games.error} />
        {!wallet.error && !games.error && <Loading />}
      </>
    );
  const game = games.data.items.find((value) => value.id === gameId);
  const displayedWallet = balance.displayed ?? wallet.data;
  return (
    <FloatingChatProvider>
      <div className={`casino-page ${gameId ? 'casino-playing-page' : ''}`}>
        <div className="page-heading">
          <div>
            <div className="eyebrow">GAMEHUB · ТОЛЬКО ВИРТУАЛЬНАЯ ВАЛЮТА</div>
            <h1>
              <Diamond /> Казино
            </h1>
            <p>Шейкели для игры. Пополнение и вывод по разным курсам.</p>
          </div>
          <button
            className="icon-button"
            aria-label={sound ? 'Выключить звук' : 'Включить звук'}
            aria-pressed={sound}
            onClick={toggleSound}
          >
            {sound ? <Volume2 /> : <VolumeX />}
          </button>
        </div>
        <section className="panel casino-wallet">
          <div>
            <span>Шейкели</span>
            <strong>{points(displayedWallet.total)}</strong>
          </div>
          <div>
            <span>Доступно</span>
            <strong>{points(displayedWallet.available)}</strong>
          </div>
          <div>
            <span>В ставках / за столом</span>
            <strong>
              {points(displayedWallet.reserved)} / {points(displayedWallet.at_table)}
            </strong>
          </div>
          <div>
            <span>Очки GameHub</span>
            <strong>
              <Coins size={18} /> {points(displayedWallet.gamehub)}
            </strong>
          </div>
          <div className="actions">
            <button onClick={() => setExchange('deposit')}>Пополнить</button>
            <button onClick={() => setExchange('withdraw')}>Вывести</button>
            <button onClick={() => setHistory(!history)}>История</button>
          </div>
        </section>
        <p className="casino-rates">
          Пополнение: {wallet.data.rates.deposit.denominator} очков →{' '}
          {wallet.data.rates.deposit.numerator} шейкелей. Вывод:{' '}
          {wallet.data.rates.withdraw.denominator} шейкелей → {wallet.data.rates.withdraw.numerator}{' '}
          очков.
        </p>
        <ErrorBox message={wallet.error || games.error || roundError} />
        {exchange && (
          <Exchange
            key={exchange}
            wallet={displayedWallet}
            hideBalances={balance.hidden}
            direction={exchange}
            close={() => setExchange(null)}
            refresh={refresh}
          />
        )}
        {history && (
          <CasinoDialog label="История казино" close={() => setHistory(false)}>
            <button className="casino-history-close" onClick={() => setHistory(false)}>
              Закрыть историю
            </button>
            <CasinoHistory />
          </CasinoDialog>
        )}
        {wallet.data.active_game && wallet.data.active_game !== gameId && (
          <p className="panel">
            Есть незавершённая игра.{' '}
            <Link to={`/casino/${wallet.data.active_game}`}>Вернуться к игре →</Link>
          </p>
        )}
        {gameId ? (
          <>
            <p>
              <Link to="/casino">← Все игры казино</Link>
            </p>
            {gameId.startsWith('slots_') && (
              <div className="slot-mode-options">
                {games.data.items
                  .filter((item) => item.id.startsWith('slots_'))
                  .map((item) => (
                    <Link
                      className={`button ${gameId === item.id ? 'active' : ''}`}
                      key={item.id}
                      aria-label={item.rules.name}
                      to={`/casino/${item.id}`}
                    >
                      {item.rules.name}
                      <small>{SLOT_DESCRIPTIONS[item.id]}</small>
                    </Link>
                  ))}
              </div>
            )}
            {loadingRound ? (
              <Loading />
            ) : game ? (
              game.id === 'personal_wheel' ? (
                <PersonalWheel
                  key={game.id}
                  game={game}
                  initial={initial}
                  available={wallet.data.available}
                  refresh={refresh}
                  holdBalance={balance.begin}
                />
              ) : game.id === 'holdem' ? (
                <PokerTables
                  game={game}
                  refresh={refresh}
                  available={wallet.data.available}
                  active={!!wallet.data.active_session}
                />
              ) : BOARD_GAMES.includes(game.id) ? (
                <BoardTables
                  key={game.id}
                  game={game}
                  refresh={refresh}
                  holdBalance={balance.begin}
                  available={wallet.data.available}
                  active={!!wallet.data.active_session}
                />
              ) : game.multiplayer ? (
                <DuelTables
                  key={game.id}
                  game={game}
                  refresh={refresh}
                  available={wallet.data.available}
                  active={!!wallet.data.active_session}
                />
              ) : game.shared ? (
                <CommonRoom
                  key={game.id}
                  game={game}
                  refresh={refresh}
                  holdBalance={balance.begin}
                />
              ) : (
                <GameRoom
                  key={game.id}
                  game={game}
                  initial={initial}
                  refresh={refresh}
                  holdBalance={balance.begin}
                />
              )
            ) : (
              <ErrorBox message="Игра недоступна" />
            )}
          </>
        ) : (
          <>
            <div className="tabs">
              {categories.map((value) => (
                <button
                  key={value}
                  className={filter === value ? 'active' : ''}
                  onClick={() => setFilter(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            <div className="casino-catalog">
              {games.data.items
                .filter(
                  (game) =>
                    (!game.id.startsWith('slots_') || game.id === 'slots_classic') &&
                    (filter === 'Все' || category(game.id) === filter),
                )
                .map((game) => (
                  <Link className="panel casino-tile" to={`/casino/${game.id}`} key={game.id}>
                    <GameArtwork game={game.id} />
                    <small>
                      {category(game.id)} ·{' '}
                      {['holdem', 'durak'].includes(game.id)
                        ? '2–6 участников'
                        : game.multiplayer
                          ? '2 участника'
                          : game.shared
                            ? 'Общий раунд'
                            : '1 участник'}
                    </small>
                    <h2>{game.id === 'slots_classic' ? 'Слоты' : game.rules.name}</h2>
                    <p>
                      {game.id === 'slots_classic'
                        ? 'Шесть автоматов: линии, каскады, монеты, фиксация барабанов, горячая серия и сборка бонусного колеса.'
                        : (PLAYER_RULES[game.id]?.play ??
                          'Выберите игру и ознакомьтесь с действиями на поле.')}
                    </p>
                    <strong>{game.limits.enabled ? 'Играть →' : 'Новые ставки отключены'}</strong>
                  </Link>
                ))}
            </div>
          </>
        )}
        <CasinoChat />
      </div>
    </FloatingChatProvider>
  );
}
