import type { MaterialOverride, MaterialSlot } from '../editor/types';
import type { AssetDefinition } from './types';
import { ColorField } from '../editor/ColorField';

const capabilities: MaterialSlot['fields'] = {
  baseColor: true,
  roughness: [0, 1],
  metallic: [0, 1],
  emissiveColor: true,
  emissiveIntensity: [0, 3],
};
export function AssetMaterials({
  definition,
  change,
  selected,
  select,
}: {
  definition: AssetDefinition;
  change: (d: AssetDefinition) => void;
  selected: Record<string, string>;
  select: (slot: string, variant: string) => void;
}) {
  const update = (id: string, slot: MaterialSlot) =>
    change({ ...definition, materialSlots: { ...definition.materialSlots, [id]: slot } });
  return (
    <>
      {Object.entries(definition.materialSlots).map(([id, slot]) => (
        <details key={id} open>
          <summary>
            {slot.name} · {id}
          </summary>
          <small>
            Imported PBR · texture сохраняется при изменении цвета. Цвет умножается на текстуру.
          </small>
          {Object.entries(capabilities).map(([key, range]) => (
            <label className="asset-check" key={key}>
              <input
                type="checkbox"
                checked={!!slot.fields[key as keyof typeof capabilities]}
                onChange={(e) => {
                  const fields = { ...slot.fields };
                  if (e.target.checked) Object.assign(fields, { [key]: range });
                  else delete fields[key as keyof typeof fields];
                  update(id, { ...slot, fields });
                }}
              />
              Разрешить {key}
            </label>
          ))}
          <h4>Варианты материала</h4>
          <label>
            Вариант в preview
            <select value={selected[id] ?? 'default'} onChange={(e) => select(id, e.target.value)}>
              {Object.entries(slot.variants).map(([key, v]) => (
                <option key={key} value={key}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          {Object.entries(slot.variants).map(([key, v]) => {
            const updateValue = (
              field: keyof MaterialOverride,
              value: string | number | undefined,
            ) => {
              const values = { ...v.values };
              if (value === undefined) delete values[field as keyof typeof values];
              else Object.assign(values, { [field]: value });
              update(id, { ...slot, variants: { ...slot.variants, [key]: { ...v, values } } });
            };
            return (
              <fieldset key={key}>
                <legend>
                  {v.name}
                  {key === 'default' ? ' · исходный' : ''}
                </legend>
                {key !== 'default' && (
                  <>
                    <label>
                      Название
                      <input
                        value={v.name}
                        maxLength={60}
                        onChange={(e) =>
                          update(id, {
                            ...slot,
                            variants: { ...slot.variants, [key]: { ...v, name: e.target.value } },
                          })
                        }
                      />
                    </label>
                    {(['baseColor', 'emissiveColor'] as const).map((field) => (
                      <ColorField
                        key={field}
                        label={field}
                        value={v.values[field] ?? slot.base?.[field] ?? '#ffffff'}
                        onChange={(value) => updateValue(field, value)}
                      />
                    ))}
                    {(['roughness', 'metallic', 'emissiveIntensity'] as const).map((field) => (
                      <label key={field}>
                        {field}
                        <input
                          type="number"
                          min={0}
                          max={field === 'emissiveIntensity' ? 3 : 1}
                          step={0.05}
                          value={v.values[field] ?? slot.base?.[field] ?? 0}
                          onChange={(e) => updateValue(field, +e.target.value)}
                        />
                      </label>
                    ))}
                    <button
                      onClick={() => {
                        const variants = { ...slot.variants };
                        delete variants[key];
                        update(id, { ...slot, variants });
                      }}
                    >
                      Удалить вариант
                    </button>
                  </>
                )}
              </fieldset>
            );
          })}
          <button
            disabled={Object.keys(slot.variants).length >= 20}
            onClick={() => {
              const key = 'variant_' + Date.now();
              update(id, {
                ...slot,
                variants: { ...slot.variants, [key]: { name: 'Новый вариант', values: {} } },
              });
            }}
          >
            Добавить вариант
          </button>
        </details>
      ))}
    </>
  );
}
