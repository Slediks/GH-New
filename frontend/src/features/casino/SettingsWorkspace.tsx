import { useRef, useState } from 'react';
import { api, date, points } from '../../shared/api';
import { useResource } from '../../shared/hooks';
import { ErrorBox } from '../../shared/UI';
import { requestId, type CasinoGame } from './types';
import { Rules } from './Rules';
import './admin.css';

export interface CasinoConfig {
  board_turn_seconds: number;
  board_bot_multipliers: Record<string, number>;
  deposit: { numerator: number; denominator: number };
  withdraw: { numerator: number; denominator: number };
  commission_bps: number;
  chat_retention_days: number;
  games: Record<string, { enabled: boolean; minimum: number; maximum: number }>;
  math: {
    personal_wheel_sectors: number[];
    return_bps: Record<string, number>;
    penalty_defense: Record<string, number[]>;
  };
}
export const casinoNames: Record<string, string> = {
  chess: 'Шахматы',
  russian_checkers: 'Русские шашки',
  short_backgammon: 'Короткие нарды',
  long_backgammon: 'Длинные нарды',
  roulette: 'Рулетка',
  blackjack: 'Блэкджек',
  slots: 'Слоты',
  mines: 'Мины',
  plinko: 'Плинко',
  crash: 'Crash',
  holdem: 'Холдем',
  wheel: 'Колёса',
  personal_wheel: 'Личное колесо',
  dice: 'Кости',
  video_poker: 'Видеопокер',
  higher_lower: 'Выше / ниже',
  ladder: 'Лестница',
  durak: 'Дурак',
  target: 'Бросок на точность',
  penalty: 'Пенальти',
  horses: 'Скачки',
  slots_cascade: 'Каскадный слот',
  slots_hold: 'Золотой сейф',
  slots_lock: 'Липкие барабаны',
  slots_streak: 'Горячая серия',
  slots_wheel: 'Колесо удачи · слот',
};
interface Change {
  path: string;
  before: unknown;
  after: unknown;
}
interface Draft {
  id: string;
  base_version: number;
  revision: number;
  value: CasinoConfig;
  reason: string;
  applied_version: number | null;
  updated_at: number;
}
interface Preview {
  changes: Change[];
  exchange_steps: Record<string, number>;
  rules: Record<string, CasinoGame['rules']>;
}
const settingNames: Record<string, string> = {
  board_turn_seconds: 'Ход настольных игр (секунды)',
  board_bot_multipliers: 'Коэффициенты победы над ботом (сотые)',
  deposit: 'Пополнение',
  withdraw: 'Вывод',
  numerator: 'Получить',
  denominator: 'Отдать',
  games: 'Игры',
  minimum: 'Минимум (сотые шейкеля)',
  maximum: 'Максимум (сотые шейкеля)',
  enabled: 'Включена',
  commission_bps: 'Комиссия (сотые процента)',
  chat_retention_days: 'Хранение чата (дни)',
  math: 'Математика',
  return_bps: 'Отдача (сотые процента)',
  penalty_defense: 'Защита ворот (%)',
  low: 'Низкий риск',
  high: 'Высокий риск',
};
function formatted(value: unknown) {
  return typeof value === 'boolean'
    ? value
      ? 'Да'
      : 'Нет'
    : Array.isArray(value)
      ? value.join(' / ')
      : String(value);
}
export function ConfigChanges({ changes }: { changes: Change[] }) {
  return (
    <div className="casino-config-diff">
      {changes.length ? (
        changes.map((change) => (
          <div key={change.path}>
            <strong>
              {change.path
                .split('.')
                .map((key) => casinoNames[key] ?? settingNames[key] ?? key)
                .join(' › ')}
            </strong>
            <span>
              <del>{formatted(change.before)}</del> → <b>{formatted(change.after)}</b>
            </span>
          </div>
        ))
      ) : (
        <p>Изменений нет.</p>
      )}
    </div>
  );
}

export function SettingsWorkspace({
  initial,
  tableGames = [],
  version,
  section,
  reload,
}: {
  initial: CasinoConfig;
  tableGames?: string[];
  version: number;
  section: string;
  reload: () => Promise<void>;
}) {
  const [value, setValue] = useState<CasinoConfig>(() => structuredClone(initial));
  const [reason, setReason] = useState('');
  const [game, setGame] = useState('roulette');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const identity = useRef(requestId());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const drafts = useResource<{ items: Draft[] }>('/casino/admin/drafts');
  function change(next: CasinoConfig) {
    setValue(next);
    setPreview(null);
    setNotice('');
  }
  async function save(check: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setPreview(null);
    try {
      const saved = await api<Draft>('/casino/admin/drafts', 'POST', {
        id: identity.current,
        revision: draft?.revision ?? 0,
        base_version: draft?.base_version ?? version,
        value,
        reason,
      });
      setDraft(saved);
      await drafts.reload();
      if (check)
        setPreview(
          await api<Preview>('/casino/admin/settings/preview', 'POST', {
            value: saved.value,
            reason: saved.reason,
            base_version: saved.base_version,
          }),
        );
      setNotice(
        check
          ? 'Проверка пройдена. Просмотрите изменения перед применением.'
          : 'Черновик сохранён. Действующие правила не изменены.',
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function apply() {
    if (inFlight.current || !draft || !preview?.changes.length) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await api(`/casino/admin/drafts/${draft.id}/apply`, 'POST', { revision: draft.revision });
      await reload();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const number = (
    label: string,
    current: number,
    min: number,
    max: number,
    update: (n: number) => void,
  ) => (
    <label>
      {label}
      <input
        type="number"
        value={Number.isNaN(current) ? '' : current}
        min={min}
        max={max}
        step={1}
        required
        disabled={busy}
        onChange={(event) => update(event.target.value === '' ? NaN : Number(event.target.value))}
      />
      <small>
        {min.toLocaleString('ru')}–{max.toLocaleString('ru')}
      </small>
    </label>
  );
  const limits = value.games[game];
  return (
    <section className="panel casino-settings-workspace">
      <header>
        <div>
          <small>НАСТРОЙКИ КАЗИНО</small>
          <h3>Подготовка новой версии</h3>
        </div>
        <span className="casino-config-badge">Действует v{version}</span>
      </header>
      <p>
        Черновик не влияет на игроков. Применённая версия действует только для новых раундов;
        текущие ставки сохраняют прежние условия.
      </p>
      <ErrorBox message={error || drafts.error} />
      {notice && (
        <p role="status" className="success">
          {notice}
        </p>
      )}
      <details className="casino-draft-list">
        <summary>Мои сохранённые черновики</summary>
        {drafts.data?.items
          .filter((item) => !item.applied_version)
          .map((item) => (
            <button
              key={item.id}
              disabled={busy}
              onClick={() => {
                identity.current = item.id;
                setDraft(item);
                setValue(structuredClone(item.value));
                setReason(item.reason);
                setPreview(null);
                setNotice(`Загружена редакция ${item.revision}, основа v${item.base_version}`);
              }}
            >
              {item.reason} · v{item.base_version} · {date(item.updated_at)}
            </button>
          ))}
        <button
          disabled={busy}
          onClick={() => {
            identity.current = requestId();
            setDraft(null);
            setValue(structuredClone(initial));
            setReason('');
            setPreview(null);
            setNotice('Новый черновик из действующей версии.');
          }}
        >
          Новый черновик
        </button>
      </details>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(true);
        }}
      >
        <fieldset disabled={busy}>
          {section === 'exchange' && (
            <>
              <h3>Валюты и обмен</h3>
              <p>
                Числитель — сколько получить, знаменатель — сколько отдать. Курсы независимы и
                задаются точными дробями.
              </p>
              <div className="form-grid">
                {(['deposit', 'withdraw'] as const).map((direction) => (
                  <section key={direction}>
                    <h4>
                      {direction === 'deposit'
                        ? 'Очки GameHub → шейкели'
                        : 'Шейкели → очки GameHub'}
                    </h4>
                    {(['numerator', 'denominator'] as const).map((key) => (
                      <div key={key}>
                        {number(
                          key === 'numerator' ? 'Получить' : 'Отдать',
                          value[direction][key],
                          1,
                          1e9,
                          (n) =>
                            change({ ...value, [direction]: { ...value[direction], [key]: n } }),
                        )}
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            </>
          )}
          {section === 'games' && (
            <>
              <h3>Игры и ставки</h3>
              <label>
                Найти игру
                <input value={search} onChange={(event) => setSearch(event.target.value)} />
              </label>
              <div className="casino-setting-games">
                {Object.keys(value.games)
                  .filter((key) => casinoNames[key].toLowerCase().includes(search.toLowerCase()))
                  .map((key) => (
                    <button
                      type="button"
                      key={key}
                      aria-pressed={game === key}
                      onClick={() => setGame(key)}
                    >
                      {casinoNames[key]}
                    </button>
                  ))}
              </div>
              <h4>{casinoNames[game]}</h4>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={limits.enabled}
                  onChange={(event) =>
                    change({
                      ...value,
                      games: {
                        ...value.games,
                        [game]: { ...limits, enabled: event.target.checked },
                      },
                    })
                  }
                />
                Новые ставки разрешены
              </label>
              {tableGames.includes(game) ? (
                <p>
                  Стоимость входа настраивается отдельно для каждого стола в разделе «Игровые
                  столы». Общие минимальная и максимальная ставки здесь не применяются.
                </p>
              ) : (
                <div className="form-grid">
                  {number('Минимальная ставка, сотые шейкеля', limits.minimum, 1, 1e8, (n) =>
                    change({
                      ...value,
                      games: { ...value.games, [game]: { ...limits, minimum: n } },
                    }),
                  )}
                  {number(
                    'Максимальная ставка, сотые шейкеля',
                    limits.maximum,
                    limits.minimum || 1,
                    1e8,
                    (n) =>
                      change({
                        ...value,
                        games: { ...value.games, [game]: { ...limits, maximum: n } },
                      }),
                  )}
                </div>
              )}
              <p>
                100 единиц = 1 шейкель. Для слотов это базовая ставка, покупка бонуса стоит 100
                базовых ставок. В покере действуют ограничения выбранного стола. Отключение игры
                прекращает новые ставки, но сохраняет начатые раунды.
              </p>
            </>
          )}
          {section === 'rules' && (
            <>
              <h3>Правила и выплаты</h3>
              <p>
                Отдача до округления, в сотых процента: 9600 = 96%. Значение не является
                вероятностью отдельного выигрыша. Колоды, кубики и классические правила не
                изменяются.
              </p>
              <div className="form-grid">
                {Object.entries(value.math.return_bps).map(([key, rtp]) => (
                  <div key={key}>
                    {number(casinoNames[key], rtp, 5000, 9900, (n) =>
                      change({
                        ...value,
                        math: { ...value.math, return_bps: { ...value.math.return_bps, [key]: n } },
                      }),
                    )}
                  </div>
                ))}
              </div>
              <section>
                <h4>Личное колесо · 20 равных секторов</h4>
                <p>
                  10000 = ×1; 2500 = ×0,25. Порядок соответствует окружности. Соседние значения
                  должны различаться. Средний возврат:{' '}
                  {(
                    value.math.personal_wheel_sectors.reduce((sum, n) => sum + n, 0) / 2000
                  ).toLocaleString('ru-RU')}
                  % до округления.
                </p>
                <div className="form-grid">
                  {value.math.personal_wheel_sectors.map((coefficient, index) => (
                    <div key={index}>
                      {number(
                        `Сектор ${index + 1}, коэффициент / 10000`,
                        coefficient,
                        0,
                        100000,
                        (n) =>
                          change({
                            ...value,
                            math: {
                              ...value.math,
                              personal_wheel_sectors: value.math.personal_wheel_sectors.map(
                                (old, i) => (i === index ? n : old),
                              ),
                            },
                          }),
                      )}
                    </div>
                  ))}
                </div>
              </section>
              {Object.entries(value.math.penalty_defense).map(([risk, weights]) => (
                <section key={risk}>
                  <h4>
                    Пенальти · {risk === 'low' ? 'низкий' : 'высокий'} риск · сумма{' '}
                    {weights.reduce((sum, weight) => sum + weight, 0)}%
                  </h4>
                  <div className="form-grid">
                    {weights.map((weight, index) => (
                      <div key={index}>
                        {number(`Защита зоны ${index + 1}, %`, weight, 1, 80, (n) =>
                          change({
                            ...value,
                            math: {
                              ...value.math,
                              penalty_defense: {
                                ...value.math.penalty_defense,
                                [risk]: weights.map((old, i) => (i === index ? n : old)),
                              },
                            },
                          }),
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
          {section === 'limits' && (
            <>
              <h3>Комиссия и хранение</h3>
              <h4>Настольные игры против ботов</h4>
              <p>
                Коэффициенты включают взнос, без дополнительной комиссии. Диапазон ×1–×10; лёгкий
                &lt; средний &lt; сложный. Только для новых партий.
              </p>
              {Object.entries({ easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный' }).map(
                ([key, label]) => (
                  <div key={key}>
                    {number(
                      `${label}: сотые коэффициента (140 = ×1,4)`,
                      value.board_bot_multipliers?.[key] ?? NaN,
                      100,
                      1000,
                      (n) =>
                        change({
                          ...value,
                          board_bot_multipliers: { ...value.board_bot_multipliers, [key]: n },
                        }),
                    )}
                    <small>
                      На 100 шейкелей: выплата {value.board_bot_multipliers?.[key] ?? '—'} шейкелей
                    </small>
                  </div>
                ),
              )}
              {number(
                'Общий ход: шахматы, шашки и нарды, секунд',
                value.board_turn_seconds,
                15,
                300,
                (n) => change({ ...value, board_turn_seconds: n }),
              )}
              {number('Комиссия, сотые процента (500 = 5%)', value.commission_bps, 0, 10000, (n) =>
                change({ ...value, commission_bps: n }),
              )}
              <p>
                Дуэли: один раз с банка. Покер: без флопа комиссии нет; невостребованные ставки
                исключены. При отмене — возврат без комиссии.
              </p>
              {number('История чата, дней', value.chat_retention_days, 1, 3650, (n) =>
                change({ ...value, chat_retention_days: n }),
              )}
            </>
          )}
          <label>
            Причина изменения
            <input
              value={reason}
              required
              maxLength={1000}
              onChange={(event) => {
                setReason(event.target.value);
                setPreview(null);
              }}
            />
          </label>
        </fieldset>
        <div className="casino-settings-actions">
          <button type="button" disabled={busy || !reason.trim()} onClick={() => void save(false)}>
            Сохранить черновик
          </button>
          <button disabled={busy}>Проверить и показать изменения</button>
        </div>
      </form>
      {preview && (
        <section className="casino-config-preview">
          <h3>Предпросмотр · v{draft?.base_version} → новая версия</h3>
          <ConfigChanges changes={preview.changes} />
          <p>
            Минимальный шаг пополнения: {points(preview.exchange_steps.deposit)} очков. Вывода:{' '}
            {points(preview.exchange_steps.withdraw)} шейкелей.
          </p>
          <details>
            <summary>Расчётные правила и выплаты этой версии</summary>
            {Object.entries(preview.rules).map(([key, rule]) => (
              <Rules
                key={key}
                game={{
                  id: key,
                  rules: rule,
                  limits: value.games[key.startsWith('slots_') ? 'slots' : key],
                }}
              />
            ))}
          </details>
          <button disabled={busy || !preview.changes.length} onClick={() => void apply()}>
            Применить новую версию
          </button>
        </section>
      )}
    </section>
  );
}

export function ConfigAudit() {
  const [page, setPage] = useState(1);
  const audit = useResource<{
    items: {
      id: number;
      actor_id: string;
      action: string;
      details: Record<string, unknown>;
      created_at: number;
    }[];
  }>(`/casino/admin/audit?page=${page}`);
  const labels: Record<string, string> = {
    'casino.draft.saved': 'Сохранён черновик',
    'casino.config.applied': 'Применён черновик',
    'casino.config.version': 'Создана версия настроек',
    'casino.table': 'Изменён игровой стол',
  };
  return (
    <section className="panel">
      <h3>Аудит действий</h3>
      <ErrorBox message={audit.error} />
      {audit.data?.items.map((row) => (
        <article className="casino-version" key={row.id}>
          <strong>
            {labels[row.action] ?? row.action} · {date(row.created_at)}
          </strong>
          <p>Администратор: {row.actor_id}</p>
          <details>
            <summary>Подробности</summary>
            <pre className="casino-audit-details">{JSON.stringify(row.details, null, 2)}</pre>
          </details>
        </article>
      ))}
      <div className="actions">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Назад
        </button>
        <span>{page}</span>
        <button disabled={(audit.data?.items.length ?? 0) < 24} onClick={() => setPage(page + 1)}>
          Далее
        </button>
      </div>
    </section>
  );
}

export function ConfigVersions() {
  const [page, setPage] = useState(1);
  const versions = useResource<{
    items: { version: number; actor_id: string | null; reason: string; created_at: number }[];
  }>(`/casino/admin/versions?page=${page}`);
  const [from, setFrom] = useState('1'),
    [to, setTo] = useState('2');
  const [changes, setChanges] = useState<Change[] | null>(null),
    [error, setError] = useState('');
  return (
    <section className="panel">
      <h3>Версии настроек</h3>
      <ErrorBox message={error || versions.error} />
      <p>Применённые версии неизменяемы. Сравнение доступно по любым двум номерам.</p>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          void api<{ changes: Change[] }>(
            `/casino/admin/versions/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          )
            .then((result) => setChanges(result.changes))
            .catch((error) => setError(error.message));
        }}
      >
        <label>
          Из версии
          <input
            type="number"
            min={1}
            required
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          В версию
          <input
            type="number"
            min={1}
            required
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button>Сравнить</button>
      </form>
      {changes && <ConfigChanges changes={changes} />}
      {versions.data?.items.map((item) => (
        <article className="casino-version" key={item.version}>
          <strong>
            v{item.version} · {date(item.created_at)}
          </strong>
          <p>{item.reason}</p>
          <small>Автор: {item.actor_id ?? 'Начальная конфигурация'}</small>
        </article>
      ))}
      <div className="actions">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Назад
        </button>
        <span>{page}</span>
        <button
          disabled={(versions.data?.items.length ?? 0) < 24}
          onClick={() => setPage(page + 1)}
        >
          Далее
        </button>
      </div>
    </section>
  );
}
