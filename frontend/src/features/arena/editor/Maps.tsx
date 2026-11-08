import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import type { Asset, Draft, MapRow } from './types';
import { assetRegistry } from './types';
import { MapEditor } from './Editor';
import './editor.css';
import { useAuth } from '../../../app/Auth';
export function ArenaMaps() {
  const { user } = useAuth();
  const [maps, setMaps] = useState<MapRow[]>([]),
    [sources, setSources] = useState<MapRow[]>([]),
    [assets, setAssets] = useState<Record<string, Asset>>({}),
    [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState(''),
    [source, setSource] = useState(''),
    [name, setName] = useState(''),
    [id, setId] = useState(''),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      const [m, a, s] = await Promise.all([
        api<{ maps: MapRow[] }>('/arena/maps-admin'),
        api<{ assets: Asset[] }>('/arena/maps-admin/assets'),
        api<{ maps: MapRow[] }>('/arena/maps-admin/sources'),
      ]);
      setMaps(m.maps);
      setSources(s.maps);
      setAssets(assetRegistry(a.assets));
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
      setMessage('');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (draft)
    return (
      <MapEditor
        key={draft.id}
        initial={draft}
        assets={assets}
        onClose={() => {
          setDraft(null);
          void load();
        }}
      />
    );
  const groups: [string, MapRow[]][] = user?.role === 'admin' ? [['Все карты', maps]] : [
    ['Мои карты', maps.filter((map) => map.accessRole === 'owner')],
    ['Доступные мне', maps.filter((map) => map.accessRole === 'editor')],
  ];
  return (
    <section className="arena-maps">
      <header>
        <small>ARENA / MAPS</small>
        <h2>Карты и версии</h2>
        <p>
          Свои карты и карты с доступом редактора можно менять совместно. Публикация доступна администратору;
          начатые матчи сохраняют свою версию.
        </p>
      </header>
      <form
        className="map-create"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const d = await api<Draft>('/arena/maps-admin', 'POST', {
              id,
              name,
              source: source || undefined,
            });
            setDraft(d);
          });
        }}
      >
        <label>
          Название
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          ID карты
          <input
            required
            pattern="[a-z][a-z0-9_-]{2,47}"
            title="3–48 латинских букв, цифр, _ или -, первая — буква"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <label>
          Основа
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Пустая карта</option>
            {sources.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy || !Object.keys(assets).length}>Создать карту</button>
      </form>
      {sources.find((m) => m.id === source)?.system && (
        <p>
          Копия системной карты переносит игровые препятствия и старты в редактируемые блоки.
          Авторское декоративное оформление оригинала остаётся в оригинальной карте.
        </p>
      )}
      <p role="status">{message}</p>
      {groups.map(([title, rows]) => <section key={title}>
        <h3>{title} · {rows.length}</h3>
        <div className="map-list">{rows.map((m) => (
          <article key={m.id}>
            <div>
              <h3>{m.name}</h3>
              <code>{m.id}</code>
              <p>
                {m.status} · rev {m.revision}
                {m.system ? ' · системная карта' : ''}
                {' · Владелец: ' + m.ownerLogin + ' · ' + ({admin: 'Администратор', owner: 'Владелец', editor: 'Редактор', viewer: 'Просмотр'}[m.accessRole])}
              </p>
              <small>
                {m.updatedAt ? new Date(m.updatedAt * 1000).toLocaleString() : ''} {m.updatedBy}
              </small>
            </div>
            <div className="map-row-actions">
              {!m.system && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => setDraft(await api<Draft>(`/arena/maps-admin/${m.id}`)))
                  }
                >
                  Редактировать черновик
                </button>
              )}
              <button
                onClick={() => {
                  setSource(m.id);
                  setName(m.name + ' — копия');
                  setId(m.id + '-copy');
                }}
              >
                Дублировать
              </button>
              {!m.system && m.status !== 'Published' && (m.accessRole === 'admin' || (m.accessRole === 'owner' && !m.revision)) && (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Удалить карту «${m.name}» полностью, включая черновик и опубликованные версии?`)) return;
                    void run(async () => {
                      await api(`/arena/maps-admin/${m.id}/delete`, 'POST', {
                        version: m.draftVersion,
                      });
                      await load();
                    });
                  }}
                >
                  {m.revision ? 'Удалить карту' : 'Удалить черновик'}
                </button>
              )}
            </div>
          </article>
        ))}</div>
      </section>)}
    </section>
  );
}
