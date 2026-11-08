import { TextLayout } from './TextLayout';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../shared/api';
import type { Asset, Vec3 } from '../editor/types';
import { fingerprint } from '../editor/definitionState';
import { AssetPreview, previewAsset } from './preview';
import type { AssetDefinition, AssetDraft, AssetRow } from './types';
import { AssetMaterials } from './Materials';
import { draftErrors } from './validation';
import './assets.css';
import { useAuth } from '../../../app/Auth';

const root = '/arena/assets-admin';
const categories = ['Base', 'Industrial', 'Military', 'Urban', 'Nature', 'Decoration', 'Other'];
export function AssetManager() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [custom, setCustom] = useState<AssetRow[]>([]),
    [system, setSystem] = useState<Asset[]>([]);
  const [current, setCurrent] = useState<AssetDraft | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''),
    [origin, setOrigin] = useState('custom'),
    [category, setCategory] = useState('Все');
  const [systemSelection, setSystemSelection] = useState<Asset | null>(null);
  const [published, setPublished] = useState<Asset[]>([]);
  const upload = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  async function load() {
    const [data, library] = await Promise.all([
      api<{ custom: AssetRow[]; system: Asset[] }>(root),
      api<{ assets: Asset[] }>('/arena/maps-admin/assets'),
    ]);
    setCustom(data.custom);
    setSystem(data.system.filter((a) => !a.internal && !a.deprecated));
    setPublished(library.assets);
  }
  useEffect(() => {
    void load().catch((e: Error) => setMessage(e.message));
  }, []);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await task();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const leave = () =>
    !dirty.current || window.confirm('Есть несохранённые изменения asset. Перейти без сохранения?');
  const rows = origin === 'custom' ? custom : system;
  return (
    <section className="asset-manager">
      <header>
        <small>ARENA / ASSETS</small>
        <h2>Модели и версии</h2>
        <p>
          GLB или самодостаточный GLTF · до 50 MiB · статические PBR-модели · все ресурсы локальные
        </p>
      </header>
      <p role="status">{message}</p>
      <div className="asset-manager-layout">
        <aside className="asset-list">
          <button
            disabled={busy}
            onClick={() => {
              if (leave()) upload.current?.click();
            }}
          >
            Создать Custom Asset
          </button>
          <input
            ref={upload}
            type="file"
            accept=".glb,.gltf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const data = new FormData();
              data.append('model', file);
              void run(async () => {
                const d = await api<AssetDraft>(root, 'POST', data);
                setCurrent(d);
                setSystemSelection(null);
                dirty.current = false;
                await load();
              });
            }}
          />
          <select
            aria-label="Происхождение asset"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
          >
            <option value="custom">Custom Assets</option>
            <option value="system">System Assets · read-only</option>
          </select>
          <input
            aria-label="Поиск assets"
            placeholder="Название, категория, tags…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Категория assets"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {['Все', ...new Set(rows.map((a) => a.category))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          {rows
            .filter(
              (a) =>
                (category === 'Все' || category === a.category) &&
                `${a.name} ${a.id} ${a.category} ${(a.tags ?? []).join(' ')}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
            )
            .map((a) => (
              <button
                key={a.id}
                disabled={busy}
                className={current?.id === a.id || systemSelection?.id === a.id ? 'active' : ''}
                onClick={() => {
                  if (!leave()) return;
                  void run(async () => {
                    dirty.current = false;
                    if (origin === 'system') {
                      setCurrent(null);
                      setSystemSelection(a as Asset);
                    } else if (!(a as AssetRow).editable) {
                      setCurrent(null);
                      setSystemSelection(published.find((asset) => asset.id === a.id && asset.version === (a as AssetRow).revision) ?? null);
                    } else {
                      setCurrent(await api<AssetDraft>(`${root}/${a.id}`));
                      setSystemSelection(null);
                    }
                  });
                }}
              >
                <strong>{a.name}</strong>
                <small>
                  {a.category} · {'status' in a ? `${a.status} · rev ${a.revision} · ${(a as AssetRow).ownerLogin ?? ''}` : 'System'}
                </small>
              </button>
            ))}
        </aside>
        {current ? (
          <AssetWorkbench
            key={current.id + ':' + current.draftVersion}
            initial={current}
            isAdmin={isAdmin}
            busy={busy}
            setDirty={(v) => {
              dirty.current = v;
            }}
            submit={(action, d) =>
              void run(async () => {
                const result = await api<AssetDraft>(`${root}/${current.id}/${action}`, 'POST', {
                  version: current.draftVersion,
                  definition: d,
                });
                setCurrent(result);
                dirty.current = false;
                await load();
                setMessage(
                  action === 'publish'
                    ? `Опубликована версия ${result.revision}. Старые карты сохранены.`
                    : 'Готово',
                );
              })
            }
            replace={(file) =>
              void run(async () => {
                const data = new FormData();
                data.append('model', file);
                data.append('version', String(current.draftVersion));
                setCurrent(await api<AssetDraft>(`${root}/${current.id}/replace`, 'POST', data));
                dirty.current = false;
                await load();
              })
            }
          />
        ) : systemSelection ? (
          <SystemPreview asset={systemSelection} />
        ) : (
          <div className="asset-empty">
            <h3>Добавьте свою модель</h3>
            <p>
              После публикации она появится в библиотеке редактора карт. Черновики и старые версии
              хранятся отдельно.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function SystemPreview({ asset }: { asset: Asset }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const p = new AssetPreview(host.current!, () => {});
    p.sync(asset, null, { visual: true, player: true, bullet: false, grid: true }, 'translate');
    const bounds = asset.colliders.length ? asset.colliders[0] : [0, 0, 0, 2, 2, 2];
    p.focus({
      ...asset,
      bounds: [
        [bounds[0] - bounds[3] / 2, bounds[1], bounds[2] - bounds[5] / 2],
        [bounds[0] + bounds[3] / 2, bounds[1] + bounds[4], bounds[2] + bounds[5] / 2],
      ],
    });
    return () => p.dispose();
  }, [asset]);
  return (
    <div>
      <h3>{asset.name} · {asset.origin === 'custom' ? 'Опубликованный источник' : 'System'} · только чтение</h3>
      <div className="asset-preview" ref={host} />
      <p>
        {asset.id} · v{asset.version} · {asset.colliders.length} коллайдеров
      </p>
    </div>
  );
}

function AssetWorkbench({
  initial,
  isAdmin,
  busy,
  setDirty,
  submit,
  replace,
}: {
  initial: AssetDraft;
  isAdmin: boolean;
  busy: boolean;
  setDirty: (v: boolean) => void;
  submit: (action: string, d: AssetDefinition) => void;
  replace: (file: File) => void;
}) {
  const [d, setD] = useState(initial.definition),
    [tab, setTab] = useState('metadata');
  const [textId, setTextId] = useState('');
  const [variants, setVariants] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<{ role: 'player' | 'bullet'; index: number } | null>(
    null,
  );
  const [show, setShow] = useState({ visual: true, player: true, bullet: false, grid: true }),
    [mode, setMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [history, setHistory] = useState<AssetDefinition[]>([]),
    [future, setFuture] = useState<AssetDefinition[]>([]);
  const [versions, setVersions] = useState<
    { revision: number; createdAt: number; createdBy: string; definition: Asset }[]
  >([]);
  const [compare, setCompare] = useState<number | null>(null),
    [thumbnail, setThumbnail] = useState(''),
    [loadError, setLoadError] = useState('');
  const host = useRef<HTMLDivElement>(null),
    preview = useRef<AssetPreview | null>(null),
    replaceInput = useRef<HTMLInputElement>(null);
  const change = (next: AssetDefinition) => {
    setHistory((h) => [...h.slice(-99), d]);
    setFuture([]);
    setD(next);
  };
  const live = useRef({ d, change });
  live.current = { d, change };
  const asset = useMemo(() => previewAsset(initial.asset, d), [initial.asset, d]);
  const dirty = fingerprint(d) !== fingerprint(initial.definition);
  const issues = draftErrors(d, asset);
  useEffect(() => {
    setDirty(dirty);
  }, [dirty, setDirty]);
  useEffect(() => {
    const p = new AssetPreview(host.current!, (role, index, box) => {
      const { d, change } = live.current;
      const boxes = d[role].boxes.map((b, i) => (i === index ? box : b));
      change({ ...d, [role]: { ...d[role], boxes } });
    });
    p.onTextLayout = (id, patch) => {
      const { d, change } = live.current;
      const slot = d.textSlots?.[id];
      if (slot) change({ ...d, textSlots: { ...d.textSlots, [id]: { ...slot, ...patch } } });
    };
    preview.current = p;
    p.focus(previewAsset(initial.asset, initial.definition));
    const error = (e: Event) => setLoadError((e as CustomEvent<string>).detail);
    window.addEventListener('arena-asset-error', error);
    return () => {
      window.removeEventListener('arena-asset-error', error);
      p.dispose();
      preview.current = null;
    };
  }, [initial.asset, initial.definition]);
  useEffect(() => {
    preview.current?.sync(
      asset,
      selected,
      show,
      mode,
      variants,
      tab === 'text' ? textId : undefined,
    );
  }, [asset, selected, show, mode, variants, tab, textId]);
  const undo = () => {
    if (!history.length) return;
    setFuture((f) => [d, ...f]);
    setD(history.at(-1)!);
    setHistory((h) => h.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setHistory((h) => [...h, d]);
    setD(future[0]);
    setFuture((f) => f.slice(1));
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches('input,textarea,select')) return;
      if (e.ctrlKey && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.ctrlKey && e.code === 'KeyY') {
        e.preventDefault();
        redo();
      }
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const leaving = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!dirty || !target.closest('a,button') || target.closest('.asset-manager')) return;
      if (!window.confirm('Есть несохранённые изменения asset. Покинуть без сохранения?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', leaving, true);
    window.addEventListener('keydown', key);
    window.addEventListener('beforeunload', unload);
    return () => {
      document.removeEventListener('click', leaving, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('beforeunload', unload);
    };
  });
  const dimensions = asset.bounds![1].map((v, i) => (v - asset.bounds![0][i]).toFixed(2));
  const fieldVector = (key: 'rotation' | 'scale' | 'offset') => (
    <label>
      {key} {key === 'rotation' ? '(°)' : key === 'offset' ? '(м)' : ''}
      <div className="asset-vector">
        {d.transform[key].map((value, i) => (
          <input
            aria-label={`${key} ${'XYZ'[i]}`}
            type="number"
            key={i}
            value={value}
            step={key === 'rotation' ? 90 : 0.01}
            onChange={(e) => {
              const vector = [...d.transform[key]] as Vec3;
              vector[i] = +e.target.value;
              change({ ...d, transform: { ...d.transform, [key]: vector } });
            }}
          />
        ))}
      </div>
    </label>
  );
  const download = (name: string, url: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  };
  return (
    <div className="asset-workbench">
      <div className="asset-toolbar">
        <strong>{d.name}</strong>
        <small>
          {initial.status} · rev {initial.revision} · {dirty ? 'Не сохранено' : 'Сохранено'}
        </small>
        <button disabled={busy || !history.length} onClick={undo}>
          ↶
        </button>
        <button disabled={busy || !future.length} onClick={redo}>
          ↷
        </button>
        <button disabled={busy} onClick={() => submit('save', d)}>
          Сохранить Draft
        </button>
        {isAdmin && <button disabled={busy || !!issues.length} onClick={() => submit('publish', d)}>
          Publish asset
        </button>}
        <button
          disabled={busy || dirty}
          title="Сначала сохраните изменения"
          onClick={() => submit('duplicate', d)}
        >
          Дублировать
        </button>
        {isAdmin && <button
          disabled={busy || dirty}
          onClick={() => submit(initial.status === 'Published' ? 'disable' : 'enable', d)}
        >
          {initial.status === 'Published' ? 'Отключить' : 'Включить'}
        </button>}
        {isAdmin && <button disabled={busy || dirty} onClick={() => submit('archive', d)}>
          Архивировать
        </button>}
        <button
          onClick={() =>
            download(
              'asset-draft.json',
              'data:application/json;charset=utf-8,' +
                encodeURIComponent(JSON.stringify(d, null, 2)),
            )
          }
        >
          Экспорт Draft
        </button>
      </div>
      <div role="status" className="asset-validation">
        {issues.length ? (
          issues.map((v) => <p key={v}>{v}</p>)
        ) : (
          <small>
            Конфигурация: {d.importInfo.warnings.length ? 'Warnings' : 'Valid'}. При публикации —
            повторная серверная проверка.
          </small>
        )}
        {d.importInfo.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
      </div>
      <div className="asset-workspace">
        <div className="asset-stage">
          <div className="asset-view-controls">
            {Object.keys(show).map((k) => (
              <label key={k} className="asset-check">
                <input
                  type="checkbox"
                  checked={show[k as keyof typeof show]}
                  onChange={(e) => setShow({ ...show, [k]: e.target.checked })}
                />
                {
                  {
                    visual: 'Модель',
                    player: 'Player collision',
                    bullet: 'Bullet collision',
                    grid: 'Сетка 1 м',
                  }[k]
                }
              </label>
            ))}
            <button onClick={() => preview.current?.focus(asset)}>Фокус / reset</button>
            <select
              aria-label="Gizmo"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="translate">Move</option>
              <option value="rotate">{tab === 'text' ? 'Rotate XYZ' : 'Rotate Y 90°'}</option>
              <option value="scale">Scale</option>
            </select>
          </div>
          <div className="asset-preview" ref={host} />
          <p>ЛКМ: orbit · ПКМ: pan · колесо: zoom · габариты {dimensions.join(' × ')} м</p>
          {loadError && <p role="alert">{loadError}</p>}
          <button onClick={() => setThumbnail(preview.current?.thumbnail() ?? '')}>
            Сделать thumbnail
          </button>
          {thumbnail && (
            <div>
              <img className="asset-thumbnail" src={thumbnail} alt="Предпросмотр asset" />
              <button onClick={() => download(`${initial.id}.png`, thumbnail)}>
                Скачать thumbnail
              </button>
            </div>
          )}
        </div>
        <aside className="asset-inspector">
          <select aria-label="Asset inspector" value={tab} onChange={(e) => setTab(e.target.value)}>
            {[
              ['metadata', 'Metadata'],
              ['transform', 'Transform'],
              ['collision', 'Collision'],
              ['materials', 'Materials / Overrides'],
              ['text', 'Текстовые области'],
              ['performance', 'Performance'],
              ['versions', 'Versions'],
            ].map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <fieldset disabled={busy}>
            {tab === 'metadata' && (
              <>
                <label>
                  Название
                  <input
                    maxLength={100}
                    value={d.name}
                    onChange={(e) => change({ ...d, name: e.target.value })}
                  />
                </label>
                <code>{initial.id}</code>
                <label>
                  Описание
                  <textarea
                    maxLength={1000}
                    value={d.description}
                    onChange={(e) => change({ ...d, description: e.target.value })}
                  />
                </label>
                <label>
                  Категория
                  <select
                    value={d.category}
                    onChange={(e) => change({ ...d, category: e.target.value })}
                  >
                    {categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Tags через запятую
                  <input
                    value={d.tags.join(', ')}
                    onChange={(e) =>
                      change({
                        ...d,
                        tags: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
                <button onClick={() => replaceInput.current?.click()}>
                  Заменить модель в Draft
                </button>
                <small>
                  Создаёт новую основу Draft и сбрасывает collision/materials. Опубликованные версии
                  сохраняются.
                </small>
                <input
                  ref={replaceInput}
                  hidden
                  type="file"
                  accept=".glb,.gltf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && window.confirm('Заменить модель и сбросить настройки текущего Draft?'))
                      replace(f);
                    e.target.value = '';
                  }}
                />
              </>
            )}
            {tab === 'transform' && (
              <>
                {fieldVector('scale')}
                {fieldVector('rotation')}
                <label>
                  Origin
                  <select
                    value={d.transform.pivot}
                    onChange={(e) =>
                      change({
                        ...d,
                        transform: {
                          ...d.transform,
                          pivot: e.target.value as typeof d.transform.pivot,
                        },
                      })
                    }
                  >
                    <option value="bottom">Bottom center</option>
                    <option value="center">Center</option>
                    <option value="custom">Исходный + offset</option>
                  </select>
                </label>
                {fieldVector('offset')}
                <p>
                  Нормализация применяется к модели. Custom colliders задаются в итоговых метрах;
                  Auto Bounds следует transform.
                </p>
                {(['castShadow', 'receiveShadow'] as const).map((k) => (
                  <label className="asset-check" key={k}>
                    <input
                      type="checkbox"
                      checked={d[k]}
                      onChange={(e) => change({ ...d, [k]: e.target.checked })}
                    />
                    {k}
                  </label>
                ))}
              </>
            )}
            {tab === 'collision' && (
              <>
                <p>
                  Боксы в локальных метрах asset. Y — нижняя грань. Поворот gizmo: только Y 90°,
                  совпадает с физикой Arena.
                </p>
                {(['player', 'bullet'] as const).map((role) => (
                  <details key={role} open>
                    <summary>{role === 'player' ? 'Player collision' : 'Bullet collision'}</summary>
                    <select
                      aria-label={`${role} collision mode`}
                      value={d[role].mode}
                      onChange={(e) => {
                        const mode = e.target.value;
                        setSelected(null);
                        const boxes = d[role].boxes.length ? d[role].boxes : [[0, 0, 0, 1, 1, 1]];
                        change({
                          ...d,
                          [role]: {
                            mode,
                            boxes:
                              mode === 'box' ? boxes.slice(0, 1) : mode === 'compound' ? boxes : [],
                          },
                        });
                      }}
                    >
                      <option value="none">None</option>
                      <option value="bounds">Auto Box / Asset Bounds</option>
                      <option value="box">Custom Box</option>
                      <option value="compound">Multiple Boxes</option>
                      {role === 'bullet' && <option value="same">Как Player</option>}
                    </select>
                    {['box', 'compound'].includes(d[role].mode) && (
                      <>
                        {d[role].boxes.map((box, index) => (
                          <div className="asset-collider" key={index}>
                            <button
                              className={
                                selected?.role === role && selected.index === index ? 'active' : ''
                              }
                              onClick={() => {
                                setSelected({ role, index });
                                setShow({ ...show, [role]: true });
                              }}
                            >
                              Box {index + 1} · gizmo
                            </button>
                            <div className="asset-box-fields">
                              {box.map((v, k) => (
                                <label key={k}>
                                  {['X', 'Bottom Y', 'Z', 'Width', 'Height', 'Depth'][k]}
                                  <input
                                    type="number"
                                    step={0.05}
                                    value={v}
                                    onChange={(e) => {
                                      const boxes = structuredClone(d[role].boxes);
                                      boxes[index][k] = +e.target.value;
                                      change({ ...d, [role]: { ...d[role], boxes } });
                                    }}
                                  />
                                </label>
                              ))}
                            </div>
                            <button
                              disabled={d[role].mode === 'box' || d[role].boxes.length >= 32}
                              onClick={() =>
                                change({
                                  ...d,
                                  [role]: {
                                    ...d[role],
                                    boxes: [...d[role].boxes, [box[0] + 1, ...box.slice(1)]],
                                  },
                                })
                              }
                            >
                              Копия
                            </button>
                            <button
                              onClick={() => {
                                setSelected(null);
                                change({
                                  ...d,
                                  [role]: {
                                    mode: d[role].boxes.length === 1 ? 'none' : d[role].mode,
                                    boxes: d[role].boxes.filter((_, i) => i !== index),
                                  },
                                });
                              }}
                            >
                              Удалить
                            </button>
                          </div>
                        ))}
                        <button
                          disabled={d[role].boxes.length >= 32 || d[role].mode === 'box'}
                          onClick={() =>
                            change({
                              ...d,
                              [role]: { ...d[role], boxes: [...d[role].boxes, [0, 0, 0, 1, 1, 1]] },
                            })
                          }
                        >
                          Добавить box
                        </button>
                      </>
                    )}
                  </details>
                ))}
              </>
            )}
            {tab === 'text' && (
              <TextLayout
                slots={d.textSlots ?? {}}
                change={(textSlots) => change({ ...d, textSlots })}
                selected={textId}
                select={setTextId}
              />
            )}
            {tab === 'materials' && (
              <AssetMaterials
                definition={d}
                change={change}
                selected={variants}
                select={(slot, variant) => setVariants({ ...variants, [slot]: variant })}
              />
            )}
            {tab === 'performance' && (
              <>
                <h3>{d.importInfo.warnings.length ? 'Warnings' : 'Valid import'}</h3>
                {d.importInfo.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
                <dl>
                  {Object.entries(d.importInfo.performance).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v.toLocaleString('ru-RU')}</dd>
                    </div>
                  ))}
                  <dt>Player / Bullet colliders</dt>
                  <dd>
                    {asset.colliders.length} / {asset.bulletColliders?.length}
                  </dd>
                </dl>
                <p>
                  Рекомендуемые текстуры: 1024–2048; максимум 4096. Публикация повторно проверяет
                  ресурс, материалы, transform и коллайдеры.
                </p>
              </>
            )}
            {tab === 'versions' && (
              <>
                <button
                  onClick={() =>
                    void api<{ revisions: typeof versions }>(`${root}/${initial.id}/revisions`)
                      .then((r) => setVersions(r.revisions))
                      .catch((e: Error) => setLoadError(e.message))
                  }
                >
                  Загрузить версии
                </button>
                {versions.map((v) => (
                  <button key={v.revision} onClick={() => setCompare(v.revision)}>
                    rev {v.revision} · {new Date(v.createdAt * 1000).toLocaleString('ru-RU')}
                  </button>
                ))}
                {compare !== null && (
                  <>
                    <p>
                      Сравнение rev {compare} с текущим Draft. Старые версии доступны только для
                      чтения.
                    </p>
                    <pre>
                      {JSON.stringify(
                        {
                          published: versions.find((v) => v.revision === compare)?.definition,
                          current: asset,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </>
                )}
              </>
            )}
          </fieldset>
        </aside>
      </div>
    </div>
  );
}
