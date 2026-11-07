import { useState } from 'react';
import { uniformScale } from './placement';
import { InstanceText } from './TextFields';
import type { Asset, Definition, MapObject, Vec3 } from './types';
import { modes, type Mode } from '../types';
export function NumberField({
  label,
  value,
  onChange,
  min = -250,
  max = 250,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label>
      {label}
      <input
        key={value}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        step={step}
        onBlur={(e) => {
          const n = e.currentTarget.valueAsNumber;
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
          else e.currentTarget.value = String(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function VectorFields({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="map-vector">
        {value.map((v, i) => (
          <NumberField
            key={i}
            label={['X', 'Y', 'Z'][i]}
            value={v}
            min={min}
            max={max}
            step={step}
            onChange={(n) => onChange(value.map((x, j) => (j === i ? n : x)) as Vec3)}
          />
        ))}
      </div>
    </fieldset>
  );
}
export function Inspector({
  object,
  asset,
  definition,
  change,
  changeDefinition,
}: {
  object?: MapObject;
  asset?: Asset;
  definition: Definition;
  change: (v: MapObject) => void;
  changeDefinition: (d: Definition) => void;
}) {
  const [uniform, setUniform] = useState(false);
  if (!object || !asset) {
    const env = definition.environment,
      set = (v: Partial<typeof env>) =>
        changeDefinition({ ...definition, environment: { ...env, ...v } });
    return (
      <>
        <h3>Карта и окружение</h3>
        <label>
          Название
          <input
            value={definition.metadata.name}
            maxLength={100}
            onChange={(e) =>
              changeDefinition({
                ...definition,
                metadata: { ...definition.metadata, name: e.target.value },
              })
            }
          />
        </label>
        <label>
          Описание
          <textarea
            value={definition.metadata.description}
            maxLength={1000}
            onChange={(e) =>
              changeDefinition({
                ...definition,
                metadata: { ...definition.metadata, description: e.target.value },
              })
            }
          />
        </label>
        <fieldset>
          <legend>Режимы</legend>
          {Object.entries(modes).map(([id, name]) => (
            <label className="map-check" key={id}>
              <input
                type="checkbox"
                checked={definition.settings.modes.includes(id as Mode)}
                onChange={(e) =>
                  changeDefinition({
                    ...definition,
                    settings: {
                      ...definition.settings,
                      modes: e.target.checked
                        ? [...definition.settings.modes, id as Mode]
                        : definition.settings.modes.filter((m) => m !== id),
                    },
                  })
                }
              />
              {name}
            </label>
          ))}
        </fieldset>
        <label>
          Возрождение в TDM
          <select
            value={definition.settings.respawnPolicy ?? 'team'}
            onChange={(e) =>
              changeDefinition({
                ...definition,
                settings: {
                  ...definition.settings,
                  respawnPolicy: e.target.value as 'team' | 'neutral',
                },
              })
            }
          >
            <option value="team">Точки своей команды</option>
            <option value="neutral">Нейтральные точки</option>
          </select>
        </label>
        <label className="map-check">
          <input
            type="checkbox"
            checked={!!definition.settings.respawnFallback}
            onChange={(e) =>
              changeDefinition({
                ...definition,
                settings: { ...definition.settings, respawnFallback: e.target.checked },
              })
            }
          />
          Искать свободное место, если все точки заняты
        </label>
        <label className="map-check">
          <input
            type="checkbox"
            checked={env.ground !== false}
            onChange={(e) => set({ ground: e.target.checked })}
          />
          Базовая плоскость земли
        </label>
        <label>
          Свет от земли
          <input
            type="color"
            value={env.ambientGround ?? '#6f766d'}
            onChange={(e) => set({ ambientGround: e.target.value })}
          />
        </label>
        <label>
          Цвет солнца
          <input
            type="color"
            value={env.sunColor ?? '#ffe9c7'}
            onChange={(e) => set({ sunColor: e.target.value })}
          />
        </label>
        <NumberField
          label="Дальность камеры, м"
          value={env.cameraFar ?? 300}
          min={100}
          max={600}
          onChange={(cameraFar) => set({ cameraFar })}
        />
        <fieldset>
          <legend>Область теней солнца, м</legend>
          {(env.sunShadow ?? [-30, 30, 26, -26, 0.5, 85]).map((value, i) => (
            <NumberField
              key={i}
              label={['Лево', 'Право', 'Верх', 'Низ', 'Ближняя граница', 'Дальняя граница'][i]}
              value={value}
              min={i >= 4 ? 0.01 : -250}
              max={500}
              onChange={(v) =>
                set({
                  sunShadow: (env.sunShadow ?? [-30, 30, 26, -26, 0.5, 85]).map((n, j) =>
                    j === i ? v : n,
                  ) as NonNullable<typeof env.sunShadow>,
                })
              }
            />
          ))}
        </fieldset>
        <label>
          Небо
          <input
            type="color"
            value={env.background}
            onChange={(e) => set({ background: e.target.value })}
          />
        </label>
        <label>
          Рассеянный свет
          <input
            type="color"
            value={env.ambientColor}
            onChange={(e) => set({ ambientColor: e.target.value })}
          />
        </label>
        <NumberField
          label="Сила рассеянного света"
          value={env.ambientIntensity}
          min={0}
          max={10}
          onChange={(ambientIntensity) => set({ ambientIntensity })}
        />
        <NumberField
          label="Сила солнца"
          value={env.sunIntensity}
          min={0}
          max={10}
          onChange={(sunIntensity) => set({ sunIntensity })}
        />
        <VectorFields
          label="Солнце: направление"
          value={env.sunPosition}
          min={-250}
          max={250}
          onChange={(sunPosition) => set({ sunPosition })}
        />
        <label className="map-check">
          <input
            type="checkbox"
            checked={env.fogEnabled}
            onChange={(e) => set({ fogEnabled: e.target.checked })}
          />
          Туман
        </label>
        <NumberField
          label="Начало тумана, м"
          value={env.fogNear}
          min={1}
          max={500}
          onChange={(fogNear) => set({ fogNear })}
        />
        <NumberField
          label="Конец тумана, м"
          value={env.fogFar}
          min={env.fogNear + 1}
          max={600}
          onChange={(fogFar) => set({ fogFar })}
        />
      </>
    );
  }
  const o = object,
    p = { ...asset.defaults, ...o.properties };
  const props = (v: Partial<MapObject['properties']>) =>
    change({ ...o, properties: { ...p, ...v } });
  const toggles: [keyof MapObject['properties'], string][] = [['enabled', 'Включён']];
  if (asset.kind === 'prop')
    toggles.push(['visible', 'Виден в игре'], ['castShadow', 'Отбрасывает тень']);
  if (asset.classification === 'gameplay')
    toggles.push(['collision', 'Блокирует движение'], ['blocksBullets', 'Блокирует выстрелы']);
  if (['point', 'spot', 'directional'].includes(asset.kind))
    toggles.push(['castShadow', 'Тени источника']);
  return (
    <>
      <h3>Инспектор объекта</h3>
      {asset.textSlots && Object.keys(asset.textSlots).length > 0 && (
        <InstanceText
          slots={asset.textSlots}
          overrides={o.textOverrides}
          change={(textOverrides) => change({ ...o, textOverrides })}
        />
      )}
      <label>
        Имя
        <input
          value={o.name}
          maxLength={100}
          onChange={(e) => change({ ...o, name: e.target.value })}
        />
      </label>
      <small>
        {asset.name} · v{asset.version}
        <br />
        {o.id}
        <br />
        Коллизия: {asset.collisionPreset}
      </small>
      <VectorFields
        label="Позиция, м"
        value={o.position}
        min={-250}
        max={250}
        onChange={(position) =>
          change({
            ...o,
            position,
          })
        }
      />
      <fieldset disabled={asset.transformLimits?.rotate === false}>
        <VectorFields
          label="Поворот, °"
          value={o.rotation}
          min={-3600}
          max={3600}
          step={0.01}
          onChange={(rotation) => change({ ...o, rotation })}
        />
      </fieldset>
      <fieldset disabled={asset.transformLimits?.scale === false}>
        <label>
          <input type="checkbox" checked={uniform} onChange={(e) => setUniform(e.target.checked)} />
          Сохранять пропорции масштаба
        </label>
        <VectorFields
          label="Масштаб"
          value={o.scale}
          min={asset.transformLimits?.minScale ?? 0.05}
          max={asset.transformLimits?.maxScale ?? 50}
          onChange={(scale) =>
            change({ ...o, scale: uniform ? uniformScale(o.scale, scale) : scale })
          }
        />
      </fieldset>
      <label>
        Группа
        <select
          value={o.group ?? ''}
          onChange={(e) => change({ ...o, group: e.target.value || undefined })}
        >
          <option value="">Без группы</option>
          {definition.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      {toggles.map(([key, label]) => (
        <label className="map-check" key={key}>
          <input
            type="checkbox"
            checked={!!p[key]}
            onChange={(e) => props({ [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
      {asset.kind === 'spawn' && (
        <>
          <label>
            Команда
            <select value={p.team} onChange={(e) => props({ team: e.target.value })}>
              <option>Alpha</option>
              <option>Bravo</option>
              <option value="neutral">Deathmatch</option>
            </select>
          </label>
          {Object.entries(modes).map(([id, name]) => (
            <label className="map-check" key={id}>
              <input
                type="checkbox"
                checked={p.modes?.includes(id as Mode) ?? false}
                onChange={(e) =>
                  props({
                    modes: e.target.checked
                      ? [...(p.modes ?? []), id as Mode]
                      : (p.modes ?? []).filter((m) => m !== id),
                  })
                }
              />
              {name}
            </label>
          ))}
        </>
      )}
      {['point', 'spot', 'directional'].includes(asset.kind) && (
        <>
          <label>
            Цвет света
            <input
              type="color"
              value={p.color}
              onChange={(e) => props({ color: e.target.value })}
            />
          </label>
          <NumberField
            label="Интенсивность"
            value={p.intensity ?? 1}
            min={0}
            max={200}
            onChange={(intensity) => props({ intensity })}
          />
          <NumberField
            label="Дальность, м"
            value={p.range ?? 20}
            min={1}
            max={150}
            onChange={(range) => props({ range })}
          />
        </>
      )}
    </>
  );
}
