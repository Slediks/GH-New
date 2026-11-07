import { assetFor, type Asset, type Definition, type MapObject } from './types';
export type Group = Definition['groups'][number];
export type Kind = 'geometry' | 'decoration' | 'gameplay' | 'lights' | 'text' | 'volumes';
export const kinds: Record<Kind, string> = {
  geometry: 'Геометрия',
  decoration: 'Декор',
  gameplay: 'Игровые',
  lights: 'Свет',
  text: 'Надписи',
  volumes: 'Области',
};
export function kind(a: Asset): Kind {
  if (a.kind === 'playable' || a.kind === 'excluded') return 'volumes';
  if (['point', 'spot', 'directional'].includes(a.kind)) return 'lights';
  if (a.kind === 'spawn') return 'gameplay';
  if (Object.keys(a.textSlots ?? {}).length) return 'text';
  return a.classification === 'decoration' ? 'decoration' : 'geometry';
}
export function combine(current: string[], hits: string[], shift = false, toggle = false) {
  if (!hits.length && !shift && !toggle) return [];
  if (toggle) {
    const s = new Set(current);
    for (const id of hits) {
      if (s.has(id)) s.delete(id);
      else s.add(id);
    }
    return [...s];
  }
  return shift ? [...current.filter((id) => !hits.includes(id)), ...hits] : [...new Set(hits)];
}
export function ancestors(groups: Group[], id?: string) {
  const chain: Group[] = [];
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const g = groups.find((g) => g.id === id);
    if (!g) break;
    chain.push(g);
    id = g.parent;
  }
  return chain;
}
export function within(d: Definition, id: string) {
  return d.objects.filter((o) => ancestors(d.groups, o.group).some((g) => g.id === id));
}
export function states(d: Definition, isolate: string[] | null) {
  const hidden = new Set<string>(),
    locked = new Set<string>(),
    only = isolate && new Set(isolate);
  for (const o of d.objects) {
    const path = ancestors(d.groups, o.group);
    if (o.editorHidden || path.some((g) => g.editorHidden) || (only && !only.has(o.id)))
      hidden.add(o.id);
    if (o.editorLocked || path.some((g) => g.editorLocked)) locked.add(o.id);
  }
  return { hidden, locked };
}
export type Similar = 'asset' | 'category' | 'group' | 'kind' | 'variant';
export function matches(o: MapObject, ref: MapObject, assets: Record<string, Asset>, by: Similar) {
  const a = assetFor(assets, o),
    b = assetFor(assets, ref);
  if (by === 'asset') return o.assetId === ref.assetId;
  if (by === 'category') return a.category === b.category;
  if (by === 'group') return o.group === ref.group;
  if (by === 'kind') return kind(a) === kind(b);
  const variants = (obj: MapObject) =>
    Object.entries(obj.materialOverrides ?? {})
      .filter(([, v]) => v.variant)
      .map(([slot, v]) => slot + ':' + v.variant)
      .sort()
      .join('|');
  return o.assetId === ref.assetId && variants(o) === variants(ref);
}
export function uniqueName(base: string, names: Set<string>) {
  const clean = base.replace(/ \(\d+\)$/, '').slice(0, 92);
  let value = clean,
    index = 1;
  while (names.has(value)) value = clean + ' (' + ++index + ')';
  names.add(value);
  return value;
}
export function extract(d: Definition, ids: string[], group?: string) {
  const groups = group
    ? d.groups.filter((g) => ancestors(d.groups, g.id).some((p) => p.id === group))
    : [];
  return structuredClone({
    groups,
    objects: d.objects.filter((o) => ids.includes(o.id)),
    root: group,
  });
}
export function paste(
  d: Definition,
  clip: ReturnType<typeof extract>,
  offset: number,
  id: () => string,
) {
  const names = new Set(d.objects.map((o) => o.name)),
    groupNames = new Set(d.groups.map((g) => g.name));
  const groupIds = new Map(clip.groups.map((g) => [g.id, id()]));
  const parent = (key?: string) =>
    key ? (groupIds.get(key) ?? (d.groups.some((g) => g.id === key) ? key : undefined)) : undefined;
  const groups = clip.groups.map((g) => ({
    ...structuredClone(g),
    id: groupIds.get(g.id)!,
    name: uniqueName(g.name, groupNames),
    parent: parent(g.parent),
  }));
  const objects = clip.objects.map((o) => ({
    ...structuredClone(o),
    id: id(),
    group: parent(o.group),
    name: uniqueName(o.name, names),
    position: [
      o.position[0] + offset,
      o.position[1],
      o.position[2] + offset,
    ] as MapObject['position'],
  }));
  return {
    document: { ...d, groups: [...d.groups, ...groups], objects: [...d.objects, ...objects] },
    ids: objects.map((o) => o.id),
    group: clip.root ? groupIds.get(clip.root) : undefined,
  };
}
