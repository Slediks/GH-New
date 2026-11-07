import { NumberField, VectorFields } from '../editor/Inspector';
import { TextFields } from '../editor/TextFields';
import { newSlot, type TextSlots, type TextSlot } from '../editor/textSlots';
export function TextLayout({
  slots,
  change,
  selected,
  select,
}: {
  slots: TextSlots;
  change: (s: TextSlots) => void;
  selected: string;
  select: (s: string) => void;
}) {
  const slot = slots[selected];
  const update = (patch: Partial<TextSlot>) =>
    change({ ...slots, [selected]: { ...slot, ...patch } });
  return (
    <>
      <h3>Текстовые области</h3>
      <p>
        Положение задано в метрах относительно объекта. Лицевая сторона направлена по локальной оси
        +Z.
      </p>
      <label>
        Область
        <select value={selected} onChange={(e) => select(e.target.value)}>
          <option value="">Выберите область</option>
          {Object.entries(slots).map(([k, s]) => (
            <option key={k} value={k}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={Object.keys(slots).length >= 8}
        onClick={() => {
          let i = 1;
          while (slots['label_' + i]) i++;
          const id = 'label_' + i;
          change({ ...slots, [id]: newSlot() });
          select(id);
        }}
      >
        Добавить текстовую область
      </button>
      {slot && (
        <>
          <label>
            Название области
            <input
              maxLength={64}
              value={slot.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>
          <VectorFields
            label="Центр области, м"
            value={slot.position}
            min={-250}
            max={250}
            onChange={(position) => update({ position })}
          />
          <VectorFields
            label="Ориентация, °"
            value={slot.rotation}
            min={-360}
            max={360}
            onChange={(rotation) => update({ rotation })}
          />
          {(['width', 'height', 'offset'] as const).map((k, i) => (
            <NumberField
              key={k}
              label={['Ширина, м', 'Высота, м', 'Отступ от поверхности, м'][i]}
              min={k === 'offset' ? 0 : 0.01}
              max={k === 'offset' ? 0.1 : 50}
              step={k === 'offset' ? 0.001 : 0.01}
              value={slot[k]}
              onChange={(v) => update({ [k]: v })}
            />
          ))}
          <NumberField
            label="Лимит символов"
            min={1}
            max={256}
            step={1}
            value={slot.maxLength}
            onChange={(n) =>
              update({
                maxLength: Math.floor(n),
                defaults: { ...slot.defaults, text: slot.defaults.text.slice(0, n) },
              })
            }
          />
          <label>
            <input
              type="checkbox"
              checked={slot.multiline}
              onChange={(e) =>
                update({
                  multiline: e.target.checked,
                  defaults: {
                    ...slot.defaults,
                    text: e.target.checked
                      ? slot.defaults.text
                      : slot.defaults.text.replace(/\n/g, ' '),
                  },
                })
              }
            />
            Несколько строк
          </label>
          <TextFields
            slot={slot}
            value={slot.defaults}
            change={(v) => update({ defaults: { ...slot.defaults, ...v } })}
          />
          <button
            onClick={() => {
              const next = { ...slots };
              delete next[selected];
              change(next);
              select('');
            }}
          >
            Удалить область
          </button>
        </>
      )}
    </>
  );
}
