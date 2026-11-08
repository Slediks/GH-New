import { useEffect, useState } from 'react';
import { api } from '../../shared/api';

type Field = number | boolean;
type Config = Record<string, Record<string, Field>>;
type Data = { version: number; config: Config; ranges: Record<string, [number, number]> };

const names: Record<string, string> = {
  frag: 'Frag · осколочная', smoke: 'Smoke · дымовая',
  flash: 'Flashbang · светошумовая', molotov: 'Molotov · огненная',
};
const labels: Record<string, string> = {
  enabled: 'Доступна игрокам', count: 'Выдавать за жизнь, шт.',
  force: 'Сила броска, м/с', fuse: 'Задержка взрыва, с',
  max_damage: 'Максимальный урон, HP', inner_radius: 'Радиус полного урона, м',
  radius: 'Радиус действия, м', restitution: 'Упругость отскока',
  friction: 'Сохранение скорости после отскока', activation: 'Задержка активации, с',
  lifetime: 'Длительность дыма, с', full_effect_distance: 'Дистанция полного эффекта, м',
  max_effect_distance: 'Максимальная дистанция эффекта, м',
  max_blind_duration: 'Максимальная слепота, с',
  max_fade_duration: 'Максимальное затухание, с',
  max_audio_duration: 'Максимальное ухудшение слуха, с',
  min_effect_threshold: 'Минимальный порог эффекта',
  affects_teammates: 'Действует на союзников',
  min_break_impact_speed: 'Скорость разбития, м/с',
  max_projectile_lifetime: 'Время полёта до разбития, с',
  spread_radius: 'Радиус распространения огня, м', patch_count: 'Число очагов, шт.',
  patch_radius: 'Радиус очага, м',
  max_patch_height_delta: 'Допустимый перепад высоты очагов, м',
  max_surface_slope: 'Допустимый уклон поверхности, °',
  fire_lifetime: 'Время горения, с', entry_damage: 'Урон при входе, HP',
  damage_per_tick: 'Урон за тик, HP', tick_interval: 'Интервал урона, с',
  max_stacked_fire_damage: 'Максимальный суммарный урон за тик, HP',
};
const hints: Record<string, string> = {
  count: 'Новая выдача применяется со следующего раунда или возрождения.',
  max_patch_height_delta: 'Наибольший перепад высоты между соседними очагами огня.',
  max_stacked_fire_damage: 'Ограничивает суммарный урон от нескольких одновременно действующих очагов.',
  min_effect_threshold: 'Эффект ниже этого порога не применяется.',
};

export function GrenadeAdmin() {
  const [saved, setSaved] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const value = await api<Data>('/arena/admin/grenades');
    setSaved(value);
    setDraft(structuredClone(value.config));
    setMessage('');
  }
  useEffect(() => { void load().catch((e) => setMessage(e.message)); }, []);
  if (!saved || !draft) return <p role="status">{message || 'Загрузка настроек гранат…'}</p>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.config);
  const change = (kind: string, key: string, value: Field) => {
    setDraft({ ...draft, [kind]: { ...draft[kind], [key]: value } });
    setMessage('');
  };
  async function apply(reset: boolean) {
    if (reset && !window.confirm('Сбросить настройки всех гранат по умолчанию?')) return;
    setBusy(true);
    try {
      const value = await api<Data>(`/arena/admin/grenades${reset ? '/reset' : ''}`, 'POST',
        reset ? { version: saved!.version } : { version: saved!.version, config: draft });
      setSaved({ ...saved!, ...value });
      setDraft(structuredClone(value.config));
      setMessage(reset ? 'Заводские настройки восстановлены.' : 'Настройки сохранены. Новые броски используют новую конфигурацию.');
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  return <form className="arena-grenade-admin" onSubmit={(e) => { e.preventDefault(); void apply(false); }}>
    <h3>Grenade Configuration · версия {saved.version}</h3>
    <p>Количество применяется при следующем раунде или возрождении. Уже брошенные гранаты и созданный огонь завершают действие со своими прежними параметрами.</p>
    {['frag', 'smoke', 'flash', 'molotov'].map((kind) => {
      const group = draft[kind];
      return <details key={kind} open={kind === 'frag'}>
      <summary>{names[kind] ?? kind} · {group.enabled ? `${group.count} шт.` : 'отключена'}</summary>
      <div className="arena-grenade-fields">
        {Object.entries(group).map(([key, value]) => <label key={key} title={hints[key]}>
          <span>{labels[key] ?? key}</span>
          {typeof value === 'boolean' ? <input type="checkbox" checked={value}
            onChange={(e) => change(kind, key, e.target.checked)} />
            : <input type="number" required min={saved.ranges[key]?.[0]} max={saved.ranges[key]?.[1]}
              step={['count', 'patch_count'].includes(key) ? 1 : 0.01} value={value}
              onChange={(e) => change(kind, key, e.target.value === '' ? NaN : Number(e.target.value))} />}
          {typeof value === 'number' && <small>{saved.ranges[key]?.join('–')}</small>}
          {hints[key] && <small>{hints[key]}</small>}
        </label>)}
      </div>
    </details>;
    })}
    {dirty && <p role="status">Есть несохранённые изменения.</p>}
    {message && <p role="status">{message}</p>}
    <div className="arena-actions">
      <button className="primary" disabled={busy || !dirty}>Сохранить изменения</button>
      <button type="button" disabled={busy} onClick={() => void load().catch((e) => setMessage(e.message))}>Обновить с сервера</button>
      <button type="button" disabled={busy} onClick={() => void apply(true)}>Сбросить по умолчанию</button>
    </div>
  </form>;
}
