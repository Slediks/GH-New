import { useEffect, useState } from 'react';
import { Crosshair, Users, Shield, Swords, Plus, ArrowLeft } from 'lucide-react';
import { api } from '../../shared/api';
import { useAuth } from '../../app/Auth';
import { ErrorBox } from '../../shared/UI';
import { PlayerSettings, useArenaPreferences } from './PlayerSettings';
import { ArenaProfile } from './Profile';
import { MatchView } from './MatchView';
import { defaults, modes, type Config, type Manifest, type Room } from './types';
import './arena.css';
import { mapName } from './maps/names';

function Settings({
  value,
  onChange,
  policy,
  maps,
}: {
  value: Config;
  onChange: (value: Config) => void;
  policy?: Manifest['policy'];
  maps?: Manifest['maps'];
}) {
  return (
    <div className="arena-room-settings">
      <label>
        Карта
        <select
          value={value.map_id ?? 'depot_07'}
          onChange={(e) => onChange({ ...value, map_id: e.target.value })}
        >
          {(maps ?? [{ id: 'depot_07', name: 'Depot 07', enabled: true }]).map((map) => (
            <option key={map.id} value={map.id} disabled={!map.enabled}>
              {map.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Режим
        <select
          value={value.mode}
          onChange={(e) =>
            onChange({
              ...value,
              mode: e.target.value as Config['mode'],
              size: Math.min(
                e.target.value === 'dm' ? 6 : 3,
                (policy?.config.modes[e.target.value as Config['mode']].players ?? 10) /
                  (e.target.value === 'dm' ? 1 : 2),
              ),
              rounds: policy?.config.modes[e.target.value as Config['mode']].rounds ?? 5,
              kills: policy?.config.modes[e.target.value as Config['mode']].kills ?? 30,
              minutes: policy?.config.modes[e.target.value as Config['mode']].minutes ?? 8,
              full: false,
            })
          }
        >
          {Object.entries(modes).map(([id, name]) => (
            <option
              key={id}
              value={id}
              disabled={policy?.config.modes[id as Config['mode']].enabled === false}
            >
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {value.mode === 'dm' ? 'Число игроков' : 'Мест в каждой команде'}
        <select value={value.size} onChange={(e) => onChange({ ...value, size: +e.target.value })}>
          {Array.from(
            { length: value.mode === 'dm' ? 9 : 5 },
            (_, i) => i + (value.mode === 'dm' ? 2 : 1),
          ).map((n) => (
            <option key={n} value={n}>
              {value.mode === 'dm' ? n : `${n} × ${n}`}
            </option>
          ))}
        </select>
      </label>
      {value.mode !== 'dm' && (
        <label className="arena-checkbox">
          <input
            type="checkbox"
            checked={value.full}
            onChange={(e) => onChange({ ...value, full: e.target.checked })}
          />{' '}
          Требовать полные команды
        </label>
      )}
      {value.mode === 'elimination' ? (
        <label>
          Побед в раундах
          <input
            type="number"
            min="1"
            max="15"
            value={value.rounds}
            onChange={(e) => onChange({ ...value, rounds: +e.target.value })}
          />
        </label>
      ) : (
        <>
          <label>
            Лимит убийств
            <input
              type="number"
              min="5"
              max="100"
              value={value.kills}
              onChange={(e) => onChange({ ...value, kills: +e.target.value })}
            />
          </label>
          <label>
            Время, минут
            <input
              type="number"
              min="2"
              max="30"
              value={value.minutes}
              onChange={(e) => onChange({ ...value, minutes: +e.target.value })}
            />
          </label>
        </>
      )}
    </div>
  );
}

export function ArenaPage() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useArenaPreferences();
  const [rooms, setRooms] = useState<Room[]>([]),
    [room, setRoom] = useState<Room | null>(null),
    [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState(''),
    [online, setOnline] = useState(false),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [editing, setEditing] = useState(false);
  const [config, setConfig] = useState<Config>(defaults),
    [name, setName] = useState('Новая комната');
  const self = user!.id;
  const [returned, setReturned] = useState(false);
  useEffect(() => setReturned(false), [room?.match_id]);
  useEffect(() => {
    const failed = (event: Event) =>
      setError('Не удалось загрузить модель: ' + (event as CustomEvent<string>).detail);
    window.addEventListener('arena-asset-error', failed);
    return () => window.removeEventListener('arena-asset-error', failed);
  }, []);
  useEffect(() => {
    void api<Manifest>('/arena/manifest')
      .then(setManifest)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let cancelled = false;
    let refreshing = false;
    let snapshot: Room | undefined;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const data = await api<{ rooms: Room[]; online: boolean }>('/arena/rooms');
        if (cancelled) return;
        setRooms(data.rooms);
        setOnline(data.online);
        const mine = data.rooms.find((r) => r.players.some((p) => p.id === self));
        if (!mine || mine.status === 'lobby') {
          snapshot = undefined;
          setRoom(mine ?? null);
        } else {
          // One immutable scene per match. The list supplies current seats and status.
          if (!snapshot || snapshot.id !== mine.id || snapshot.match_id !== mine.match_id || snapshot.status !== mine.status) {
            snapshot = await api<Room>(`/arena/rooms/${mine.id}`);
          }
          if (!cancelled) setRoom({ ...mine, manifest: snapshot.manifest, result: snapshot.result });
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        refreshing = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [self]);
  useEffect(() => {
    if (!room) return;
    const timer = setInterval(() => {
      void api(`/arena/rooms/${room.id}/presence`, 'POST', {}).catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [room?.id]);
  async function act(action: string, data: unknown = {}, id = room?.id) {
    if (!id) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<Room>(`/arena/rooms/${id}/${action}`, 'POST', data);
      setRoom(action === 'leave' || action === 'close' ? null : r);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    setBusy(true);
    setError('');
    try {
      const r = await api<Room>('/arena/rooms', 'POST', { name, settings: config });
      setRoom(r);
      setCreating(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const counts = ['Alpha', 'Bravo'].map(
    (team) => room?.players.filter((p) => p.team === team).length ?? 0,
  );
  const startReason = !room
    ? ''
    : !online
      ? 'Сервер недоступен'
      : room.players.length < 2
        ? 'Нужны минимум два участника'
        : room.settings.mode !== 'dm' && Math.min(...counts) === 0
          ? 'Одна из команд пуста'
          : room.settings.full && counts.some((n) => n !== room.settings.size)
            ? `Ожидание игроков: Alpha ${counts[0]}/${room.settings.size}, Bravo ${counts[1]}/${room.settings.size}`
            : room.players.some((p) => !p.ready)
              ? 'Не все участники готовы'
              : '';
  const me = room?.players.find((p) => p.id === self);
  return (
    <div className="arena-page">
      <ErrorBox message={error} />
      {room && room.status !== 'lobby' && !returned && manifest ? (
        <MatchView
          key={room.match_id}
          room={room}
          manifest={manifest}
          self={self}
          debugAllowed={user?.role === 'admin'}
          prefs={prefs}
          setPrefs={setPrefs}
          leave={() => void act('leave')}
          lobby={() => (room.host_id === self ? void act('lobby') : setReturned(true))}
        />
      ) : (
        <>
          <section className="arena-hero">
            <div className="arena-hero-art">
              <Crosshair />
              <span>07</span>
            </div>
            <div className="eyebrow">GAMEHUB · MULTIPLAYER FPS</div>
            <h1>
              АРЕНА<span>DEPOT 07 / FOUNDRY</span>
            </h1>
            <p>
              Две карты. Три режима. Только живые соперники.
              <br />
              Соберите команду и решите исход матча точным выстрелом.
            </p>
            <div className="arena-badges">
              <span className={online ? 'online' : ''}>
                {online ? '● Сервер готов' : '○ Сервер недоступен'}
              </span>
              <span>2–10 игроков</span>
              <span>Без ставок и ботов</span>
            </div>
          </section>
          {manifest?.policy?.config.enabled === false && (
            <p role="status">Arena временно отключена для новых комнат и матчей.</p>
          )}
          {room ? (
            <section className="arena-lobby">
              <div className="arena-section-title">
                <div>
                  <div className="eyebrow">КОМНАТА · {modes[room.settings.mode]}</div>
                  <h2>{room.name}</h2>
                  <p>
                    Карта:{' '}
                    {room.mapName ??
                      manifest?.maps?.find((m) => m.id === room.settings.map_id)?.name ??
                      mapName(room.settings.map_id)}
                    {room.testRoom ? ' · Тестовая комната · только администраторы' : ''}
                  </p>
                </div>
                <button disabled={busy} onClick={() => void act('leave')}>
                  <ArrowLeft size={16} /> Покинуть
                </button>
              </div>
              <div className="arena-team-grid">
                {(room.settings.mode === 'dm' ? ['neutral'] : ['Alpha', 'Bravo']).map((team) => (
                  <div className={`arena-team ${team.toLowerCase()}`} key={team}>
                    <h3>
                      {team === 'neutral' ? 'Участники' : team}{' '}
                      <small>
                        {room.players.filter((p) => p.team === team).length} / {room.settings.size}
                      </small>
                    </h3>
                    {room.players
                      .filter((p) => p.team === team)
                      .map((p) => (
                        <div className="arena-member" key={p.id}>
                          <span>
                            {p.name}
                            {p.id === room.host_id ? ' · владелец ♛' : ''}
                            {p.id === self ? ' · вы' : ''}
                          </span>
                          <b className={p.ready ? 'ready' : ''}>{p.ready ? 'Готов' : 'Не готов'}</b>
                        </div>
                      ))}
                    {room.settings.mode !== 'dm' && me?.team !== team && (
                      <button
                        disabled={busy || room.status === 'finished'}
                        onClick={() => void act('team', { team })}
                      >
                        Перейти в {team}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="arena-lobby-note">
                {room.settings.mode === 'elimination'
                  ? `Одна жизнь за раунд · до ${room.settings.rounds} побед · 120 с на раунд`
                  : `До ${room.settings.kills} убийств · ${room.settings.minutes} минут`}
                <br />
                {room.settings.full
                  ? 'Старт только с полными командами.'
                  : 'Неполные составы разрешены.'}{' '}
                Все участники должны подтвердить готовность.
              </div>
              {room.status === 'finished' && (
                <p>Матч завершён. Владелец комнаты должен открыть подготовку следующего матча.</p>
              )}
              {startReason && <p role="status">{startReason}</p>}
              {room.settings.mode !== 'dm' &&
                counts[0] !== counts[1] &&
                Math.min(...counts) > 0 && (
                  <p>
                    Команды неравные: {counts[0]} против {counts[1]}. Неполный старт разрешён, если
                    не требуется полный состав.
                  </p>
                )}
              <div className="arena-actions">
                <button
                  className="primary"
                  disabled={busy || room.status === 'finished'}
                  onClick={() => void act('ready', { ready: !me?.ready })}
                >
                  {me?.ready ? 'Отменить готовность' : 'Я готов'}
                </button>
                {room.host_id === self && (
                  <>
                    <button disabled={busy || !!startReason} onClick={() => void act('start')}>
                      Начать матч
                    </button>
                    <button
                      disabled={busy || room.testRoom}
                      onClick={() => {
                        setConfig(room.settings);
                        setEditing(!editing);
                      }}
                    >
                      Настройки комнаты
                    </button>
                    <button disabled={busy} onClick={() => void act('close')}>
                      Закрыть комнату
                    </button>
                  </>
                )}
              </div>
              {editing && (
                <form
                  className="arena-edit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act('settings', config);
                  }}
                >
                  <Settings
                    value={config}
                    onChange={setConfig}
                    policy={manifest?.policy}
                    maps={manifest?.maps}
                  />
                  <p>
                    Изменение настроек сбросит готовность и распределит участников по командам
                    заново.
                  </p>
                  <button className="primary" disabled={busy}>
                    Применить настройки
                  </button>
                </form>
              )}
            </section>
          ) : (
            <>
              <div className="arena-mode-cards">
                {(
                  [
                    {
                      id: 'elimination',
                      icon: Shield,
                      text: 'Одна жизнь. Прикрытие союзников. Победа по раундам.',
                    },
                    {
                      id: 'tdm',
                      icon: Users,
                      text: 'Командная гонка убийств с быстрым возвращением в бой.',
                    },
                    {
                      id: 'dm',
                      icon: Swords,
                      text: 'Каждый за себя. Первое место достанется самому точному.',
                    },
                  ] as const
                ).map((m) => (
                  <article key={m.id}>
                    <m.icon size={26} />
                    <h3>{modes[m.id]}</h3>
                    <p>{m.text}</p>
                  </article>
                ))}
              </div>
              <section className="arena-rooms">
                <div className="arena-section-title">
                  <h2>
                    Открытые комнаты <small>{rooms.length}</small>
                  </h2>
                  <button
                    className="primary"
                    onClick={() => {
                      const policy = manifest?.policy;
                      const mode =
                        (Object.keys(modes) as Config['mode'][]).find(
                          (m) => policy?.config.modes[m].enabled !== false,
                        ) ?? 'elimination';
                      const selected = policy?.config.modes[mode];
                      setConfig({
                        ...defaults,
                        mode,
                        size: Math.min(
                          mode === 'dm' ? 6 : 3,
                          (selected?.players ?? 10) / (mode === 'dm' ? 1 : 2),
                        ),
                        rounds: selected?.rounds ?? 5,
                        kills: selected?.kills ?? 30,
                        minutes: selected?.minutes ?? 8,
                      });
                      setCreating(!creating);
                    }}
                    disabled={
                      !online ||
                      manifest?.policy?.config.enabled === false ||
                      (manifest?.policy !== undefined &&
                        !Object.values(manifest.policy.config.modes).some((mode) => mode.enabled))
                    }
                  >
                    <Plus size={18} /> Создать комнату
                  </button>
                </div>
                {creating && (
                  <form
                    className="arena-create"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void create();
                    }}
                  >
                    <label>
                      Название
                      <input
                        maxLength={60}
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <Settings
                      value={config}
                      onChange={setConfig}
                      policy={manifest?.policy}
                      maps={manifest?.maps}
                    />
                    <div className="arena-actions">
                      <button className="primary" disabled={busy}>
                        Открыть комнату
                      </button>
                      <button type="button" onClick={() => setCreating(false)}>
                        Отмена
                      </button>
                    </div>
                  </form>
                )}
                {rooms.length === 0 ? (
                  <div className="arena-empty">
                    <Crosshair size={42} />
                    <h3>Арена ждёт участников</h3>
                    <p>
                      Создайте комнату и пригласите другого пользователя GameHub. Матч начнётся
                      после подтверждения готовности.
                    </p>
                  </div>
                ) : (
                  rooms.map((r) => (
                    <div className="arena-room-row" key={r.id}>
                      <span>
                        <b>{r.name}</b>
                        <small>
                          {modes[r.settings.mode]} · {mapName(r.settings.map_id)}
                        </small>
                      </span>
                      <span>
                        <Users size={16} /> {r.players.length} /{' '}
                        {r.settings.size * (r.settings.mode === 'dm' ? 1 : 2)}
                      </span>
                      <span>{r.status === 'lobby' ? 'Сбор участников' : 'Матч идёт'}</span>
                      <button
                        disabled={busy || r.status !== 'lobby'}
                        onClick={() => void act('join', {}, r.id)}
                      >
                        Присоединиться
                      </button>
                    </div>
                  ))
                )}
              </section>
            </>
          )}
          <div className="arena-secondary">
            <PlayerSettings value={prefs} onChange={setPrefs} />
            <ArenaProfile />
          </div>
        </>
      )}
    </div>
  );
}
