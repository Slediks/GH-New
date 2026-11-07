import { useState } from 'react';
import { ColorField } from './ColorField';
import {
  fonts,
  type TextSlot,
  type TextStyle,
  type TextSlots,
  type TextOverrides,
} from './textSlots';

export function TextFields({
  slot,
  value,
  change,
}: {
  slot: TextSlot;
  value: TextStyle;
  change: (v: Partial<TextStyle>) => void;
}) {
  const input = slot.multiline ? (
    <textarea
      value={value.text}
      maxLength={slot.maxLength}
      onChange={(e) => change({ text: e.target.value })}
    />
  ) : (
    <input
      value={value.text}
      maxLength={slot.maxLength}
      onChange={(e) => change({ text: e.target.value })}
    />
  );
  return (
    <>
      <label>Текст надписи{input}</label>
      <label>
        Шрифт
        <select
          value={value.fontId}
          onChange={(e) => change({ fontId: e.target.value as TextStyle['fontId'] })}
        >
          {Object.keys(fonts).map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>
      <label>
        Размер, % высоты
        <input
          type="range"
          min="5"
          max="100"
          value={Math.round(value.size * 100)}
          onChange={(e) => change({ size: Number(e.target.value) / 100 })}
        />
        {Math.round(value.size * 100)}%
      </label>
      <ColorField
        label="Цвет надписи"
        value={value.color}
        onChange={(color) => change({ color })}
      />
      <label>
        Выравнивание
        <select
          value={value.alignment}
          onChange={(e) => change({ alignment: e.target.value as TextStyle['alignment'] })}
        >
          <option value="left">Слева</option>
          <option value="center">По центру</option>
          <option value="right">Справа</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.bold}
          onChange={(e) => change({ bold: e.target.checked })}
        />
        Полужирный
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => change({ enabled: e.target.checked })}
        />
        Показывать надпись
      </label>
    </>
  );
}
let copied: TextOverrides | undefined;
export function InstanceText({
  slots,
  overrides = {},
  change,
}: {
  slots: TextSlots;
  overrides?: TextOverrides;
  change: (o: TextOverrides) => void;
}) {
  const [, refresh] = useState(0);
  return (
    <fieldset>
      <legend>Текст</legend>
      {Object.entries(slots).map(([id, s]) => (
        <details key={id} open>
          <summary>{s.name}</summary>
          <TextFields
            slot={s}
            value={{ ...s.defaults, ...overrides[id] }}
            change={(patch) => change({ ...overrides, [id]: { ...overrides[id], ...patch } })}
          />
          <button
            type="button"
            onClick={() => {
              const next = { ...overrides };
              delete next[id];
              change(next);
            }}
          >
            Сбросить надпись
          </button>
        </details>
      ))}
      <button
        type="button"
        onClick={() => {
          copied = structuredClone(overrides);
          refresh((n) => n + 1);
        }}
      >
        Копировать параметры текста
      </button>
      <button
        type="button"
        disabled={
          !copied ||
          Object.entries(copied).some(
            ([id, p]) =>
              !slots[id] ||
              (p.text?.length ?? 0) > slots[id].maxLength ||
              (!slots[id].multiline && p.text?.includes('\n')),
          )
        }
        onClick={() => copied && change(structuredClone(copied))}
      >
        Вставить параметры текста
      </button>
    </fieldset>
  );
}
