import { assetFor, type Asset, type MapObject } from './types';
import { fonts, type TextStyle } from './textSlots';
import { ColorField } from './ColorField';
export function MultiInspector({
  objects,
  assets,
  change,
}: {
  objects: MapObject[];
  assets: Record<string, Asset>;
  change: (v: MapObject[]) => void;
}) {
  const models = objects.map((o) => assetFor(assets, o)),
    mixed = <T,>(vs: T[]) => (vs.every((v) => v === vs[0]) ? vs[0] : undefined);
  const props = ['enabled', 'visible', 'castShadow'] as const;
  const slots = models.every((a) => a.id === models[0].id && a.version === models[0].version)
    ? models[0].textSlots
    : {};
  return (
    <>
      <h3>Выделено · {objects.length}</h3>
      <small>
        Манипулятор сохраняет расположение набора. Поля ниже задают значение всем выделенным
        объектам.
      </small>
      {(['position', 'rotation', 'scale'] as const)
        .filter(
          (k) =>
            k === 'position' ||
            models.every(
              (a) => a.transformLimits?.[k === 'rotation' ? 'rotate' : 'scale'] !== false,
            ),
        )
        .map((k) => (
          <fieldset key={k}>
            <legend>
              {{ position: 'Положение, м', rotation: 'Поворот, °', scale: 'Масштаб' }[k]}
            </legend>
            <div className="map-vector">
              {[0, 1, 2].map((i) => {
                const value = mixed(objects.map((o) => o[k][i]));
                return (
                  <label key={i}>
                    {'XYZ'[i]}
                    <input
                      type="number"
                      step="any"
                      key={objects.map((o) => o[k][i]).join(',')}
                      placeholder="Mixed"
                      defaultValue={value ?? ''}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      onBlur={(e) => {
                        const n = e.target.valueAsNumber;
                        if (!Number.isFinite(n) || n === value) return;
                        const valid = models.every((a) =>
                          k === 'scale'
                            ? n >= (a.transformLimits?.minScale ?? 0.05) &&
                              n <= (a.transformLimits?.maxScale ?? 50)
                            : Math.abs(n) <= (k === 'rotation' ? 3600 : 250),
                        );
                        if (valid)
                          change(
                            objects.map((o) => ({
                              ...o,
                              [k]: o[k].map((v, j) => (j === i ? n : v)),
                            })),
                          );
                        else e.target.value = String(value ?? '');
                      }}
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      {props
        .filter((k) => models.every((a) => k === 'enabled' || k in a.defaults))
        .map((k) => {
          const v = mixed(objects.map((o, i) => o.properties[k] ?? models[i].defaults[k]));
          return (
            <label key={k}>
              {{ enabled: 'Включён', visible: 'Виден в игре', castShadow: 'Отбрасывает тень' }[k]}
              <select
                value={v === undefined ? 'mixed' : String(v)}
                onChange={(e) =>
                  change(
                    objects.map((o) => ({
                      ...o,
                      properties: { ...o.properties, [k]: e.target.value === 'true' },
                    })),
                  )
                }
              >
                <option disabled value="mixed">
                  Mixed
                </option>
                <option value="true">Да</option>
                <option value="false">Нет</option>
              </select>
            </label>
          );
        })}
      {Object.entries(slots ?? {}).map(([id, slot]) => {
        const values = objects.map((o) => ({ ...slot.defaults, ...o.textOverrides?.[id] }));
        const patch = (v: Partial<TextStyle>) =>
          change(
            objects.map((o) => ({
              ...o,
              textOverrides: { ...o.textOverrides, [id]: { ...o.textOverrides?.[id], ...v } },
            })),
          );
        return (
          <fieldset key={id}>
            <legend>Текст · {slot.name}</legend>
            <label>
              Шрифт
              <select
                value={mixed(values.map((v) => v.fontId)) ?? ''}
                onChange={(e) => patch({ fontId: e.target.value as TextStyle['fontId'] })}
              >
                <option value="" disabled>
                  Mixed
                </option>
                {Object.keys(fonts).map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <ColorField
              label="Цвет надписи"
              value={mixed(values.map((v) => v.color)) ?? null}
              onChange={(color) => patch({ color })}
            />
            <label>
              Размер, %
              <input
                type="number"
                min={5}
                max={100}
                placeholder="Mixed"
                key={values.map((v) => v.size).join(',')}
                defaultValue={mixed(values.map((v) => v.size * 100)) ?? ''}
                onBlur={(e) => {
                  const n = e.target.valueAsNumber;
                  if (n >= 5 && n <= 100) patch({ size: n / 100 });
                }}
              />
            </label>
          </fieldset>
        );
      })}
    </>
  );
}
