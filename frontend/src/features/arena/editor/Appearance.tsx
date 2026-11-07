import { assetFor } from './types';
import { useState } from 'react';
import type { Asset, MapObject, MaterialOverride } from './types';
import { resolveMaterial } from './materials';
import { ColorField } from './ColorField';
import { fingerprint } from './definitionState';

const labels = {
  roughness: 'Шероховатость',
  metallic: 'Металличность',
  emissiveIntensity: 'Сила свечения',
};
export function Appearance({
  objects,
  assets,
  change,
  disabled,
}: {
  objects: MapObject[];
  assets: Record<string, Asset>;
  change: (o: MapObject[]) => void;
  disabled: boolean;
}) {
  const [clipboard, setClipboard] = useState<MapObject['materialOverrides']>();
  if (!objects.length) return null;
  const slots = Object.keys(assetFor(assets, objects[0]).materialSlots ?? {}).filter((id) =>
    objects.every((o) => assetFor(assets, o).materialSlots?.[id]),
  );
  if (!slots.length)
    return <p className="map-appearance-note">У выделения нет общих редактируемых материалов.</p>;
  const update = (slot: string, key: keyof MaterialOverride, value: string | number | undefined) =>
    change(
      objects.map((o) => {
        const materialOverrides = structuredClone(o.materialOverrides ?? {}),
          patch = { ...materialOverrides[slot] };
        if (value === undefined) delete patch[key];
        else Object.assign(patch, { [key]: value });
        if (Object.keys(patch).length) materialOverrides[slot] = patch;
        else delete materialOverrides[slot];
        const next = { ...o };
        if (Object.keys(materialOverrides).length) next.materialOverrides = materialOverrides;
        else delete next.materialOverrides;
        return next;
      }),
    );
  const canPaste =
    clipboard &&
    objects.every((o) =>
      Object.entries(clipboard).every(([slot, values]) => {
        const meta = assetFor(assets, o).materialSlots?.[slot];
        return (
          meta &&
          Object.entries(values).every(([key, value]) =>
            key === 'variant'
              ? !!meta.variants[String(value)]
              : !!meta.fields[key as keyof typeof meta.fields],
          )
        );
      }),
    );
  return (
    <fieldset className="map-appearance" disabled={disabled}>
      <legend>
        Appearance · внешний вид{objects.length > 1 ? ` · ${objects.length} объектов` : ''}
      </legend>
      {slots.map((slot) => {
        const metas = objects.map((o) => assetFor(assets, o).materialSlots![slot]);
        const fields = Object.keys(metas[0].fields).filter((key) =>
          metas.every((m) => m.fields[key as keyof typeof m.fields]),
        );
        const variants = Object.keys(metas[0].variants).filter((key) =>
          metas.every((m) => m.variants[key]),
        );
        const configs = objects.map((o) => {
          const a = assetFor(assets, o),
            part = a.resource.parts.find((p) => (p.slot ?? 'body') === slot) ?? {
              slot,
              color: '#ffffff',
              shape: 'box',
              box: [],
            };
          return resolveMaterial(a, o, part);
        });
        const common = <T,>(values: T[]): T | null =>
          values.every((v) => fingerprint(v) === fingerprint(values[0])) ? values[0] : null;
        const variant = common(
          objects.map((o) => o.materialOverrides?.[slot]?.variant ?? 'default'),
        );
        const changed = (key: keyof MaterialOverride) =>
          objects.some((o) => o.materialOverrides?.[slot]?.[key] !== undefined);
        return (
          <div key={slot}>
            <h4>{metas[0].name}</h4>
            <label>
              Вариант материала
              <select
                aria-label="Вариант материала"
                value={variant ?? 'mixed'}
                onChange={(e) =>
                  update(slot, 'variant', e.target.value === 'default' ? undefined : e.target.value)
                }
              >
                {variant === null && (
                  <option value="mixed" disabled>
                    Разные значения
                  </option>
                )}
                {variants.map((id) => (
                  <option key={id} value={id}>
                    {metas[0].variants[id].name}
                  </option>
                ))}
              </select>
            </label>
            {fields.includes('baseColor') && (
              <>
                <ColorField
                  label="Основной цвет"
                  value={common(configs.map((c) => c.color))}
                  onChange={(v) => update(slot, 'baseColor', v)}
                />
                <button
                  disabled={disabled || !changed('baseColor')}
                  onClick={() => update(slot, 'baseColor', undefined)}
                >
                  Сбросить цвет
                </button>
              </>
            )}
            {(['roughness', 'metallic', 'emissiveIntensity'] as const)
              .filter((key) => fields.includes(key))
              .map((key) => {
                const range = metas.map((m) => m.fields[key] as [number, number]);
                const low = Math.max(...range.map((r) => r[0])),
                  high = Math.min(...range.map((r) => r[1]));
                const value = common(configs.map((c) => c[key === 'metallic' ? 'metalness' : key]));
                return (
                  <label key={key}>
                    {labels[key]}
                    {changed(key) ? ' •' : ''}
                    <input
                      aria-label={labels[key]}
                      type="number"
                      step={0.05}
                      min={low}
                      max={high}
                      value={value ?? ''}
                      placeholder="Mixed"
                      onChange={(e) => {
                        const n = e.currentTarget.valueAsNumber;
                        if (Number.isFinite(n) && n >= low && n <= high) update(slot, key, n);
                      }}
                    />
                    <input
                      aria-label={labels[key] + ' — ползунок'}
                      type="range"
                      min={low}
                      max={high}
                      step={0.01}
                      value={value ?? low}
                      onChange={(e) => update(slot, key, +e.target.value)}
                    />
                  </label>
                );
              })}
            {fields.includes('emissiveColor') && (
              <>
                <ColorField
                  label="Цвет свечения"
                  value={common(configs.map((c) => c.emissive))}
                  onChange={(v) => update(slot, 'emissiveColor', v)}
                />
                <small>Свечение поверхности не создаёт источник света.</small>
              </>
            )}
          </div>
        );
      })}
      <div className="map-appearance-actions">
        <button
          disabled={disabled || !objects.some((o) => o.materialOverrides)}
          onClick={() =>
            change(
              objects.map((o) => {
                const next = { ...o };
                delete next.materialOverrides;
                return next;
              }),
            )
          }
        >
          Сбросить материал целиком
        </button>
        <button
          disabled={disabled || objects.length !== 1}
          onClick={() => setClipboard(structuredClone(objects[0].materialOverrides ?? {}))}
        >
          Копировать оформление
        </button>
        <button
          disabled={disabled || !canPaste}
          title="Доступно для совместимых параметров и вариантов"
          onClick={() =>
            change(
              objects.map((o) => {
                const next = { ...o };
                if (clipboard && Object.keys(clipboard).length)
                  next.materialOverrides = structuredClone(clipboard);
                else delete next.materialOverrides;
                return next;
              }),
            )
          }
        >
          Вставить оформление
        </button>
      </div>
    </fieldset>
  );
}
