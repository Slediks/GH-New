import { useEffect, useMemo, useRef, useState } from 'react';
import { assetFor, type Asset, type Definition } from './types';
import { ancestors, kind, kinds, type Kind, type Similar } from './sceneSelection';
import type { SceneControls } from './useScene';
const icons: Record<Kind, string> = {
  geometry: '▧',
  decoration: '◇',
  lights: '☼',
  gameplay: '⚑',
  text: 'T',
  volumes: '▣',
};
export function SelectionTools({ s, frame }: { s: SceneControls; frame: () => void }) {
  const [by, setBy] = useState<Similar>('asset');
  const popup = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (popup.current && !popup.current.contains(event.target as Node))
        popup.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <details className="scene-tools" ref={popup}>
      <summary>Выбор и видимость · {s.selected.length}</summary>
      <div>
        {Object.entries(kinds).map(([k, label]) => (
          <label key={k}>
            <input
              type="checkbox"
              checked={s.filters.includes(k as Kind)}
              onChange={() =>
                s.setFilters(
                  s.filters.includes(k as Kind)
                    ? s.filters.filter((v) => v !== k)
                    : [...s.filters, k as Kind],
                )
              }
            />
            {label}
          </label>
        ))}
        <select
          aria-label="Набор фильтров"
          value=""
          onChange={(e) =>
            s.setFilters(
              e.target.value === 'all' ? (Object.keys(kinds) as Kind[]) : [e.target.value as Kind],
            )
          }
        >
          <option value="" disabled>
            Набор фильтров…
          </option>
          <option value="all">Все типы</option>
          {Object.entries(kinds).map(([k, v]) => (
            <option key={k} value={k}>
              Только {v}
            </option>
          ))}
        </select>
        <button onClick={s.selectAll}>Выбрать все</button>
        <button onClick={s.invert}>Инвертировать</button>
        <button disabled={!s.active} onClick={() => s.similar('asset')}>
          Все экземпляры модели
        </button>
        <select
          aria-label="Признак сходства"
          value={by}
          onChange={(e) => setBy(e.target.value as Similar)}
        >
          {Object.entries({
            asset: 'Модель',
            kind: 'Тип',
            category: 'Категория',
            variant: 'Вариант материала',
            group: 'Группа',
          }).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button disabled={!s.active} onClick={() => s.similar(by)}>
          Выбрать похожие
        </button>
        <button onClick={() => s.flags('editorHidden', true)}>Скрыть выделение</button>
        <button onClick={s.showAll}>Показать все скрытые</button>
        <button onClick={() => s.flags('editorLocked', true)}>Заблокировать выделение</button>
        <button
          disabled={!s.selected.length && !s.isolation}
          onClick={() => s.isolate(s.isolation ? null : [...s.selected])}
        >
          {s.isolation ? 'Выйти из изоляции' : 'Изолировать выделение'}
        </button>
        <button onClick={frame}>Вся сцена в кадре</button>
      </div>
    </details>
  );
}
interface Row {
  id: string;
  name: string;
  depth: number;
  group: boolean;
  ownL?: boolean;
  ownH?: boolean;
  category?: Kind;
}
export function SceneTree({
  d,
  assets,
  s,
  focus,
}: {
  d: Definition;
  assets: Record<string, Asset>;
  s: SceneControls;
  focus: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState(''),
    [treeKind, setTreeKind] = useState<Kind | 'all' | 'groups'>('all'),
    [collapsed, collapse] = useState<Set<string>>(new Set()),
    [top, setTop] = useState(0),
    [edit, setEdit] = useState(''),
    [menu, setMenu] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const current = s.group?.id ?? s.active?.id;
  const rows = useMemo(() => {
    const result: Row[] = [],
      q = query.trim().toLocaleLowerCase();
    const buckets = new Map<string | undefined, Definition['objects']>();
    for (const o of d.objects) {
      const arr = buckets.get(o.group) ?? [];
      arr.push(o);
      buckets.set(o.group, arr);
    }
    function walk(parent: string | undefined, depth: number, included = false) {
      for (const g of d.groups.filter((g) => g.parent === parent)) {
        const at = result.length,
          match = included || g.name.toLowerCase().includes(q);
        result.push({
          id: g.id,
          name: g.name,
          depth,
          group: true,
          ownL: g.editorLocked,
          ownH: g.editorHidden,
        });
        if (q || treeKind !== 'all' || !collapsed.has(g.id)) walk(g.id, depth + 1, match);
        if (
          ((q && !match) || (treeKind !== 'all' && treeKind !== 'groups')) &&
          result.length === at + 1
        )
          result.pop();
      }
      for (const o of buckets.get(parent) ?? []) {
        const a = assetFor(assets, o);
        if (treeKind !== 'all' && treeKind !== kind(a)) continue;
        if (
          q &&
          !included &&
          !(o.name + ' ' + a.name + ' ' + a.id + ' ' + o.id).toLowerCase().includes(q)
        )
          continue;
        result.push({
          id: o.id,
          name: o.name,
          depth,
          group: false,
          ownL: o.editorLocked,
          ownH: o.editorHidden,
          category: kind(a),
        });
      }
    }
    walk(undefined, 0);
    return result;
  }, [d, assets, collapsed, query, treeKind]);
  const virtual = rows.length > 480,
    start = virtual ? Math.max(0, Math.min(rows.length - 1, Math.floor(top / 30) - 5)) : 0,
    end = virtual ? Math.min(rows.length, start + 28) : rows.length;
  useEffect(() => {
    if (!s.active || s.group) return;
    const parents = ancestors(d.groups, s.active.group);
    collapse((prev) => {
      if (!parents.some((g) => prev.has(g.id))) return prev;
      const n = new Set(prev);
      parents.forEach((g) => n.delete(g.id));
      return n;
    });
  }, [current, d.groups, s.active?.group, s.group]);
  useEffect(() => {
    if (!current || query || !scroller.current) return;
    const i = rows.findIndex((r) => r.id === current);
    if (i < 0) return;
    const el = scroller.current,
      h = el.clientHeight;
    if (i * 30 < el.scrollTop || i * 30 + 30 > el.scrollTop + h)
      el.scrollTop = Math.max(0, i * 30 - h / 2);
  }, [current, rows, query]);
  function drop(e: React.DragEvent, parent?: string) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const v = JSON.parse(e.dataTransfer.getData('application/x-arena-tree'));
      if (v.map === d.metadata.name && Array.isArray(v.ids)) s.reparent(v.ids, parent, v.group);
    } catch {
      /* external drag */
    }
  }
  return (
    <>
      <h3>Иерархия · {d.objects.length}</h3>
      <input
        aria-label="Поиск в иерархии"
        placeholder="Имя, модель, группа…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setTop(0);
          if (scroller.current) scroller.current.scrollTop = 0;
        }}
      />
      <label>
        Показать в дереве
        <select value={treeKind} onChange={(e) => setTreeKind(e.target.value as typeof treeKind)}>
          <option value="all">Все типы</option>
          <option value="groups">Только группы</option>
          {Object.entries(kinds).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="scene-tree-actions">
        <button onClick={() => collapse(new Set(d.groups.map((g) => g.id)))}>Свернуть все</button>
        <button onClick={() => collapse(new Set())}>Развернуть все</button>
      </div>
      <div className="scene-root" onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e)}>
        ▾ Сцена · корень
      </div>
      <div
        className="map-hierarchy scene-tree"
        ref={scroller}
        role="tree"
        aria-label="Объекты сцены"
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      >
        {virtual && <div style={{ height: start * 30 }} />}
        {rows.slice(start, end).map((r) => {
          const isCurrent = current === r.id,
            isSelected = r.group ? s.group?.id === r.id : s.selectedSet.has(r.id);
          const locked = r.group ? s.groupLocked(r.id) : s.locked.has(r.id),
            hidden = r.group
              ? ancestors(d.groups, r.id).some((g) => g.editorHidden)
              : s.hidden.has(r.id);
          const pick = () => (r.group ? s.chooseGroup(r.id) : s.choose([r.id]));
          return (
            <div
              key={(r.group ? 'g' : 'o') + r.id}
              role="treeitem"
              aria-selected={isSelected}
              aria-level={r.depth + 1}
              className={
                'scene-row ' +
                (isSelected ? 'selected ' : '') +
                (isCurrent ? 'current ' : '') +
                (hidden ? 'muted' : '')
              }
              style={{ paddingLeft: Math.min(40, r.depth * 10) }}
              draggable={!locked && !edit}
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  'application/x-arena-tree',
                  JSON.stringify({
                    map: d.metadata.name,
                    ids: isSelected ? s.selected : [r.id],
                    group: r.group ? r.id : undefined,
                  }),
                );
              }}
              onDragOver={(e) => {
                if (r.group) e.preventDefault();
              }}
              onDrop={(e) => {
                if (r.group) drop(e, r.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!isSelected) pick();
                setMenu(true);
              }}
            >
              {r.group ? (
                <button
                  aria-label={'Раскрыть или свернуть ' + r.name}
                  onClick={() =>
                    collapse((prev) => {
                      const n = new Set(prev);
                      if (n.has(r.id)) n.delete(r.id);
                      else n.add(r.id);
                      return n;
                    })
                  }
                >
                  {collapsed.has(r.id) ? '▸' : '▾'}
                </button>
              ) : (
                <span aria-hidden>{icons[r.category!]}</span>
              )}
              {edit === r.id ? (
                <input
                  autoFocus
                  aria-label="Новое имя"
                  defaultValue={r.name}
                  maxLength={100}
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => {
                    s.rename(e.target.value, r.id, r.group);
                    setEdit('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                      e.currentTarget.value = r.name;
                      e.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <button
                  className="scene-name"
                  title={r.name}
                  onClick={(e) => {
                    setMenu(false);
                    if (r.group) s.chooseGroup(r.id);
                    else s.chooseObject(r.id, e.shiftKey, e.ctrlKey || e.metaKey);
                  }}
                  onDoubleClick={() => focus(r.group ? s.selected : [r.id])}
                >
                  {!r.group && r.depth ? '↳ ' : ''}
                  {r.name}
                </button>
              )}
              <button
                aria-label={'Скрыть ' + r.name}
                title={hidden ? 'Скрыто' : 'Видно'}
                onClick={() => s.flags('editorHidden', !r.ownH, [r.id], r.group ? r.id : null)}
              >
                {hidden ? '○' : '◉'}
              </button>
              <button
                aria-label={'Заблокировать ' + r.name}
                title={locked && !r.ownL ? 'Блокировка родителя' : 'Блокировка'}
                onClick={() => s.flags('editorLocked', !r.ownL, [r.id], r.group ? r.id : null)}
              >
                {locked ? '🔒' : '◇'}
              </button>
            </div>
          );
        })}
        {virtual && <div style={{ height: (rows.length - end) * 30 }} />}
      </div>
      {(menu || s.group) && (
        <div className="scene-tree-actions">
          <button onClick={() => focus(s.selected)}>Фокус</button>
          <button
            onClick={() => {
              if (current) setEdit(current);
              setMenu(false);
            }}
          >
            Переименовать
          </button>
          <button onClick={s.duplicate}>Создать копию</button>
          <button onClick={s.makeGroup}>В новую группу</button>
          <button onClick={() => s.flags('editorHidden', true)}>Скрыть</button>
          <button onClick={() => s.flags('editorLocked', true)}>Блокировать</button>
          {s.group && <button onClick={s.ungroup}>Разгруппировать</button>}
          <button onClick={s.remove}>
            {s.group ? 'Удалить группу с содержимым' : 'Удалить выделенное'}
          </button>
          {menu && <button onClick={() => setMenu(false)}>Закрыть меню</button>}
        </div>
      )}
    </>
  );
}
