import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../../shared/api';
import { Inspector } from './Inspector';
import { SceneTree } from './SceneTree';
import { useScene } from './useScene';
import { assetFor, type Asset, type Definition, type MapObject, type Vec3 } from './types';
import { MapViewport } from './viewport';
import { fingerprint } from './definitionState';
import { useAuth } from '../../../app/Auth';

const root = '/arena/maps-admin/prefabs';
type Source = {
  schemaVersion: 1; id: string; metadata: { name: string; category: string; description: string };
  origin: Vec3; objects: MapObject[]; groups: Definition['groups']; dependencies: [string, number][];
};
type Draft = { id: string; draftVersion: number; revision: number; definition: Source };
const uid = () => [...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, '0')).join('');
function document(source: Source): Definition {
  return { schemaVersion: 1, metadata: { name: source.metadata.name, description: source.metadata.description },
    environment: { background: '#9faeb3', ambientColor: '#e9f4ff', ambientIntensity: 2.5,
      sunPosition: [-18, 35, 20], sunIntensity: 3.2, fogEnabled: true, fogNear: 45, fogFar: 180 },
    objects: source.objects, groups: source.groups, settings: { modes: ['dm'] } };
}
export function PrefabEditor({ initial, assets, onClose }: {
  initial: Draft; assets: Record<string, Asset>; onClose: () => void;
}) {
  const { user } = useAuth();
  const [saved, setSaved] = useState(initial), [source, setSource] = useState(initial.definition);
  const [message, setMessage] = useState('Черновик prefab'), [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'select' | 'translate' | 'rotate' | 'scale'>('translate');
  const [space, setSpace] = useState<'world' | 'local'>('world'), [snap, setSnap] = useState(0.5);
  const [history, setHistory] = useState<{ past: Source[]; future: Source[] }>({ past: [], future: [] });
  const canvas = useRef<HTMLCanvasElement>(null), viewport = useRef<MapViewport | null>(null);
  const live = useRef(source); live.current = source;
  const savedRef = useRef(saved); savedRef.current = saved;
  const saving = useRef<Promise<Draft> | null>(null);
  const failed = useRef<string | null>(null), conflicted = useRef(false);
  const [accessLost, setAccessLost] = useState(false);
  const d = document(source);
  const change = (next: Definition) => {
    if (accessLost) return;
    setHistory((h) => ({ past: [...h.past, live.current].slice(-100), future: [] }));
    setSource({ ...live.current, metadata: { ...live.current.metadata, name: next.metadata.name,
      description: next.metadata.description }, objects: next.objects, groups: next.groups,
      dependencies: [...new Map(next.objects.map((o) => [`${o.assetId}@${o.assetVersion}`,
        [o.assetId, o.assetVersion] as [string, number]])).values()].sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]) });
  };
  const scene = useScene(d, assets, change, uid, 0, setMessage);
  const undo = (redo = false) => {
    const stack = redo ? history.future : history.past;
    const prior = stack.at(-1);
    if (!prior) return;
    setSource(prior);
    setHistory(redo ? { past: [...history.past, source], future: history.future.slice(0, -1) }
      : { past: history.past.slice(0, -1), future: [...history.future, source] });
  };
  useEffect(() => {
    let disposed = false;
    void api<{ manifest: import('../types').Manifest }>(`${root}/${initial.id}/preview`, 'POST',
      { definition: initial.definition }).then(({ manifest }) => {
      if (disposed || !canvas.current) return;
      viewport.current = new MapViewport(canvas.current, manifest, assets, scene.choose,
        (objects) => change({ ...document(live.current), objects: live.current.objects.map((o) =>
          objects.find((v) => v.id === o.id) ?? o) }), () => {}, () => {});
    }).catch((e) => setMessage(e.message));
    return () => { disposed = true; viewport.current?.dispose(); };
  }, []);
  useEffect(() => { viewport.current?.sync(d, scene.selected, scene.hidden, scene.locked); },
    [source, scene.selected, scene.hidden, scene.locked]);
  useEffect(() => {
    viewport.current?.configure(mode === 'select' ? 'translate' : mode, space, snap);
    if (viewport.current) viewport.current.selectOnly = mode === 'select';
    viewport.current?.selection();
  }, [mode, space, snap, source]);
  async function save(manual = false) {
    if (conflicted.current) throw new Error('Prefab изменён в другой вкладке. Откройте его заново.');
    if (!manual && failed.current === fingerprint(live.current)) return savedRef.current;
    if (saving.current) { await saving.current; return savedRef.current; }
    if (fingerprint(live.current) === fingerprint(savedRef.current.definition)) return savedRef.current;
    setBusy(true);
    const current = live.current;
    const promise = api<Draft>(`${root}/${initial.id}/save`, 'POST',
      { version: savedRef.current.draftVersion, definition: current });
    saving.current = promise;
    try {
      const result = await promise;
      savedRef.current = result;
      failed.current = null;
      setSaved(result); setMessage('Черновик prefab сохранён');
      return result;
    } catch (e) {
      failed.current = fingerprint(current);
      conflicted.current = e instanceof ApiError && e.status === 409;
      if (e instanceof ApiError && e.status === 403) setAccessLost(true);
      throw e;
    } finally { saving.current = null; setBusy(false); }
  }
  useEffect(() => {
    if (busy || accessLost || conflicted.current || failed.current === fingerprint(source) ||
      fingerprint(source) === fingerprint(saved.definition)) return;
    const timer = window.setTimeout(() => { void save().catch((e) => setMessage((e as Error).message)); }, 1800);
    return () => clearTimeout(timer);
  }, [source, saved, busy]);
  async function publish() {
    setBusy(true);
    try {
      let current = await save(true);
      while (fingerprint(live.current) !== fingerprint(current.definition)) current = await save(true);
      const result = await api<Draft>(`${root}/${initial.id}/publish`, 'POST',
        { version: current.draftVersion });
      savedRef.current = result; setSaved(result); setMessage(`Опубликована версия ${result.revision}`);
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  const active = d.objects.find((o) => o.id === scene.selected.at(-1));
  return <div className="prefab-editor-overlay" role="dialog" aria-label={'Редактор prefab ' + source.metadata.name}
    onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' &&
      !(e.target as HTMLElement).matches('input,textarea,select')) { e.preventDefault(); undo(e.shiftKey); } }}>
    <div className="prefab-editor-head"><strong>Editing Prefab: {source.metadata.name} · rev {saved.revision} · draft {saved.draftVersion}{fingerprint(source) !== fingerprint(saved.definition) ? ' · несохранено *' : ''}</strong>
      <button onClick={() => { if (accessLost) onClose(); else void save(true).then(onClose).catch((e) => setMessage(e.message)); }} disabled={busy}>К карте</button>
      <button onClick={() => void save(true).catch((e) => setMessage(e.message))} disabled={busy || accessLost}>Сохранить черновик</button>
      {user?.role === 'admin' && <button onClick={() => void publish()} disabled={busy || accessLost}>Опубликовать</button>}
      <button onClick={() => undo()} disabled={!history.past.length}>Отменить</button>
      <button onClick={() => undo(true)} disabled={!history.future.length}>Повторить</button>
    </div>
    <p role="status">{accessLost ? 'Доступ отозван. Автосохранение остановлено.' : message}</p>
    <div className="prefab-editor-tools">
      {(['select', 'translate', 'rotate', 'scale'] as const).map((m, i) =>
        <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
          {['Выделение', 'Перемещение', 'Поворот', 'Масштаб'][i]}</button>)}
      <select aria-label="Оси prefab" value={space} onChange={(e) => setSpace(e.target.value as typeof space)}>
        <option value="world">Мировые оси</option><option value="local">Локальные оси</option>
      </select>
      <select aria-label="Сетка prefab" value={snap} onChange={(e) => setSnap(+e.target.value)}>
        {[0, 0.1, 0.25, 0.5, 1, 2].map((n) => <option key={n} value={n}>{n ? `Сетка ${n} м` : 'Без привязки'}</option>)}
      </select>
    </div>
    <div className="prefab-editor-workspace">
      <aside><details><summary>Добавить asset</summary>
        {Object.entries(assets).filter(([key, a]) => key === a.id).map(([, a]) => a).filter((a) => a.available !== false && !a.internal &&
          !['spawn', 'spectator', 'playable', 'excluded'].includes(a.kind)).map((a) =>
          <button key={a.id} title={a.id} onClick={() => {
            const object: MapObject = { id: uid(), assetId: a.id, assetVersion: a.version, name: a.name,
              position: [0, 0, 0], rotation: [0, 0, 0], scale: [...a.defaultScale], properties: { ...a.defaults } };
            viewport.current?.beginPlacement(object, a, (placed) => change({ ...document(live.current),
              objects: [...live.current.objects, placed] }));
          }}>{a.name} <small>{a.id}</small></button>)}
      </details>
        <button disabled={!scene.selected.length} onClick={scene.duplicate}>Дублировать</button>
        <button disabled={!scene.selected.length} onClick={scene.makeGroup}>Группировать</button>
        <button disabled={!scene.selected.length} onClick={scene.remove}>Удалить</button>
        <SceneTree d={d} assets={assets} s={scene} focus={(ids) => viewport.current?.focus(ids)} /></aside>
      <canvas ref={canvas} tabIndex={0} aria-label="3D редактор prefab" />
      <aside><label>Название<input value={source.metadata.name} onChange={(e) => change({ ...d, metadata: { ...d.metadata, name: e.target.value } })} /></label>
        {active ? <Inspector object={active} asset={assetFor(assets, active)} definition={d}
          change={(o) => change({ ...d, objects: d.objects.map((v) => v.id === o.id ? o : v) })}
          changeDefinition={change} /> : <p>Выберите объект в сцене или дереве для редактирования.</p>}
      </aside>
    </div>
  </div>;
}
