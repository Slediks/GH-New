import { useEffect, useState } from 'react';
import { Vector3 } from 'three';
import type { MapViewport } from '../viewport';
import type { Preview } from './types';
export function GeometryReadout({
  v,
  data,
  ids,
}: {
  v: MapViewport | null;
  data: Preview | null;
  ids: string[];
}) {
  const [size, setSize] = useState('');
  useEffect(() => {
    if (!v) return;
    let frame = 0;
    const render = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const b = v.selectionBounds();
        setSize(
          b.isEmpty()
            ? ''
            : b
                .getSize(new Vector3())
                .toArray()
                .map((n) => n.toFixed(2))
                .join(' × '),
        );
      });
    };
    render();
    const roots = ids.map((id) => v.objects.get(id)?.model);
    roots.forEach((r) => r?.addEventListener('assetloaded' as never, render));
    return () => {
      cancelAnimationFrame(frame);
      roots.forEach((r) => r?.removeEventListener('assetloaded' as never, render));
    };
  }, [v, data, ids]);
  const selected = new Set(ids),
    count = (key: 'boxes' | 'bullet_boxes') =>
      data?.debug.owners[key].filter((id) => selected.has(id)).length;
  return (
    <div className="debug-dimensions">
      <strong>Габариты XYZ, м</strong>
      <div>{size || 'Загрузка…'}</div>
      {data && (
        <small>
          Коллайдеры игрока: {count('boxes')} · для выстрелов: {count('bullet_boxes')}
        </small>
      )}
    </div>
  );
}
