import { useState } from 'react';
import { api } from '../../shared/api';
import { useResource } from '../../shared/hooks';
import { ErrorBox, Loading } from '../../shared/UI';
import type { Club, ClubsData, Footballer, RosterData } from './rosterTypes';
import './football.css';

// Presentation groups only; values, validation and persistence stay in PlayerForm.
const attributeGroups = [
  { title: 'Физика', keys: ['speed', 'acceleration', 'stamina', 'strength'] },
  { title: 'Техника', keys: ['control', 'dribbling', 'passing', 'shot_power', 'shot_accuracy'] },
  { title: 'Игра без мяча', keys: ['positioning', 'pressing', 'interceptions', 'tackling'] },
  { title: 'Ментальные', keys: ['vision', 'discipline'] },
  {
    title: 'Вратарские',
    keys: [
      'reaction',
      'keeper_positioning',
      'handling',
      'rushing',
      'saving',
      'distribution',
      'footwork',
    ],
  },
];

export function FootballAdmin() {
  const { data, error, reload } = useResource<ClubsData>('/football/clubs');
  const [clubId, setClubId] = useState(0);
  const [creating, setCreating] = useState(false);
  if (!data) return error ? <ErrorBox message={error} /> : <Loading />;
  const selected = clubId || data.clubs[0]?.id;
  return (
    <section className="panel football-admin">
      <h2>Клубы и футболисты</h2>
      <p className="muted">
        Изменения применяются к будущим составам. Уже открытые ставки и матчи сохраняют прежний
        состав.
      </p>
      <div className="football-club-picker">
        <label>
          Клуб
          <select value={selected} onChange={(e) => setClubId(Number(e.target.value))}>
            {data.clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {!c.active ? ' · неактивен' : ''}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setCreating((v) => !v)}>
          {creating ? 'Отмена добавления' : 'Добавить клуб'}
        </button>
      </div>
      {creating ? (
        <ClubForm
          club={{
            id: 0,
            name: '',
            short_name: '',
            color: '#218f64',
            secondary_color: '#ffffff',
            active: false,
            association: 'ENG',
            pot: 4,
            tactic: 'balanced',
            revision: 0,
          }}
          saved={async () => {
            setCreating(false);
            await reload();
          }}
        />
      ) : (
        selected && <ClubEditor key={selected} id={selected} catalog={data} onSaved={reload} />
      )}
    </section>
  );
}

function ClubEditor({
  id,
  catalog,
  onSaved,
}: {
  id: number;
  catalog: ClubsData;
  onSaved: () => Promise<void>;
}) {
  const { data, error, reload } = useResource<RosterData>(`/football/clubs/${id}`);
  const [editing, setEditing] = useState<Footballer | null>(null);
  if (!data) return error ? <ErrorBox message={error} /> : <Loading />;
  return (
    <>
      <ClubForm
        key={data.club.revision}
        club={data.club}
        saved={async () => {
          await reload();
          await onSaved();
        }}
      />
      <div className="football-squad-heading section-heading">
        <h3>Состав · {data.players.length}</h3>
        <button
          onClick={() =>
            setEditing({
              id: 0,
              team_id: id,
              name: '',
              short_name: '',
              number: 1,
              role: 'MF',
              positions: [],
              active: true,
              eligible: true,
              attributes: Object.fromEntries(Object.keys(catalog.attributes).map((k) => [k, 50])),
              revision: 0,
            })
          }
        >
          Добавить футболиста
        </button>
      </div>
      <div className="football-squad-workspace">
        <div className="football-roster-list" aria-label="Состав команды">
          {data.players.map((p) => (
            <button
              key={p.id}
              onClick={() => setEditing(p)}
              aria-pressed={editing?.id === p.id}
              className={!p.active || !p.eligible ? 'is-inactive' : undefined}
            >
              <b className="football-shirt-number">{p.number}</b>
              <span className="football-roster-name">
                <strong title={p.name}>{p.name}</strong>
                <small>
                  {p.role} ·{' '}
                  {p.suspended
                    ? `дисквалификация: ${p.suspended}`
                    : !p.active
                      ? 'неактивен'
                      : !p.eligible
                        ? 'не допущен'
                        : 'доступен'}
                </small>
              </span>
            </button>
          ))}
        </div>
        {editing ? (
          <PlayerForm
            key={`${editing.id}:${editing.revision}`}
            player={editing}
            catalog={catalog}
            close={() => setEditing(null)}
            saved={async () => {
              setEditing(null);
              await reload();
              await onSaved();
            }}
          />
        ) : (
          <div className="football-editor-empty">
            <span aria-hidden="true">№</span>
            <h3>Выберите футболиста</h3>
            <p>Состав слева, данные и характеристики — здесь.</p>
          </div>
        )}
      </div>
    </>
  );
}

function ClubForm({ club, saved }: { club: Club; saved: () => Promise<void> }) {
  const [value, setValue] = useState(club),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <details className="football-club-settings" open={club.id === 0 ? true : undefined}>
      <summary>
        <span>Настройки команды</span>
        <strong>{club.name || 'Новый клуб'}</strong>
        <span className="football-club-swatches" aria-hidden="true">
          <i style={{ background: value.color }} />
          <i style={{ background: value.secondary_color }} />
        </span>
      </summary>
      <form
        className="football-club-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api(
              club.id ? `/admin/football/clubs/${club.id}` : '/admin/football/clubs',
              'POST',
              value,
            );
            setMessage('Клуб сохранён');
            await saved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="football-form-grid">
          {(['name', 'short_name', 'association'] as const).map((key) => (
            <label key={key}>
              {
                {
                  name: 'Название',
                  short_name: 'Короткое название',
                  association: 'Ассоциация (ENG, ESP…)',
                }[key]
              }
              <input
                required
                maxLength={key === 'name' ? 100 : key === 'short_name' ? 30 : 3}
                value={value[key]}
                onChange={(e) => setValue({ ...value, [key]: e.target.value })}
              />
            </label>
          ))}
          {(['color', 'secondary_color'] as const).map((key) => (
            <label key={key}>
              {key === 'color' ? 'Основной цвет' : 'Дополнительный цвет'}
              <span className="football-color-control">
                <input
                  type="color"
                  value={value[key]}
                  onChange={(e) => setValue({ ...value, [key]: e.target.value })}
                />
                <code aria-hidden="true">{value[key]}</code>
              </span>
            </label>
          ))}
          <label>
            Корзина следующего сезона
            <input
              type="number"
              min={1}
              max={4}
              value={value.pot}
              onChange={(e) => setValue({ ...value, pot: Number(e.target.value) })}
            />
          </label>
          <label>
            Тактика
            <select
              value={value.tactic}
              onChange={(e) => setValue({ ...value, tactic: e.target.value })}
            >
              {Object.entries({
                balanced: 'Баланс',
                press: 'Прессинг',
                counter: 'Контратаки',
                possession: 'Владение',
                vertical: 'Вертикальная',
                wide: 'Фланги',
                compact: 'Компактная',
              }).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={value.active}
              onChange={(e) => setValue({ ...value, active: e.target.checked })}
            />{' '}
            Участник новых сезонов
          </label>
        </div>
        <ErrorBox message={error} />
        <p role="status">{message}</p>
        <button className="primary" disabled={busy}>
          Сохранить клуб
        </button>
      </form>
    </details>
  );
}

function PlayerForm({
  player,
  catalog,
  close,
  saved,
}: {
  player: Footballer;
  catalog: ClubsData;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [value, setValue] = useState(player),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="football-player-editor" role="region" aria-label="Редактирование футболиста">
      <form
        className="football-player-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api('/admin/football/players', 'POST', value);
            await saved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="section-heading football-editor-heading">
          <div>
            <span className="eyebrow">
              {player.id ? `ФУТБОЛИСТ · №${player.number} · ${player.role}` : 'ПОПОЛНЕНИЕ СОСТАВА'}
            </span>
            <h3 title={player.name}>{player.name || 'Новый футболист'}</h3>
          </div>
          <button type="button" onClick={close}>
            Закрыть
          </button>
        </div>
        <div className="football-editor-scroll">
          <ErrorBox message={error} />
          <h4>Данные игрока</h4>
          <div className="football-form-grid">
            <label>
              Полное имя
              <input
                autoFocus
                required
                maxLength={120}
                value={value.name}
                onChange={(e) => setValue({ ...value, name: e.target.value })}
              />
            </label>
            <label>
              Имя на поле
              <input
                required
                maxLength={40}
                value={value.short_name}
                onChange={(e) => setValue({ ...value, short_name: e.target.value })}
              />
            </label>
            <label>
              Клуб
              <select
                value={value.team_id}
                onChange={(e) => setValue({ ...value, team_id: Number(e.target.value) })}
              >
                {catalog.clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Номер
              <input
                required
                type="number"
                min={1}
                max={99}
                value={value.number}
                onChange={(e) => setValue({ ...value, number: Number(e.target.value) })}
              />
            </label>
            <label>
              Позиция
              <select
                value={value.role}
                onChange={(e) => setValue({ ...value, role: e.target.value })}
              >
                {catalog.positions.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>Дополнительные позиции</legend>
              {catalog.positions.map((p) => (
                <label key={p}>
                  <input
                    type="checkbox"
                    checked={value.positions.includes(p)}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        positions: e.target.checked
                          ? [...value.positions, p]
                          : value.positions.filter((x) => x !== p),
                      })
                    }
                  />
                  {p}
                </label>
              ))}
            </fieldset>
            <label>
              <input
                type="checkbox"
                checked={value.active}
                onChange={(e) => setValue({ ...value, active: e.target.checked })}
              />
              Активен
            </label>
            <label>
              <input
                type="checkbox"
                checked={value.eligible}
                onChange={(e) => setValue({ ...value, eligible: e.target.checked })}
              />
              Допущен к турниру
            </label>
          </div>
          <h4>
            Характеристики <span className="muted">· 0–100</span>
          </h4>
          <div className="football-attribute-groups">
            {[
              ...attributeGroups,
              {
                title: 'Другие характеристики',
                keys: Object.keys(catalog.attributes).filter(
                  (key) => !attributeGroups.some((group) => group.keys.includes(key)),
                ),
              },
            ]
              .filter((group) => group.keys.some((key) => key in catalog.attributes))
              .map((group) => (
                <section className="football-attribute-group" key={group.title}>
                  <h5>{group.title}</h5>
                  <div className="football-attribute-inputs">
                    {group.keys
                      .filter((key) => key in catalog.attributes)
                      .map((key) => (
                        <label key={key}>
                          {catalog.attributes[key]}
                          <input
                            required
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={value.attributes[key]}
                            onChange={(e) =>
                              setValue({
                                ...value,
                                attributes: { ...value.attributes, [key]: Number(e.target.value) },
                              })
                            }
                          />
                        </label>
                      ))}
                  </div>
                </section>
              ))}
          </div>
          <p className="muted">
            Деактивация сохраняет историю. Для перевода выберите другой клуб и свободный номер.
          </p>
        </div>
        <div className="football-editor-actions">
          <button className="primary" disabled={busy}>
            Сохранить футболиста
          </button>
        </div>
      </form>
    </div>
  );
}
