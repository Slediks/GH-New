import { useEffect, useState } from 'react';
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const color = value ?? '#808080';
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return (
    <fieldset className="map-color-field">
      <legend>
        {label}
        {value === null ? ' · разные значения' : ''}
      </legend>
      <div className="map-color-line">
        <input
          aria-label={label + ' — палитра'}
          type="color"
          value={color}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
        />
        <input
          aria-label={label + ' — HEX'}
          value={text}
          placeholder={value === null ? 'Mixed' : '#RRGGBB'}
          maxLength={7}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          onBlur={() => setText(value ?? '')}
        />
      </div>
      <div className="map-vector">
        {rgb.map((v, i) => (
          <label key={i}>
            {['R', 'G', 'B'][i]}
            <input
              key={color}
              aria-label={label + ' — ' + ['R', 'G', 'B'][i]}
              type="number"
              min={0}
              max={255}
              step={1}
              placeholder={value === null ? '—' : undefined}
              defaultValue={value === null ? '' : v}
              onBlur={(e) => {
                const n = e.currentTarget.valueAsNumber;
                if (Number.isInteger(n) && n >= 0 && n <= 255) {
                  const next = rgb.map((c, j) => (j === i ? n : c));
                  onChange('#' + next.map((c) => c.toString(16).padStart(2, '0')).join(''));
                } else e.currentTarget.value = value === null ? '' : String(v);
              }}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
