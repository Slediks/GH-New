import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { api } from '../../../../shared/api';
import type { MapViewport } from '../viewport';
import type { Definition, Vec3 } from '../types';
import { layers, preferences, type Prefs, type Preview, type Segment, type Tool } from './types';

const labels: Record<Tool, string> = {
  select: 'Выделение',
  measure: 'Измерить',
  ray: 'Проверить луч',
  reference: 'Поставить игрока',
};
export function DebugPanel({
  v,
  data,
  definition,
  url,
  playing,
  start,
  message,
  focus,
}: {
  v: MapViewport | null;
  data: Preview | null;
  definition: Definition;
  url: string;
  playing: boolean;
  start: () => void;
  message: (m: string) => void;
  focus: (id: string) => void;
}) {
  const [prefs, setPrefs] = useState(preferences),
    [tool, toolState] = useState<Tool>('select'),
    [pending, setPending] = useState<Vec3 | null>(null),
    [segments, setSegments] = useState<Segment[]>([]),
    [ref, setRef] = useState<Vec3 | null>(null),
    [crouch, setCrouch] = useState(false),
    [snap, setSnap] = useState(false),
    [rayInfo, setRayInfo] = useState<{ id: string; text: string } | null>(null),
    [open, setOpen] = useState(false),
    [coords, setCoords] = useState(''),
    [dimensions, setDimensions] = useState(''),
    [working, setWorking] = useState(false);
  const ticket = useRef(0);
  const toolChange = (t: Tool) => {
    ticket.current++;
    toolState(t);
    setPending(null);
    v?.canvas.focus();
  };
  useEffect(() => {
    try {
      localStorage.setItem('arena-debug-v1', JSON.stringify(prefs));
    } catch {
      /* unavailable */
    }
    if (v) {
      v.debugPrefs = prefs;
      v.refreshDebug();
    }
  }, [prefs, v, data]);
  useEffect(() => {
    ticket.current++;
    setPending(null);
    setRayInfo(null);
    setSegments((previous) => previous.filter((s) => s.kind === 'measure'));
    return () => {
      ticket.current++;
    };
  }, [definition]);
  useEffect(() => {
    if (!v) return;
    v.debugPreview = data ?? undefined;
    if (!data) v.debug.reset();
    v.refreshDebug();
  }, [data, v]);
  useEffect(() => {
    if (!v) return;
    v.debugTool = tool;
    v.debugSnap = snap;
    v.debugCancel = () => toolChange('select');
    if (tool !== 'select') v.cancelPlacement();
    if(!v.play)v.selection();
    v.debugClick = async (point) => {
      if (tool === 'reference') {
        setRef(point);
        return;
      }
      if (tool === 'select') return;
      if (!pending) {
        setPending(point);
        return;
      }
      const a = pending;
      setPending(null);
      const distance = new T.Vector3(...point).distanceTo(new T.Vector3(...a));
      if (distance < 1e-6) return;
      if (tool === 'measure') {
        setPrefs((p) => ({ ...p, measurements: true }));
        setSegments((list) => [
          ...list,
          {
            a,
            b: point,
            kind: 'measure',
            description:
              distance.toFixed(2) +
              ' м · ΔXYZ ' +
              point.map((n, i) => (n - a[i]).toFixed(2)).join(' / '),
          },
        ]);
      } else {
        const seq = ++ticket.current;
        try {
          const r = await api<{
            hit: { objectId: string; index: number; point: Vec3; distance: number } | null;
            length: number;
          }>(url + '/debug-ray', 'POST', { definition, start: a, end: point });
          if (seq !== ticket.current) return;
          const h = r.hit;
          const text = h
            ? 'Попадание · ' +
              (definition.objects.find((o) => o.id === h.objectId)?.name ?? h.objectId) +
              ' · коллайдер ' +
              (h.index + 1) +
              ' · ' +
              h.distance.toFixed(2) +
              ' м'
            : 'Свободно · ' + r.length.toFixed(2) + ' м';
          setRayInfo({ id: h?.objectId ?? '', text });
          setPrefs((p) => ({ ...p, measurements: true }));
          setSegments((list) => [
            ...list,
            { a, b: h?.point ?? point, kind: h ? 'hit' : 'clear', description: text },
          ]);
        } catch (e) {
          if (seq === ticket.current) message((e as Error).message);
        }
      }
    };
    return () => {
      v.debugClick = undefined;
      v.debugCancel = undefined;
    };
  }, [v, tool, snap, definition, pending, url]);
  useEffect(() => {
    if (!v || !data) return;
    const m = data.manifest.movement;
    v.debug.annotate(
      segments,
      pending,
      ref,
      m.radius,
      crouch ? m.crouch_height : m.standing_height,
      prefs.measurements,
    );
  }, [v, data, segments, pending, ref, crouch, prefs.measurements]);
  useEffect(() => {
    if (!v || !open) return;
    const tick = () => {
      setCoords(
        v.arena.camera.position
          .toArray()
          .map((n) => n.toFixed(2))
          .join(' / '),
      );
      const b = v.selectionBounds();
      setDimensions(
        b.isEmpty()
          ? ''
          : b
              .getSize(new T.Vector3())
              .toArray()
              .map((n) => n.toFixed(2))
              .join(' × '),
      );
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [v, open]);
  useEffect(() => {
    if (playing) toolChange('select');
  }, [playing]);
  const activeSpawn = v?.allSelected.length === 1 ? v.allSelected[0] : undefined;
  async function play(here: boolean) {
    if (!v || !data || working) return;
    setWorking(true);
    const seq = ++ticket.current;
    try {
      const camera = v.arena.camera,
        dir = camera.getWorldDirection(new T.Vector3());
      const r = await api<{ point: number[] }>(url + '/debug-start', 'POST', {
        definition,
        camera: camera.position.toArray(),
        spawnId: here ? null : activeSpawn,
      });
      if (ticket.current !== seq) return;
      if (here) r.point[3] = Math.atan2(dir.x, -dir.z);
      toolChange('select');
      v.startPlay(data.manifest, r.point, here ? Math.asin(T.MathUtils.clamp(dir.y, -1, 1)) : 0);
      start();
      setOpen(false);
    } catch (e) {
      message((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  const set = (key: keyof Prefs, val: string | boolean) => setPrefs((p) => ({ ...p, [key]: val }));
  return (
    <div className="arena-debug">
      <button disabled={playing} aria-expanded={open} onClick={() => setOpen(!open)}>
        Диагностика{tool !== 'select' ? ' · ' + labels[tool] : ''}
      </button>
      {open && !playing && (
        <section aria-label="Диагностика карты" className="debug-pop">
          <header>
            <strong>Диагностика карты</strong>
            <button onClick={() => setOpen(false)}>Свернуть</button>
          </header>
          <label>
            Набор слоёв
            <select
              value=""
              onChange={(e) => {
                const modes: Record<string, string[]> = {
                  none: [],
                  collision: ['boxes', 'bullet_boxes'],
                  gameplay: ['spawns', 'playable', 'excluded'],
                  all: Object.keys(layers),
                };
                const list = modes[e.target.value];
                setPrefs((p) => ({
                  ...p,
                  ...Object.fromEntries(Object.keys(layers).map((k) => [k, list.includes(k)])),
                }));
              }}
            >
              <option value="" disabled>
                Выбрать…
              </option>
              <option value="none">Без слоёв</option>
              <option value="collision">Коллизии</option>
              <option value="gameplay">Игровые объекты</option>
              <option value="all">Все слои</option>
            </select>
          </label>
          <div className="debug-checks">
            {(Object.keys(layers) as (keyof typeof layers)[]).map((k) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={prefs[k]}
                  onChange={(e) => set(k, e.target.checked)}
                />
                {layers[k]}
              </label>
            ))}
          </div>
          <small>Игрок — бирюзовая линия. Выстрел — оранжевый пунктир.</small>
          <label>
            <input
              type="checkbox"
              checked={prefs.selectedOnly}
              onChange={(e) => set('selectedOnly', e.target.checked)}
            />
            Коллайдеры только выделенных
          </label>
          <label>
            Режим стартов
            <select value={prefs.mode} onChange={(e) => set('mode', e.target.value)}>
              {['all', 'elimination', 'tdm', 'dm'].map((m, i) => (
                <option key={m} value={m}>
                  {['Все', 'Round Elimination', 'Team Deathmatch', 'Deathmatch'][i]}
                </option>
              ))}
            </select>
          </label>
          <div className="debug-tools">
            {(Object.keys(labels) as Tool[]).map((t) => (
              <button key={t} aria-pressed={tool === t} onClick={() => toolChange(t)}>
                {labels[t]}
              </button>
            ))}
          </div>
          <small>
            {tool === 'reference'
              ? 'Щёлкните по поверхности для размещения цилиндра.'
              : tool === 'measure' || tool === 'ray'
                ? (pending ? 'Выберите точку B' : 'Выберите точку A') +
                  ' · Esc — выйти из инструмента.'
                : ''}
          </small>
          <label>
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
            Привязка к габаритам и точкам стыка (0,4 м)
          </label>
          <label>
            <input type="checkbox" checked={crouch} onChange={(e) => setCrouch(e.target.checked)} />
            Игрок присел
          </label>
          {data && (
            <small>
              Игрок: Ø {(2 * data.manifest.movement.radius).toFixed(2)} м, высота{' '}
              {data.manifest.movement[crouch ? 'crouch_height' : 'standing_height']} м
            </small>
          )}
          {segments.slice(-8).map((s, i) => (
            <p key={i}>{s.description}</p>
          ))}
          {rayInfo?.id && <button onClick={() => focus(rayInfo.id)}>Выбрать преграду</button>}
          <button
            onClick={() => {
              ticket.current++;
              setPending(null);
              setSegments([]);
              setRayInfo(null);
              setRef(null);
            }}
          >
            Очистить измерения и отметки
          </button>
          <p>Камера XYZ: {coords} м</p>
          {dimensions && <p>Габариты XYZ: {dimensions} м</p>}
          <button disabled={!data || working} onClick={() => void play(true)}>
            Играть отсюда
          </button>
          <button
            disabled={working || !activeSpawn || !data?.debug.owners.spawns.includes(activeSpawn)}
            onClick={() => void play(false)}
          >
            Играть с выбранного старта
          </button>
        </section>
      )}
    </div>
  );
}
