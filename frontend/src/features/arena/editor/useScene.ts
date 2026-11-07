import { useEffect, useMemo, useRef, useState } from 'react';
import { assetFor, type Asset, type Definition } from './types';
import {
  ancestors,
  combine,
  extract,
  kind,
  kinds,
  matches,
  paste,
  states,
  uniqueName,
  within,
  type Kind,
  type Similar,
} from './sceneSelection';
const all = Object.keys(kinds) as Kind[];
export function useScene(
  d: Definition,
  assets: Record<string, Asset>,
  change: (d: Definition) => void,
  id: () => string,
  step: number,
  notify: (message: string) => void,
) {
  const [selection, setSelection] = useState<string[]>([]),
    [groupId, setGroup] = useState<string>(),
    [isolation, isolate] = useState<string[] | null>(null);
  const [filters, setFilters] = useState<Kind[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('arena-selection-kinds') ?? 'null');
      if (Array.isArray(v)) return all.filter((k) => v.includes(k));
    } catch {
      /* optional preference */
    }
    return all;
  });
  useEffect(() => {
    try {
      localStorage.setItem('arena-selection-kinds', JSON.stringify(filters));
    } catch {
      /* optional */
    }
  }, [filters]);
  const clip = useRef<ReturnType<typeof extract> | null>(null);
  const { hidden, locked } = useMemo(() => states(d, isolation), [d, isolation]);
  const group = d.groups.find((g) => g.id === groupId);
  const selected = useMemo(() => {
    const existing = new Set(d.objects.map((o) => o.id));
    return group ? within(d, group.id).map((o) => o.id) : selection.filter((k) => existing.has(k));
  }, [d, selection, group]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const objects = useMemo(() => d.objects.filter((o) => selectedSet.has(o.id)), [selectedSet, d]);
  const active = objects.find((o) => o.id === selected.at(-1));
  const eligible = useMemo(
    () =>
      new Set(
        d.objects
          .filter(
            (o) =>
              !locked.has(o.id) && !hidden.has(o.id) && filters.includes(kind(assetFor(assets, o))),
          )
          .map((o) => o.id),
      ),
    [d, assets, hidden, locked, filters],
  );
  const choose = (ids: string[]) => {
    setGroup(undefined);
    setSelection(ids);
  };
  const chooseGroup = (gid: string) => {
    setGroup(gid);
    setSelection([]);
  };
  const groupLocked = (gid?: string) => ancestors(d.groups, gid).some((g) => g.editorLocked);
  const protectedGroup = (gid: string) =>
    groupLocked(gid) ||
    within(d, gid).some((o) => locked.has(o.id)) ||
    d.groups.some((g) => g.editorLocked && ancestors(d.groups, g.id).some((p) => p.id === gid));
  function insert(c: ReturnType<typeof extract>) {
    if (d.objects.length + c.objects.length > 1000 || d.groups.length + c.groups.length > 200) {
      notify('Копия превысит лимит карты: 1000 объектов или 200 групп.');
      return;
    }
    const offset = step || 0.5;
    if (c.objects.some((o) => o.position[0] + offset > 250 || o.position[2] + offset > 250)) {
      notify('Недостаточно места для смещения копии. Переместите оригинал от края карты.');
      return;
    }
    const r = paste(d, c, offset, id);
    // Pasting a copied child of a locked group places it at the root.
    const copyIds = new Set(r.ids);
    for (const o of r.document.objects)
      if (copyIds.has(o.id) && groupLocked(o.group)) o.group = undefined;
    for (const g of r.document.groups.slice(d.groups.length))
      if (groupLocked(g.parent)) g.parent = undefined;
    change(r.document);
    if (r.group) chooseGroup(r.group);
    else choose(r.ids);
  }
  function duplicate() {
    if (group && protectedGroup(group.id)) return;
    const ids = selected.filter((k) => !locked.has(k));
    if (ids.length || group) insert(extract(d, ids, group?.id));
  }
  function copy() {
    if (selected.length || group) clip.current = extract(d, selected, group?.id);
  }
  function remove() {
    if (group && protectedGroup(group.id)) return;
    const del = new Set(selected.filter((k) => !locked.has(k)));
    if (!del.size && !group) return;
    change({
      ...d,
      objects: d.objects.filter((o) => !del.has(o.id)),
      groups: group
        ? d.groups.filter((g) => !ancestors(d.groups, g.id).some((p) => p.id === group.id))
        : d.groups,
    });
    choose([]);
  }
  function makeGroup() {
    const gid = id();
    if (groupLocked(group?.id)) return;
    const children = objects.filter((o) => !locked.has(o.id));
    if (!children.length && !group) return;
    const parent = group
      ? group.parent
      : children.every((o) => o.group === children[0]?.group)
        ? children[0]?.group
        : undefined;
    const name = uniqueName('Группа', new Set(d.groups.map((g) => g.name)));
    change({
      ...d,
      groups: [
        ...d.groups.map((g) => (g.id === group?.id ? { ...g, parent: gid } : g)),
        { id: gid, name, parent },
      ],
      objects: group
        ? d.objects
        : d.objects.map((o) =>
            selectedSet.has(o.id) && !locked.has(o.id) ? { ...o, group: gid } : o,
          ),
    });
    chooseGroup(gid);
  }
  function ungroup() {
    if (!group || protectedGroup(group.id)) return;
    change({
      ...d,
      groups: d.groups
        .filter((g) => g.id !== group.id)
        .map((g) => (g.parent === group.id ? { ...g, parent: group.parent } : g)),
      objects: d.objects.map((o) => (o.group === group.id ? { ...o, group: group.parent } : o)),
    });
    choose(selected);
  }
  function flags(
    key: 'editorHidden' | 'editorLocked',
    value: boolean,
    ids = selected,
    gid: string | null | undefined = group?.id,
  ) {
    if (gid) {
      if (groupLocked(d.groups.find((g) => g.id === gid)?.parent)) return;
      change({ ...d, groups: d.groups.map((g) => (g.id === gid ? { ...g, [key]: value } : g)) });
    } else {
      const targets = new Set(ids);
      change({
        ...d,
        objects: d.objects.map((o) =>
          targets.has(o.id) && !groupLocked(o.group) ? { ...o, [key]: value } : o,
        ),
      });
    }
  }
  function reparent(ids: string[], parent?: string, sourceGroup?: string) {
    if (groupLocked(parent)) return;
    if (sourceGroup) {
      if (
        protectedGroup(sourceGroup) ||
        ancestors(d.groups, parent).some((g) => g.id === sourceGroup)
      )
        return;
      change({ ...d, groups: d.groups.map((g) => (g.id === sourceGroup ? { ...g, parent } : g)) });
    } else {
      const items = new Set(ids);
      change({
        ...d,
        objects: d.objects.map((o) =>
          items.has(o.id) && !locked.has(o.id) ? { ...o, group: parent } : o,
        ),
      });
    }
  }
  function rename(value: string, target: string, isGroup: boolean) {
    const name = value.trim().slice(0, 100);
    if (!name) return;
    if (isGroup && !groupLocked(target))
      change({ ...d, groups: d.groups.map((g) => (g.id === target ? { ...g, name } : g)) });
    else if (!isGroup && !locked.has(target))
      change({ ...d, objects: d.objects.map((o) => (o.id === target ? { ...o, name } : o)) });
  }
  return {
    selected,
    selectedSet,
    objects,
    active,
    group,
    choose,
    chooseGroup,
    chooseObject: (k: string, shift: boolean, toggle: boolean) =>
      choose(combine(selected, [k], shift, toggle)),
    filters,
    setFilters,
    eligible,
    hidden,
    locked,
    isolation,
    isolate,
    selectAll: () => choose([...eligible]),
    invert: () => choose([...eligible].filter((k) => !selectedSet.has(k))),
    similar: (by: Similar) => {
      if (active)
        choose(
          d.objects
            .filter((o) => eligible.has(o.id) && matches(o, active, assets, by))
            .map((o) => o.id),
        );
    },
    duplicate,
    copy,
    paste: () => clip.current && insert(clip.current),
    remove,
    makeGroup,
    ungroup,
    flags,
    reparent,
    rename,
    groupLocked,
    showAll: () => {
      isolate(null);
      change({
        ...d,
        groups: d.groups.map((g) => ({ ...g, editorHidden: false })),
        objects: d.objects.map((o) => ({ ...o, editorHidden: false })),
      });
    },
  };
}
export type SceneControls = ReturnType<typeof useScene>;
