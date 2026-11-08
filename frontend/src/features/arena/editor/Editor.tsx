import { GeometryReadout } from './debug/GeometryReadout';
import { PrefabEditor } from './PrefabEditor';
import { DebugPanel } from './debug/DebugPanel';
import type { Preview } from './debug/types';
import { SelectionTools, SceneTree } from './SceneTree';
import { MultiInspector } from './MultiInspector';
import { useScene } from './useScene';
import { uniqueName } from './sceneSelection';
import { preference, type Settings } from './placement';
import { assetFor } from './types';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as T from 'three';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../../shared/api';
import type { Asset, Definition, Draft, MapObject, PrefabInstance, PrefabRow, Report } from './types';
import { MapViewport } from './viewport';
import { Inspector } from './Inspector';
import { Appearance } from './Appearance';
import { fingerprint } from './definitionState';
import { useAuth } from '../../../app/Auth';
import { MapAccess } from './MapAccess';

const root = '/arena/maps-admin';
// getRandomValues also works on the supported plain HTTP LAN address.
const identity = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
export function MapEditor({
  initial,
  assets,
  onClose,
}: {
  initial: Draft;
  assets: Record<string, Asset>;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [draft, setDraft] = useState(initial),
    [definition, setDefinition] = useState(initial.definition);
  const [initialTransform] = useState(preference);
  const [placement, setPlacement] = useState<Settings>(initialTransform);
  const [pending, setPending] = useState('');
  const [mode, setMode] = useState<'select' | 'translate' | 'rotate' | 'scale'>('translate'),
    [space, setSpace] = useState<'world' | 'local'>(initialTransform.space),
    [snap, setSnap] = useState(initialTransform.grid);
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState('Все');
  const [prefabs, setPrefabs] = useState<PrefabRow[]>([]);
  const [libraryTab, setLibraryTab] = useState<'assets' | 'prefabs'>('assets');
  const [selectedPrefab, setSelectedPrefab] = useState<string | null>(null);
  const [selectedPrefabs, setSelectedPrefabs] = useState<string[]>([]);
  const prefabClipboard = useRef<PrefabInstance | null>(null);
  const [prefabEditing, setPrefabEditing] = useState<React.ComponentProps<typeof PrefabEditor>['initial'] | null>(null);
  const [prefabForm, setPrefabForm] = useState({ id: '', name: '', category: 'Industrial',
    description: '', origin: 'center', replace: false });
  const [message, setMessage] = useState('Черновик загружен'),
    [busy, setBusy] = useState(false),
    [accessLost, setAccessLost] = useState(false),
    [conflict, setConflict] = useState(false),
    [playing, setPlaying] = useState(false),
    [report, setReport] = useState<Report | null>(null),
    stats = useRef<HTMLSpanElement>(null);
  const [history, setHistory] = useState<{ past: Definition[]; future: Definition[] }>({
    past: [],
    future: [],
  });
  const [versions, setVersions] = useState<
    { revision: number; createdAt: number; createdBy: string }[]
  >([]);
  const cacheKey = 'arena-map-draft:' + initial.id;
  const [recovery, setRecovery] = useState<Definition | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(cacheKey) ?? 'null');
      return saved?.schemaVersion === 1 ? saved : null;
    } catch {
      return null;
    }
  });
  const canvas = useRef<HTMLCanvasElement>(null),
    viewport = useRef<MapViewport | null>(null),
    container = useRef<HTMLDivElement>(null);
  const live = useRef({
    definition,
    draft,
    blocked: false,
    conflicted: false,
    saving: false,
    acting: false,
    changedAt: 0,
  });
  live.current.definition = definition;
  live.current.draft = draft;
  const scene = useScene(definition, assets, change, identity, snap, setMessage);
  const {
    selected,
    hidden,
    locked,
    choose: setSelected,
    duplicate,
    remove,
    makeGroup: group,
  } = scene;
  const libraryPanel = useRef<HTMLDetailsElement>(null);
  async function refreshPrefabs() {
    const result = await api<{ prefabs: PrefabRow[] }>(root + '/prefabs');
    setPrefabs(result.prefabs);
  }
  useEffect(() => {
    void refreshPrefabs().catch(() => {});
  }, []);
  useEffect(() => {
    if (scene.group && libraryPanel.current) libraryPanel.current.open = false;
  }, [scene.group?.id]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const [diagnostic, setDiagnostic] = useState<{ document: Definition; data: Preview } | null>(
    null,
  );
  const currentDebug = diagnostic?.document === definition ? diagnostic.data : null;
  const focusIssue = (id: string) => {
    const instance = definition.prefabInstances?.find((p) => id.startsWith(p.id + '-'));
    if (instance) { setSelectedPrefab(instance.id); setSelectedPrefabs([instance.id]); scene.choose([]); }
    else scene.choose([id]);
    viewport.current?.focus([id]);
  };
  const navigate = useNavigate();
  useEffect(() => {
    const failed = (event: Event) =>
      setMessage('Ошибка модели: ' + (event as CustomEvent<string>).detail);
    window.addEventListener('arena-asset-error', failed);
    return () => window.removeEventListener('arena-asset-error', failed);
  }, []);
  function change(d: Definition) {
    if (accessLost) return;
    const previous = live.current.definition;
    setHistory((h) => ({ past: [...h.past, previous].slice(-100), future: [] }));
    live.current.definition = d;
    live.current.changedAt = Date.now();
    if (!live.current.conflicted && !accessLost) live.current.blocked = false;
    setDefinition(d);
    setReport(null);
  }
  function updateObjects(objects: MapObject[]) {
    const current = live.current.definition;
    const instanceChanges = (current.prefabInstances ?? []).filter((p) => objects.some((o) => o.id.startsWith(p.id + '-')));
    if (instanceChanges.length) {
      const nextRoots = new Map<string, PrefabInstance>();
      for (const instance of instanceChanges) {
      const changed = objects.find((o) => o.id.startsWith(instance.id + '-'))!;
      const old = viewport.current?.definition.objects.find((o) => o.id === changed.id);
      if (!old) continue;
      const mat = (o: Pick<MapObject, 'position' | 'rotation' | 'scale'>) =>
        new T.Matrix4().compose(
          new T.Vector3(...o.position),
          new T.Quaternion().setFromEuler(new T.Euler(...o.rotation.map(T.MathUtils.degToRad) as [number, number, number], 'XYZ')),
          new T.Vector3(...o.scale),
        );
      const rootMatrix = mat({ ...instance, scale: [instance.scale, instance.scale, instance.scale] });
      const nextMatrix = mat(changed).multiply(mat(old).invert()).multiply(rootMatrix);
      const pos = new T.Vector3(), quat = new T.Quaternion(), scale = new T.Vector3();
      nextMatrix.decompose(pos, quat, scale);
      if (Math.max(scale.x, scale.y, scale.z) - Math.min(scale.x, scale.y, scale.z) > 1e-3) {
        setMessage('Для prefab разрешён только равномерный масштаб');
        return;
      }
      const rot = new T.Euler().setFromQuaternion(quat, 'XYZ');
      nextRoots.set(instance.id, { ...instance, position: pos.toArray() as [number, number, number],
          rotation: [rot.x, rot.y, rot.z].map(T.MathUtils.radToDeg) as [number, number, number],
          scale: scale.x });
      }
      const direct = new Map(objects.filter((o) => current.objects.some((v) => v.id === o.id)).map((o) => [o.id, o]));
      change({ ...current, objects: current.objects.map((o) => direct.get(o.id) ?? o),
        prefabInstances: current.prefabInstances!.map((p) => nextRoots.get(p.id) ?? p) });
      return;
    }
    const values = new Map(objects.map((o) => [o.id, o]));
    change({
      ...live.current.definition,
      objects: live.current.definition.objects.map((o) => values.get(o.id) ?? o),
    });
  }
  async function save() {
    if (live.current.saving) throw new Error('Сохранение уже выполняется');
    if (live.current.blocked)
      throw new Error('Сначала устраните ошибку сохранения или обновите черновик');
    const current = live.current;
    if (fingerprint(current.definition) === fingerprint(current.draft.definition))
      return current.draft;
    current.saving = true;
    setBusy(true);
    setMessage('Сохранение…');
    try {
      const saved = await api<Draft>(`${root}/${current.draft.id}/save`, 'POST', {
        version: current.draft.draftVersion,
        definition: current.definition,
      });
      live.current.draft = saved;
      setDraft(saved);
      setMessage('Черновик сохранён');
      if (fingerprint(live.current.definition) === fingerprint(saved.definition)) {
        try {
          localStorage.removeItem(cacheKey);
        } catch {
          /* Storage may be disabled. */
        }
      }
      return saved;
    } catch (e) {
      live.current.blocked = true;
      if (e instanceof ApiError && e.status === 403) setAccessLost(true);
      live.current.conflicted = e instanceof ApiError && e.status === 409;
      setConflict(e instanceof ApiError && e.status === 409);
      setMessage((e as Error).message);
      throw e;
    } finally {
      live.current.saving = false;
      setBusy(live.current.acting);
    }
  }
  useEffect(() => {
    let stopped = false;
    void api<Preview>(`${root}/${initial.id}/preview`, 'POST', {
      definition: initial.definition,
    })
      .then((result) => {
        const { manifest } = result;
        if (stopped || !canvas.current) return;
        viewport.current = new MapViewport(
          canvas.current,
          manifest,
          assets,
          (ids) => {
            const matches = live.current.definition.prefabInstances?.filter((p) =>
              ids.some((id) => id.startsWith(p.id + '-'))).map((p) => p.id) ?? [];
            setSelectedPrefabs(matches);
            setSelectedPrefab(matches.at(-1) ?? null);
            sceneRef.current.choose(ids.filter((id) => !matches.some((p) => id.startsWith(p + '-'))));
          },
          updateObjects,
          () => setPlaying(false),
          (fps, calls) => {
            if (stats.current) stats.current.textContent = `${fps} FPS · ${calls} draw calls`;
          },
        );
        setDiagnostic({ document: initial.definition, data: result });
        viewport.current.onPlacementEnd = () => setPending('');
        viewport.current.settings = placement;
        viewport.current.configure('translate', space, snap);
        viewport.current.eligible = sceneRef.current.eligible;
        viewport.current.sync(
          live.current.definition,
          sceneRef.current.selected,
          sceneRef.current.hidden,
          sceneRef.current.locked,
        );
      })
      .catch((e) => setMessage(e.message));
    const timer = window.setInterval(() => {
      const s = live.current;
      if (
        !s.saving &&
        !s.acting &&
        !s.blocked &&
        Date.now() - s.changedAt > 1800 &&
        fingerprint(s.definition) !== fingerprint(s.draft.definition)
      )
        void save().catch(() => {});
    }, 1000);
    const unload = (e: BeforeUnloadEvent) => {
      if (
        live.current.saving ||
        fingerprint(live.current.definition) !== fingerprint(live.current.draft.definition)
      ) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    const leaving = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('a,button') || container.current?.contains(target)) return;
      if (
        (live.current.saving ||
          fingerprint(live.current.definition) !== fingerprint(live.current.draft.definition)) &&
        !window.confirm(
          'Есть несохранённые изменения карты. Локальная копия останется в этом браузере. Покинуть редактор?',
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', leaving, true);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', leaving, true);
      viewport.current?.dispose();
    };
    // One viewport and autosave loop per opened map; callbacks read current data.
  }, []);
  useEffect(() => {
    if (fingerprint(definition) !== fingerprint(draft.definition)) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify(definition));
      } catch {
        /* Server saving remains available when browser storage is full. */
      }
    }
  }, [definition, draft.definition, cacheKey]);
  useEffect(() => {
    const visual = currentDebug?.manifest.definition ?? definition;
    const members = visual.objects.filter((o) => selectedPrefabs.some((id) => o.id.startsWith(id + '-'))).map((o) => o.id);
    const hiddenVisual = new Set(hidden), lockedVisual = new Set(locked);
    for (const instance of definition.prefabInstances ?? [])
      for (const child of visual.objects.filter((o) => o.id.startsWith(instance.id + '-'))) {
        if (instance.editorHidden) hiddenVisual.add(child.id);
        if (instance.editorLocked) lockedVisual.add(child.id);
      }
    if (viewport.current) viewport.current.eligible = new Set([...scene.eligible, ...visual.objects.filter((o) => definition.prefabInstances?.some((p) => o.id.startsWith(p.id + '-'))).map((o) => o.id)]);
    viewport.current?.sync(visual, [...selected, ...members], hiddenVisual, lockedVisual);
    if (members.length && viewport.current && !selectedPrefabs.some((id) => definition.prefabInstances?.find((p) => p.id === id)?.editorLocked))
      viewport.current.gizmo.enabled = true;
  }, [definition, selected, hidden, locked, scene.eligible, currentDebug, selectedPrefabs]);
  useEffect(() => {
    try {
      localStorage.setItem(
        'arena-transform-v1',
        JSON.stringify({ ...placement, space, grid: snap }),
      );
    } catch {
      /* private browsing */
    }
    const v = viewport.current;
    if (!v) return;
    v.selectOnly = mode === 'select';
    v.settings = placement;
    v.configure(mode === 'select' ? 'translate' : mode, space, snap);
    if (selectedPrefabs.length && !selectedPrefabs.some((id) => definition.prefabInstances?.find((p) => p.id === id)?.editorLocked)
        && !selected.some((id) => locked.has(id))) v.gizmo.enabled = true;
    v.selection();
  }, [mode, space, snap, placement, selectedPrefabs, selected, locked, definition]);
  const dirty = useMemo(
    () => fingerprint(definition) !== fingerprint(draft.definition),
    [definition, draft.definition],
  );
  function pastePrefab(source: PrefabInstance) {
    const copy: PrefabInstance = structuredClone(source);
    copy.id = identity().slice(0, 16);
    copy.name = uniqueName(source.name, new Set((live.current.definition.prefabInstances ?? []).map((p) => p.name)));
    copy.position = [source.position[0] + (snap || 0.5), source.position[1], source.position[2] + (snap || 0.5)];
    if (copy.position[0] > 250 || copy.position[2] > 250) { setMessage('Недостаточно места для копии'); return; }
    change({ ...live.current.definition, prefabInstances: [...(live.current.definition.prefabInstances ?? []), copy] });
    setSelectedPrefab(copy.id);
    setSelectedPrefabs([copy.id]);
  }
  function compatibleOverrides(instance: PrefabInstance, children: MapObject[]) {
    const compatible: NonNullable<PrefabInstance['overrides']> = {};
    let removed = 0;
    for (const [id, value] of Object.entries(instance.overrides ?? {})) {
      const child = children.find((o) => o.id === id);
      if (!child) { removed++; continue; }
      const asset = assetFor(assets, child);
      const textOverrides = Object.fromEntries(Object.entries(value.textOverrides ?? {}).filter(([slot]) =>
        slot in (asset.textSlots ?? {})));
      const materialOverrides = Object.fromEntries(Object.entries(value.materialOverrides ?? {}).filter(([slot]) =>
        slot in (asset.materialSlots ?? {})));
      removed += Object.keys(value.textOverrides ?? {}).length - Object.keys(textOverrides).length;
      removed += Object.keys(value.materialOverrides ?? {}).length - Object.keys(materialOverrides).length;
      compatible[id] = { ...value, textOverrides, materialOverrides };
    }
    return { compatible, removed };
  }
  async function run(task: () => Promise<void>) {
    if (live.current.acting) return;
    live.current.acting = true;
    setBusy(true);
    try {
      await task();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      live.current.acting = false;
      setBusy(false);
    }
  }
  async function action(name: string) {
    const saved = await save();
    setBusy(true);
    try {
      const next = await api<Draft>(`${root}/${draft.id}/${name}`, 'POST', {
        version: saved.draftVersion,
      });
      live.current.draft = next;
      setDraft(next);
      setMessage(
        name === 'publish'
          ? `Опубликована версия ${next.revision}. Текущие матчи не изменены.`
          : 'Статус карты обновлён',
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!viewport.current || currentDebug || playing) return;
    let cancelled = false;
    const document = definition;
    const timer = setTimeout(() => {
      void api<Preview>(`${root}/${draft.id}/preview`, 'POST', { definition: document })
        .then((data) => {
          if (!cancelled && live.current.definition === document) setDiagnostic({ document, data });
        })
        .catch((e) => {
          if (!cancelled) setMessage((e as Error).message);
        });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [definition, currentDebug, draft.id, playing, diagnostic === null]);
  async function preview() {
    const document = live.current.definition;
    const data =
      (diagnostic?.document === document && diagnostic.data) ||
      (await api<Preview>(`${root}/${draft.id}/preview`, 'POST', { definition: document }));
    if (document !== live.current.definition)
      throw new Error('Черновик изменился. Повторите проверку.');
    setDiagnostic({ document, data });
    setReport(data.report);
    return data;
  }
  function undo(redo = false) {
    const source = redo ? history.future : history.past;
    if (!source.length || playing) return;
    const d = source.at(-1)!;
    setHistory(
      redo
        ? { past: [...history.past, definition], future: history.future.slice(0, -1) }
        : { past: history.past.slice(0, -1), future: [...history.future, definition] },
    );
    live.current.definition = d;
    live.current.changedAt = Date.now();
    setDefinition(d);
    setReport(null);
    if (!conflict) live.current.blocked = false;
  }
  function exportDraft() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(definition, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = draft.id + '-draft.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  const object =
    selected.length === 1 ? definition.objects.find((o) => o.id === selected[0]) : undefined;
  return (
    <div
      className="map-editor"
      ref={container}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).matches('input,textarea,select') || playing) return;
        if (!e.ctrlKey && !e.altKey && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
          setMode(
            (['select', 'translate', 'rotate', 'scale'] as const)[Number(e.code.slice(-1)) - 1],
          );
          return;
        }
        if (viewport.current?.debugTool && viewport.current.debugTool !== 'select') return;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && ['KeyA', 'KeyC', 'KeyV'].includes(e.code)) {
          e.preventDefault();
          if (e.code === 'KeyA') scene.selectAll();
          else if (e.code === 'KeyC') {
            const instance = definition.prefabInstances?.find((p) => p.id === selectedPrefab);
            if (instance) prefabClipboard.current = structuredClone(instance);
            else { prefabClipboard.current = null; scene.copy(); }
          } else if (prefabClipboard.current) pastePrefab(prefabClipboard.current);
          else scene.paste();
          return;
        }
        if (e.code === 'Escape') {
          if (selectedPrefab) { setSelectedPrefab(null); setSelectedPrefabs([]); return; }
          if (!pending) {
            if (scene.isolation) scene.isolate(null);
            else scene.choose([]);
          }
          return;
        }
        if (mod && e.code === 'KeyZ') {
          e.preventDefault();
          undo(e.shiftKey);
        }
        if (mod && e.code === 'KeyD') {
          e.preventDefault();
          const instance = definition.prefabInstances?.find((p) => p.id === selectedPrefab);
          if (instance) pastePrefab(instance);
          else duplicate();
        }
        if (e.code === 'Delete') {
          e.preventDefault();
          if (selectedPrefab) {
            change({ ...definition, prefabInstances: definition.prefabInstances?.filter((p) => !selectedPrefabs.includes(p.id)) });
            setSelectedPrefab(null); setSelectedPrefabs([]);
          } else remove();
        }
        if (e.code === 'KeyF') {
          viewport.current?.focus([...selected, ...viewport.current.definition.objects.filter((o) =>
            selectedPrefabs.some((id) => o.id.startsWith(id + '-'))).map((o) => o.id)]);
        }
      }}
    >
      <header className="map-editor-head">
        <div>
          <small>ARENA / MAP EDITOR</small>
          <h3>
            {definition.metadata.name}{' '}
            <small>
              rev {draft.revision} · черновик {draft.draftVersion}
            </small>
          </h3>
        </div>
        <button
          disabled={busy || playing}
          onClick={() =>
            void run(async () => {
              if (!accessLost) await save();
              onClose();
            })
          }
        >
          К списку
        </button>
        <button
          disabled={busy || playing || accessLost}
          onClick={() =>
            void run(async () => {
              live.current.blocked = conflict;
              await save();
            })
          }
        >
          Сохранить{dirty ? ' *' : ''}
        </button>
        <button
          disabled={busy || playing}
          onClick={() =>
            void run(async () => {
              await preview();
            })
          }
        >
          Проверить
        </button>
        {isAdmin && <button
          disabled={busy || playing || conflict || accessLost}
          onClick={() =>
            void run(async () => {
              const p = await preview();
              if (p.report.errors.length)
                throw new Error('Исправьте ошибки проверки перед публикацией');
              await action('publish');
            })
          }
        >
          Опубликовать
        </button>}
        {isAdmin && draft.status === 'Published' && <button
          disabled={busy || playing}
          onClick={() => void run(async () => {
            const active = await api<{ count: number }>(`${root}/${draft.id}/active-matches`);
            if (!window.confirm(`Снять карту с публикации? Она пропадёт из выбора для новых матчей. Сейчас на ней идёт матчей: ${active.count}. Все они немедленно завершатся и не попадут в статистику и историю.`)) return;
            await action('unpublish');
          })}
        >Снять с публикации</button>}
        {!!draft.revision && <button
          disabled={busy || playing || conflict}
          onClick={() => void run(async () => {
            if (!window.confirm('Все текущие изменения черновика будут потеряны. Черновик будет восстановлен до последней опубликованной версии.')) return;
            const next = await api<Draft>(`${root}/${draft.id}/rollback`, 'POST', {
              version: live.current.draft.draftVersion,
            });
            live.current.draft = next;
            live.current.definition = next.definition;
            live.current.blocked = false;
            live.current.conflicted = false;
            localStorage.removeItem(cacheKey);
            setRecovery(null);
            setConflict(false);
            setDraft(next);
            setDefinition(next.definition);
            setHistory({ past: [], future: [] });
            setReport(null);
            setMessage(`Черновик восстановлен до опубликованной версии ${next.revision}`);
          })}
        >Откатить черновик</button>}
        {draft.status !== 'Published' && (isAdmin || (draft.accessRole === 'owner' && !draft.revision)) && <button
          disabled={busy || playing}
          onClick={() => {
            if (!window.confirm(`Удалить карту «${draft.name}» полностью?`)) return;
            void run(async () => {
              await api(`${root}/${draft.id}/delete`, 'POST', { version: live.current.draft.draftVersion });
              localStorage.removeItem(cacheKey);
              onClose();
            });
          }}
        >Удалить карту</button>}
        <button
          onClick={() =>
            void (document.fullscreenElement
              ? document.exitFullscreen()
              : container.current?.requestFullscreen())
          }
        >
          На весь экран
        </button>
      </header>
      {accessLost && <div role="alert" className="error-box">Доступ к карте отозван. Автосохранение остановлено. Вернитесь к списку карт.</div>}
      <MapAccess draft={draft} />
      <div className="map-toolbar">
        <fieldset className="scene-toolbar-filter" disabled={playing}>
          <SelectionTools
            s={scene}
            frame={() =>
              viewport.current?.focus(
                definition.objects.filter((o) => !hidden.has(o.id)).map((o) => o.id),
              )
            }
          />
        </fieldset>
        <button
          disabled={playing}
          onClick={() => {
            const v = viewport.current;
            if (v) {
              v.gridShown = !v.gridShown;
              v.grid.visible = v.gridShown;
            }
          }}
        >
          Показать / скрыть сетку
        </button>
        <button disabled={playing} onClick={() => viewport.current?.overview()}>
          Общий вид
        </button>
        <button disabled={playing} onClick={() => viewport.current?.overview(true)}>
          Сверху
        </button>
        <DebugPanel
          v={viewport.current}
          data={currentDebug}
          definition={definition}
          url={root + '/' + draft.id}
          playing={playing}
          start={() => setPlaying(true)}
          message={setMessage}
          focus={focusIssue}
        />
        <button disabled={!history.past.length || playing} onClick={() => undo()}>
          ↶ Отменить
        </button>
        <button disabled={!history.future.length || playing} onClick={() => undo(true)}>
          ↷ Повторить
        </button>
        {(['select', 'translate', 'rotate', 'scale'] as const).map((m, i) => (
          <button
            disabled={playing}
            className={m === mode ? 'active' : ''}
            key={m}
            title={'Клавиша ' + (i + 1)}
            onClick={() => {
              viewport.current?.debugCancel?.();
              setMode(m);
            }}
          >
            {['Выделение', 'Перемещение', 'Поворот', 'Масштаб'][i]}
          </button>
        ))}
        <select
          aria-label="Координаты"
          value={space}
          onChange={(e) => setSpace(e.target.value as typeof space)}
        >
          <option value="world">Мировые оси</option>
          <option value="local">Локальные оси</option>
        </select>
        <select aria-label="Шаг сетки" value={snap} onChange={(e) => setSnap(+e.target.value)}>
          {[0, 0.1, 0.25, 0.5, 1, 2].map((v) => (
            <option key={v} value={v}>
              {v ? `Сетка ${v} м` : 'Без привязки'}
            </option>
          ))}
        </select>
        <label>
          Шаг угла
          <select
            aria-label="Шаг поворота"
            value={placement.rotation}
            onChange={(e) => setPlacement({ ...placement, rotation: +e.target.value })}
          >
            {[0, 5, 15, 30, 45, 90].map((n) => (
              <option key={n} value={n}>
                {n ? n + '°' : 'Свободно'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Шаг масштаба
          <select
            value={placement.scale}
            onChange={(e) => setPlacement({ ...placement, scale: +e.target.value })}
          >
            {[0, 0.05, 0.1, 0.25, 0.5].map((n) => (
              <option key={n} value={n}>
                {n || 'Свободно'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Точка преобразования
          <select
            value={placement.pivot}
            onChange={(e) =>
              setPlacement({ ...placement, pivot: e.target.value as Settings['pivot'] })
            }
          >
            <option value="asset">Опора модели</option>
            <option value="center">Центр габаритов</option>
            <option value="bottom">Центр основания</option>
            <option value="active">Активный объект</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={placement.surface}
            onChange={(e) => setPlacement({ ...placement, surface: e.target.checked })}
          />
          На поверхность
        </label>
        <label>
          <input
            type="checkbox"
            checked={placement.modular}
            onChange={(e) => setPlacement({ ...placement, modular: e.target.checked })}
          />
          Стыковка
        </label>
        {pending && (
          <button onClick={() => viewport.current?.cancelPlacement()}>
            Отменить размещение · {pending} (Esc)
          </button>
        )}
        <button disabled={(!selected.length && !scene.group && !selectedPrefab) || playing} onClick={() => {
          const instance = definition.prefabInstances?.find((p) => p.id === selectedPrefab);
          if (instance) pastePrefab(instance); else duplicate();
        }}>
          Дублировать
        </button>
        <button disabled={!selected.length || playing} onClick={group}>
          Группировать
        </button>
        <button disabled={(!selected.length && !scene.group && !selectedPrefab) || playing} onClick={() => {
          if (selectedPrefab) { change({ ...definition, prefabInstances: definition.prefabInstances?.filter((p) => !selectedPrefabs.includes(p.id)) }); setSelectedPrefab(null); setSelectedPrefabs([]); }
          else remove();
        }}>
          Удалить
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (playing) {
                viewport.current?.stopPlay();
                return;
              }
              const p = await preview();
              if (p.report.errors.length)
                throw new Error('Исправьте ошибки стартов и игровой области');
              viewport.current?.startPlay(p.manifest);
              setPlaying(true);
            })
          }
        >
          {playing ? 'Остановить тест (Esc)' : '▶ Play Test'}
        </button>
        <button
          disabled={busy || playing}
          onClick={() =>
            void run(async () => {
              const saved = await save();
              await api(`${root}/${draft.id}/test-room`, 'POST', { version: saved.draftVersion });
              navigate('/arena');
            })
          }
        >
          Тестовая комната
        </button>
      </div>
      <p className="map-save-status" role="status">
        {message} {dirty ? ' · Есть несохранённые изменения' : ''}
      </p>
      {recovery && fingerprint(recovery) !== fingerprint(definition) && (
        <div className="map-recovery">
          В этом браузере есть локальная копия несохранённых правок.{' '}
          <button
            onClick={() => {
              change(recovery);
              setRecovery(null);
            }}
          >
            Восстановить локальную копию
          </button>
          <button
            onClick={() => {
              localStorage.removeItem(cacheKey);
              setRecovery(null);
            }}
          >
            Оставить серверный черновик
          </button>
        </div>
      )}
      {conflict && (
        <div role="alert">
          Локальная версия сохранена в редакторе.{' '}
          <button onClick={exportDraft}>Скачать локальную копию</button>
          <button
            onClick={() =>
              void run(async () => {
                const d = await api<Draft>(`${root}/${draft.id}`);
                setDraft(d);
                setDefinition(d.definition);
                live.current.draft = d;
                live.current.definition = d.definition;
                live.current.blocked = false;
                live.current.conflicted = false;
                localStorage.removeItem(cacheKey);
                setConflict(false);
                setHistory({ past: [], future: [] });
                setMessage('Загружен актуальный черновик');
              })
            }
          >
            Заменить локальные правки серверными
          </button>
        </div>
      )}
      <div className="map-editor-body">
        <aside className="map-library">
          <details className="scene-library-panel" ref={libraryPanel} open>
            <summary>Библиотека</summary>
            <div className="prefab-tabs">
              <button className={libraryTab === 'assets' ? 'active' : ''} onClick={() => setLibraryTab('assets')}>Assets</button>
              <button className={libraryTab === 'prefabs' ? 'active' : ''} onClick={() => setLibraryTab('prefabs')}>Prefabs</button>
            </div>
            <div hidden={libraryTab !== 'assets'}>
            <input
              aria-label="Поиск объекта"
              placeholder="Найти asset…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="Категория"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {['Все', ...new Set(Object.values(assets).map((a) => a.category))].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <div className="map-assets">
              {Object.entries(assets)
                .filter(([key]) => !key.includes('@'))
                .map(([, a]) => a)
                .filter(
                  (a) =>
                    a.available !== false &&
                    !a.internal &&
                    !a.deprecated &&
                    assets[a.id] === a &&
                    (category === 'Все' || category === a.category) &&
                    `${a.name} ${a.id} ${a.category} ${(a.tags ?? []).join(' ')}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                )
                .map((a) => (
                  <button
                    disabled={playing}
                    key={a.id}
                    title={`${a.id} · ${a.collisionPreset}`}
                    onClick={() => {
                      const o: MapObject = {
                        id: identity(),
                        assetId: a.id,
                        assetVersion: a.version,
                        name: uniqueName(a.name, new Set(definition.objects.map((o) => o.name))),
                        position: [0, 0, 0],
                        rotation: [0, 0, 0],
                        scale: [...a.defaultScale],
                        properties: { ...a.defaults },
                      };
                      viewport.current?.beginPlacement(o, a, (next) => {
                        change({
                          ...live.current.definition,
                          objects: [...live.current.definition.objects, next],
                        });
                        setSelected([next.id]);
                      });
                      setPending(a.name);
                      setMessage('Щёлкните по поверхности, чтобы поставить объект. Esc — отмена.');
                    }}
                  >
                    <span>
                      {a.kind === 'prop'
                        ? '▧'
                        : a.kind === 'spawn'
                          ? '⚑'
                          : a.category === 'Lighting'
                            ? '☼'
                            : '◇'}
                    </span>
                    {a.name}
                    <small>
                      {a.origin === 'custom' ? 'Custom · ' : 'System · '}
                      {a.category} · v{a.version}
                    </small>
                  </button>
                ))}
            </div>
            </div>
            {libraryTab === 'prefabs' && <div className="prefab-library">
              <input aria-label="Поиск prefab" placeholder="Найти prefab…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <select aria-label="Категория prefab" value={category} onChange={(e) => setCategory(e.target.value)}>
                {['Все', 'Industrial', 'Military', 'Urban', 'Nature', 'Architecture', 'Decoration', 'Other'].map((c) => <option key={c}>{c}</option>)}
              </select>
              <div className="map-assets">
                {prefabs.filter((p) => (category === 'Все' || category === p.category) &&
                  `${p.name} ${p.id}`.toLowerCase().includes(query.toLowerCase())).map((p) =>
                  <div className="prefab-card" key={p.id}>
                    <strong>▦ {p.name}</strong><small>{p.id} · {p.category} · rev {p.revision} · {p.status} · {p.ownerLogin}</small>
                    <button disabled={!p.revision || p.status !== 'Published' || playing} onClick={() => void run(async () => {
                      const source = await api<{ definition: { objects: MapObject[] } }>(`${root}/prefabs/${p.id}/revisions/${p.revision}`);
                      const placeholder = assets['base.block'];
                      const oid = identity().slice(0, 16);
                      const ghost: MapObject = { id: oid, assetId: placeholder.id, assetVersion: placeholder.version,
                        name: p.name, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], properties: { ...placeholder.defaults } };
                      viewport.current?.beginPrefabPlacement(source.definition.objects, ghost, (placed) => {
                        change({ ...live.current.definition, prefabInstances: [...(live.current.definition.prefabInstances ?? []),
                          { id: oid, name: p.name, prefabId: p.id, revision: p.revision,
                            position: placed.position, rotation: placed.rotation, scale: 1 }] });
                        setSelectedPrefab(oid);
                        setSelectedPrefabs([oid]);
                      });
                      setPending(p.name);
                      setMessage('Щёлкните по поверхности, чтобы поставить prefab. Esc — отмена.');
                    })}>Разместить</button>
                    {p.editable && <button disabled={playing} onClick={() => void run(async () => {
                      const entry = await api<React.ComponentProps<typeof PrefabEditor>['initial']>(`${root}/prefabs/${p.id}`);
                      setPrefabEditing(entry);
                    })}>Открыть</button>}
                    {p.editable && <button onClick={() => void run(async () => {
                      const use = await api<{ drafts: { map: string; prefabRevision: number }[];
                        published: { map: string; mapRevision: number; prefabRevision: number }[] }>(`${root}/prefabs/${p.id}/usages`);
                      setMessage(`Prefab ${p.id}: ${use.drafts.length} экземпляров в черновиках, ${use.published.length} в опубликованных версиях карт`);
                    })}>Где используется</button>}
                    <button disabled={playing || busy} onClick={() => void run(async () => {
                      const id = window.prompt('ID копии prefab', p.id + '-copy');
                      if (!id) return;
                      await api(`${root}/prefabs/${p.id}/duplicate`, 'POST', { id, name: p.name + ' — копия' });
                      await refreshPrefabs();
                    })}>Дублировать</button>
                    {isAdmin && <button disabled={playing || busy} onClick={() => void run(async () => {
                      const entry = await api<{ draftVersion: number }>(`${root}/prefabs/${p.id}`);
                      await api(`${root}/prefabs/${p.id}/${p.status === 'Archived' ? 'enable' : 'archive'}`, 'POST',
                        { version: entry.draftVersion });
                      await refreshPrefabs();
                    })}>{p.status === 'Archived' ? 'Вернуть' : 'Архивировать'}</button>}
                    {isAdmin && p.revision > 0 && p.status !== 'Archived' && <button onClick={() => void run(async () => {
                      const entry = await api<{ draftVersion: number }>(`${root}/prefabs/${p.id}`);
                      await api(`${root}/prefabs/${p.id}/${p.status === 'Disabled' ? 'enable' : 'disable'}`, 'POST',
                        { version: entry.draftVersion });
                      await refreshPrefabs();
                    })}>{p.status === 'Disabled' ? 'Включить' : 'Отключить'}</button>}
                  </div>)}
              </div>
              <details className="prefab-create"><summary>Создать из выделения</summary>
                <input aria-label="ID нового prefab" placeholder="ID латиницей" value={prefabForm.id} onChange={(e) => setPrefabForm({ ...prefabForm, id: e.target.value })} />
                <input aria-label="Название нового prefab" placeholder="Название" value={prefabForm.name} onChange={(e) => setPrefabForm({ ...prefabForm, name: e.target.value })} />
                <textarea aria-label="Описание prefab" placeholder="Описание" value={prefabForm.description} onChange={(e) => setPrefabForm({ ...prefabForm, description: e.target.value })} />
                <select aria-label="Категория нового prefab" value={prefabForm.category} onChange={(e) => setPrefabForm({ ...prefabForm, category: e.target.value })}>
                  {['Industrial', 'Military', 'Urban', 'Nature', 'Architecture', 'Decoration', 'Other'].map((c) => <option key={c}>{c}</option>)}
                </select>
                <select aria-label="Точка prefab" value={prefabForm.origin} onChange={(e) => setPrefabForm({ ...prefabForm, origin: e.target.value })}>
                  <option value="center">Центр выделения</option><option value="active">Активный объект</option><option value="bottom">Центр основания</option>
                </select>
                {isAdmin && <label><input type="checkbox" checked={prefabForm.replace} onChange={(e) => setPrefabForm({ ...prefabForm, replace: e.target.checked })} />Заменить выделение опубликованным экземпляром</label>}
                {(!prefabForm.replace || !isAdmin) && <small>Исходные объекты останутся на карте. Новый prefab появится в библиотеке после публикации администратором.</small>}
                <button disabled={selected.length < 2 || busy || playing} onClick={() => void run(async () => {
                  const created = await api<{ id: string; draftVersion: number; definition: { origin: [number, number, number] } }>(`${root}/prefabs`, 'POST', { ...prefabForm, definition, selected,
                    active: selected.at(-1) });
                  if (prefabForm.replace && isAdmin) {
                    await api(`${root}/prefabs/${created.id}/publish`, 'POST', { version: created.draftVersion });
                    const remove = new Set(selected);
                    change({ ...definition, objects: definition.objects.filter((o) => !remove.has(o.id)),
                      prefabInstances: [...(definition.prefabInstances ?? []), { id: identity().slice(0, 16),
                        name: prefabForm.name, prefabId: created.id, revision: 1,
                        position: created.definition.origin, rotation: [0, 0, 0], scale: 1 }] });
                    scene.choose([]);
                  }
                  await refreshPrefabs();
                  setMessage(prefabForm.replace && isAdmin ? 'Выделение заменено экземпляром prefab' :
                    'Prefab сохранён как черновик. Опубликуйте его перед размещением.');
                })}>Сохранить prefab</button>
              </details>
            </div>}
          </details>
          {!!definition.prefabInstances?.length && <section className="prefab-hierarchy" aria-label="Prefab instances">
            <h4>Prefab instances</h4>
            {definition.prefabInstances.map((p) => <details key={p.id}>
              <summary><button className={selectedPrefabs.includes(p.id) ? 'active' : ''} onClick={(e) => {
                const ids = e.shiftKey ? [...new Set([...selectedPrefabs, p.id])] : [p.id];
                setSelectedPrefab(p.id); setSelectedPrefabs(ids); if (!e.shiftKey) scene.choose([]);
                viewport.current?.focus(currentDebug?.manifest.definition?.objects.filter((o) => o.id.startsWith(p.id + '-')).map((o) => o.id) ?? []); }}>
                ▦ {p.name} [Prefab] · rev {p.revision}{Object.keys(p.overrides ?? {}).length ? ' *' : ''}
              </button></summary>
              {(currentDebug?.manifest.definition?.objects.filter((o) => o.id.startsWith(p.id + '-')) ?? []).map((o) =>
                <div key={o.id} className="prefab-child">{o.name}</div>)}
            </details>)}
          </section>}
          <fieldset disabled={playing} className="scene-controls">
            <SceneTree
              d={definition}
              assets={assets}
              s={scene}
              focus={(ids) => viewport.current?.focus(ids)}
            />
          </fieldset>
        </aside>
        <main className="map-viewport">
          <canvas tabIndex={0} aria-label="3D редактор карты" ref={canvas} />
          <div className="map-view-help">
            {playing
              ? 'WASD · мышь · Space прыжок · C присесть · Esc вернуться. Двойной клик — захват мыши.'
              : 'ПКМ — обзор · колесо — приближение · СКМ — панорама · WASD/QE — полёт · Shift — быстро · F — выделение'}
          </div>
          <div className="map-view-stats">
            <span ref={stats} /> · {definition.objects.length} объектов
          </div>
          {playing && <span className="map-crosshair">+</span>}
        </main>
        <aside className="map-inspector">
          {selectedPrefab && definition.prefabInstances?.some((p) => p.id === selectedPrefab) && (() => {
            const instance = definition.prefabInstances!.find((p) => p.id === selectedPrefab)!;
            const visible = currentDebug?.manifest.definition;
            const children = visible?.objects.filter((o) => o.id.startsWith(instance.id + '-')) ?? [];
            const replace = (next: typeof instance) => change({ ...definition,
              prefabInstances: definition.prefabInstances!.map((p) => p.id === instance.id ? next : p) });
            return <section className="prefab-inspector">
              <h3>▦ {instance.name} · Prefab</h3>
              <p>{instance.prefabId} · revision {instance.revision} · {children.length} объектов ·{' '}
                {children.filter((o) => o.properties.collision).length} с коллизией ·{' '}
                {children.filter((o) => ['point', 'spot', 'directional'].includes(assetFor(assets, o).kind)).length} источников света</p>
              {(['position', 'rotation'] as const).map((key) => <fieldset key={key} disabled={instance.editorLocked}><legend>{key === 'position' ? 'Положение, м' : 'Поворот, °'}</legend>
                {instance[key].map((n, axis) => <label key={axis}>{'XYZ'[axis]}<input type="number" step="0.1" value={n}
                  onChange={(e) => { const values = [...instance[key]] as [number, number, number]; values[axis] = +e.target.value;
                    replace({ ...instance, [key]: values }); }} /></label>)}
              </fieldset>)}
              <label>Равномерный масштаб<input type="number" min="0.05" max="50" step="0.05" value={instance.scale} disabled={instance.editorLocked}
                onChange={(e) => replace({ ...instance, scale: +e.target.value })} /></label>
              <label><input type="checkbox" checked={!!instance.editorHidden} onChange={(e) => replace({ ...instance, editorHidden: e.target.checked })} />Скрыть в редакторе</label>
              <label><input type="checkbox" checked={!!instance.editorLocked} onChange={(e) => replace({ ...instance, editorLocked: e.target.checked })} />Заблокировать</label>
              <button onClick={() => viewport.current?.focus(children.map((o) => o.id))}>Показать весь prefab (F)</button>
              <button onClick={() => void run(async () => {
                const latest = prefabs.find((p) => p.id === instance.prefabId);
                if (!latest || latest.revision <= instance.revision) { setMessage('Обновлений нет'); return; }
                const next = await api<{ definition: { objects: MapObject[] } }>(`${root}/prefabs/${instance.prefabId}/revisions/${latest.revision}`);
                const { compatible, removed } = compatibleOverrides(instance, next.definition.objects);
                replace({ ...instance, revision: latest.revision, overrides: compatible });
                setMessage(`Обновлена версия ${instance.revision} → ${latest.revision}${removed ? `; удалено несовместимых overrides: ${removed}` : ''}`);
              })}>Обновить до опубликованной версии</button>
              <button onClick={() => void run(async () => {
                const latest = prefabs.find((p) => p.id === instance.prefabId);
                if (!latest || latest.revision <= instance.revision) { setMessage('Обновлений нет'); return; }
                const next = await api<{ definition: { objects: MapObject[] } }>(`${root}/prefabs/${instance.prefabId}/revisions/${latest.revision}`);
                let discarded = 0;
                change({ ...definition, prefabInstances: definition.prefabInstances!.map((p) => {
                  if (p.prefabId !== instance.prefabId || p.revision >= latest.revision) return p;
                  const result = compatibleOverrides(p, next.definition.objects);
                  discarded += result.removed;
                  return { ...p, revision: latest.revision, overrides: result.compatible };
                }) });
                setMessage(`Все экземпляры обновлены до версии ${latest.revision}${discarded ? `; несовместимых overrides: ${discarded}` : ''}`);
              })}>Обновить все экземпляры этого prefab</button>
              <button onClick={() => void run(async () => {
                const resolved = visible ?? (await api<Preview>(`${root}/${initial.id}/preview`, 'POST',
                  { definition: live.current.definition })).manifest.definition;
                if (!resolved) throw new Error('Не удалось получить состав prefab для распаковки');
                const unpacked = resolved.objects.filter((o) => o.id.startsWith(instance.id + '-'));
                const childIds = new Set(unpacked.map((o) => o.id));
                const groups = resolved.groups.filter((g) => g.id === instance.id || g.id.startsWith(instance.id + '-'));
                change({ ...definition, prefabInstances: definition.prefabInstances!.filter((p) => p.id !== instance.id),
                  objects: [...definition.objects, ...unpacked], groups: [...definition.groups, ...groups] });
                setSelectedPrefab(null); setSelectedPrefabs([]); setSelected([...childIds]);
              })}>Распаковать (сохранить вид)</button>
              <button onClick={() => { replace({ ...instance, overrides: {} }); }}>Сбросить overrides</button>
              {children.map((child) => {
                const childId = child.id.slice(instance.id.length + 1);
                const asset = assetFor(assets, child);
                return <details key={child.id}><summary>{child.name}</summary>
                  {Object.entries(asset.textSlots ?? {}).map(([slot, value]) => <label key={slot}>{value.name}
                    <input maxLength={value.maxLength} value={instance.overrides?.[childId]?.textOverrides?.[slot]?.text ?? child.textOverrides?.[slot]?.text ?? value.defaults.text}
                      onChange={(e) => replace({ ...instance, overrides: { ...instance.overrides,
                        [childId]: { ...instance.overrides?.[childId], textOverrides: {
                          ...instance.overrides?.[childId]?.textOverrides, [slot]: { ...instance.overrides?.[childId]?.textOverrides?.[slot], text: e.target.value } } } } })} />
                  </label>)}
                  {Object.entries(asset.materialSlots ?? {}).map(([slot]) => <label key={slot}>Цвет {slot}
                    <input type="color" value={instance.overrides?.[childId]?.materialOverrides?.[slot]?.baseColor ?? child.materialOverrides?.[slot]?.baseColor ?? '#ffffff'}
                      onChange={(e) => replace({ ...instance, overrides: { ...instance.overrides,
                        [childId]: { ...instance.overrides?.[childId], materialOverrides: {
                          ...instance.overrides?.[childId]?.materialOverrides,
                          [slot]: { ...instance.overrides?.[childId]?.materialOverrides?.[slot], baseColor: e.target.value } } } } })} />
                  </label>)}
                </details>;
              })}
            </section>;
          })()}
          {scene.selected.length > 0 && (
            <GeometryReadout v={viewport.current} data={currentDebug} ids={scene.selected} />
          )}
          {scene.group && (
            <label>
              Имя группы
              <input
                key={scene.group.id + scene.group.name}
                defaultValue={scene.group.name}
                maxLength={100}
                disabled={playing || scene.groupLocked(scene.group.id)}
                onBlur={(e) => {
                  if (e.target.value !== scene.group!.name)
                    scene.rename(e.target.value, scene.group!.id, true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </label>
          )}
          {object &&
            assets[object.assetId]?.available !== false &&
            assets[object.assetId]?.version > object.assetVersion && (
              <button
                disabled={playing || locked.has(object.id)}
                onClick={() => {
                  const latest = assets[object.assetId];
                  const next = {
                    ...object,
                    assetVersion: latest.version,
                    properties: { ...latest.defaults },
                  };
                  delete next.materialOverrides;
                  delete next.textOverrides;
                  updateObjects([next]);
                }}
              >
                Обновить asset v{object.assetVersion} → v{assets[object.assetId].version} (сбросить
                overrides)
              </button>
            )}
          <Appearance
            objects={scene.objects}
            assets={assets}
            change={updateObjects}
            disabled={playing || selected.some((id) => locked.has(id))}
          />
          <fieldset disabled={playing || selected.some((k) => locked.has(k))}>
            {selected.length > 1 ? (
              <MultiInspector objects={scene.objects} assets={assets} change={updateObjects} />
            ) : (
              <Inspector
                object={object}
                asset={object ? assetFor(assets, object) : undefined}
                definition={definition}
                change={(o) => {
                  if (o.group !== object?.group && scene.groupLocked(o.group)) return;
                  updateObjects([
                    object && viewport.current ? viewport.current.numeric(object, o) : o,
                  ]);
                }}
                changeDefinition={change}
              />
            )}
          </fieldset>
          {selected.length > 1 && (
            <p>Активный объект: {scene.active?.name}. Масштаб набора равномерный.</p>
          )}
          <button
            onClick={() => {
              setSelected([]);
            }}
          >
            Окружение и режимы
          </button>
          <button
            onClick={() =>
              void run(async () => {
                const r = await api<{ revisions: typeof versions }>(
                  `${root}/${draft.id}/revisions`,
                );
                setVersions(r.revisions);
              })
            }
          >
            История публикаций
          </button>
          {versions.map((v) => (
            <p key={v.revision}>
              rev {v.revision} · {new Date(v.createdAt * 1000).toLocaleString()}
            </p>
          ))}
          {report && (
            <section className="map-report">
              <h3>Проверка карты</h3>
              <p>
                {report.colliders} коллайдеров · {report.bulletColliders} для выстрелов ·{' '}
                {report.lights} источников света
              </p>
              {(['error', 'warning', 'info'] as const).map((level, index) => (
                <div key={level}>
                  <strong>{['Ошибки', 'Предупреждения', 'Сведения'][index]}</strong>
                  {currentDebug?.debug.issues
                    .filter((issue) => issue.level === level)
                    .map((issue, i) => (
                      <p key={i} role={level === 'error' ? 'alert' : undefined}>
                        {issue.objectId ? (
                          <button
                            onClick={() => focusIssue(issue.objectId!)}
                            title="Выбрать в иерархии и перейти"
                          >
                            {(currentDebug.manifest.definition ?? definition).objects.find((o) => o.id === issue.objectId)?.name ?? issue.objectId} ·{' '}
                            {issue.message}
                          </button>
                        ) : (
                          issue.message
                        )}
                      </p>
                    ))}
                </div>
              ))}
              {!report.errors.length && <p>✓ Ошибок публикации нет</p>}
            </section>
          )}
        </aside>
      </div>
      {prefabEditing && <PrefabEditor key={prefabEditing.id} initial={prefabEditing} assets={assets}
        onClose={() => { setPrefabEditing(null); void refreshPrefabs(); }} />}
    </div>
  );
}
