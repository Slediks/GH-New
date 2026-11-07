import { ArenaHistory } from './AdminHistory';
import './arena.css';
import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { modes } from './types';
import type { Mode } from './types';
const ArenaMaps = lazy(() => import('./editor/Maps').then((m) => ({ default: m.ArenaMaps })));
const ArenaAssets = lazy(() =>
  import('./assets/Manager').then((m) => ({ default: m.AssetManager })),
);
type Tree = { [key: string]: number | boolean | string | Tree };
type Values = Record<string, number | boolean>;
interface Config {
  enabled: boolean;
  common: Values;
  modes: Record<Mode, Values>;
  movement: Values;
  weapons: Record<string, Tree>;
}
interface Data {
  version: number;
  config: Config;
  schema: Record<string, Record<string, number[]>>;
}
const labels: Record<string, string> = {
  full_damage_distance: 'Полный урон до, м',
  falloff_end_distance: 'Конец снижения урона, м',
  minimum_damage_multiplier: 'Минимальная доля урона',
  scope_fov: 'Поле зрения оптики, °',
  health: 'Базовое здоровье, HP',
  reconnect: 'Окно переподключения, с',
  rounds: 'Побед для завершения',
  start_delay: 'Пауза перед раундом, с',
  end_delay: 'Пауза после раунда, с',
  kills: 'Лимит убийств по умолчанию',
  minutes: 'Время по умолчанию, мин',
  respawn: 'Возрождение, с',
  protection: 'Защита после появления, с',
  players: 'Максимум игроков в комнате',
  damage: 'Урон',
  head: 'Множитель headshot',
  interval: 'Интервал выстрелов, с',
  magazine: 'Патронов в магазине',
  reserve: 'Запас патронов',
  reload: 'Перезарядка, с',
  spread: 'Базовый разброс, рад',
  walk_speed: 'Скорость ходьбы, м/с',
  crouch_speed: 'Скорость приседа, м/с',
  acceleration: 'Ускорение, м/с²',
  deceleration: 'Торможение, м/с²',
  air_acceleration: 'Ускорение в воздухе, м/с²',
  jump_force: 'Импульс прыжка, м/с',
  gravity: 'Гравитация, м/с²',
  vertical: 'Вертикальная отдача, рад',
  horizontal: 'Горизонтальная отдача, рад',
  recovery: 'Скорость возврата',
  kick: 'Откат модели',
  accumulation: 'Накопление отдачи',
  cap: 'Предел накопления',
};
export function ArenaAdmin() {
  const [data, setData] = useState<Data | null>(null),
    [draft, setDraft] = useState<Config | null>(null),
    [tab, setTab] = useState('common'),
    [message, setMessage] = useState(''),
    [preview, setPreview] = useState(false);
  async function load() {
    try {
      const d = await api<Data>('/arena/admin');
      setData(d);
      setDraft(structuredClone(d.config));
      setPreview(false);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  if (!data || !draft) return <p>{message || 'Загрузка настроек Arena…'}</p>;
  const change = (path: string[], value: number | boolean) => {
    const next = structuredClone(draft);
    let group = next as unknown as Tree;
    for (const key of path.slice(0, -1)) group = group[key] as Tree;
    group[path.at(-1)!] = value;
    setDraft(next);
    setPreview(false);
  };
  const fields = (path: string[], schema: string) => {
    let group = draft as unknown as Tree;
    for (const key of path) group = group[key] as Tree;
    return (
      <div className="arena-admin-fields">
        {Object.entries(data.schema[schema])
          .filter(
            ([key]) =>
              (key !== 'scope_fov' || path[1] === 'sniper') &&
              (schema !== 'modes' ||
                (path[1] === 'elimination'
                  ? ['rounds', 'start_delay', 'end_delay', 'players'].includes(key)
                  : ['kills', 'minutes', 'respawn', 'protection', 'players'].includes(key))),
          )
          .map(([key, [min, max]]) => (
            <label key={key}>
              {labels[key] ?? key}
              <input
                required
                type="number"
                min={min}
                max={max}
                step={
                  [
                    'health',
                    'rounds',
                    'kills',
                    'minutes',
                    'players',
                    'damage',
                    'magazine',
                    'reserve',
                  ].includes(key)
                    ? 1
                    : 0.001
                }
                value={group[key] as number}
                onChange={(e) => change([...path, key], +e.target.value)}
              />
              <small>
                {min}–{max}
              </small>
            </label>
          ))}
      </div>
    );
  };
  const changes: string[] = [];
  const compare = (a: Tree, b: Tree, p = '') => {
    for (const k of Object.keys(a)) {
      if (a[k] && typeof a[k] === 'object') compare(a[k] as Tree, b[k] as Tree, p + k + '.');
      else if (a[k] !== b[k]) changes.push(`${p}${labels[k] ?? k}: ${b[k]} → ${a[k]}`);
    }
  };
  compare(draft as unknown as Tree, data.config as unknown as Tree);
  return (
    <section className="arena-admin">
      <h2>Управление Arena · версия {data.version}</h2>
      <p>
        Настройки фиксируются при старте матча. Открытые матчи сохраняют прежние параметры. Лимиты
        убийств, времени и раундов — значения по умолчанию для новых комнат.
      </p>
      <div className="tabs">
        {[
          'assets',
          'maps',
          'history',
          'common',
          'elimination',
          'tdm',
          'dm',
          'movement',
          'pistol',
          'rifle',
          'shotgun',
          'sniper',
        ].map((key) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {(
              {
                assets: 'Assets · Модели',
                maps: 'Maps · Карты',
                history: 'История матчей',
                common: 'Общие',
                movement: 'Движение',
                pistol: 'Пистолет',
                rifle: 'Винтовка',
                shotgun: 'Дробовик',
                sniper: 'Снайперская',
              } as Record<string, string>
            )[key] ?? modes[key as Mode]}
          </button>
        ))}
      </div>
      {tab === 'assets' ? (
        <Suspense fallback={<p>Загрузка Asset Manager…</p>}>
          <ArenaAssets />
        </Suspense>
      ) : tab === 'maps' ? (
        <Suspense fallback={<p>Загрузка редактора карт…</p>}>
          <ArenaMaps />
        </Suspense>
      ) : tab === 'history' ? (
        <ArenaHistory />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!preview) {
              setPreview(true);
              return;
            }
            try {
              const saved = await api<Data>('/arena/admin', 'POST', {
                version: data.version,
                config: draft,
              });
              setData({ ...data, ...saved });
              setPreview(false);
              setMessage('Новая версия сохранена. Изменение записано в аудит.');
            } catch (err) {
              setMessage((err as Error).message);
            }
          }}
        >
          {tab === 'common' && (
            <>
              <label className="arena-admin-toggle">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => change(['enabled'], e.target.checked)}
                />
                Arena включена для новых комнат и матчей
              </label>
              {fields(['common'], 'common')}
            </>
          )}
          {['elimination', 'tdm', 'dm'].includes(tab) && (
            <>
              <label className="arena-admin-toggle">
                <input
                  type="checkbox"
                  checked={!!draft.modes[tab as Mode].enabled}
                  onChange={(e) => change(['modes', tab, 'enabled'], e.target.checked)}
                />
                Режим включён
              </label>
              {fields(['modes', tab], 'modes')}
            </>
          )}
          {tab === 'movement' && fields(['movement'], 'movement')}
          {draft.weapons[tab] && (
            <>
              {fields(['weapons', tab], 'weapons')}
              <h3>Визуальная отдача</h3>
              {fields(['weapons', tab, 'recoil_profile'], 'recoil')}
            </>
          )}
          {preview && (
            <div>
              <h3>Предпросмотр новой версии</h3>
              {changes.map((c) => (
                <p key={c}>{c}</p>
              ))}
            </div>
          )}
          <p role="status">{message}</p>
          <button className="primary" disabled={!changes.length}>
            {preview ? 'Применить новую версию' : 'Проверить изменения'}
          </button>
          <button type="button" onClick={() => void load()}>
            Обновить с сервера
          </button>
        </form>
      )}
    </section>
  );
}
