import { useEffect, useState } from 'react';
import type { Preferences } from './types';
import {
  actionLabels,
  allowedKey,
  defaultPreferences,
  readPreferences,
  type Action,
} from './preferences';
export function useArenaPreferences() {
  const [value, setValue] = useState(readPreferences);
  useEffect(() => {
    localStorage.setItem('arena-preferences', JSON.stringify(value));
  }, [value]);
  return [value, setValue] as const;
}
export function PlayerSettings({
  value,
  onChange,
}: {
  value: Preferences;
  onChange: (v: Preferences) => void;
}) {
  const [error, setError] = useState('');
  return (
    <details className="arena-player-settings">
      <summary>Настройки игрока</summary>
      <div className="arena-preferences">
        {(
          [
            ['sensitivity', 'Чувствительность мыши', 0.2, 3, 0.1],
            ['adsSensitivity', 'Чувствительность в прицеле', 0.1, 2, 0.05],
            ['fov', 'Поле зрения', 70, 100, 1],
            ['volume', 'Общая громкость', 0, 1, 0.05],
            ['effects', 'Громкость эффектов', 0, 1, 0.05],
          ] as const
        ).map(([key, label, min, max, step]) => (
          <label key={key}>
            {label} · {value[key]}
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value[key]}
              onChange={(e) => onChange({ ...value, [key]: +e.target.value })}
            />
          </label>
        ))}
        <label>
          Качество графики
          <select
            value={value.scale}
            onChange={(e) =>
              onChange({ ...value, scale: +e.target.value, shadows: +e.target.value > 0.65 })
            }
          >
            <option value="0.65">Low · 65%, без теней</option>
            <option value="0.8">Medium · 80%</option>
            <option value="1">High · 100%</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.shadows}
            onChange={(e) => onChange({ ...value, shadows: e.target.checked })}
          />
          Тени
        </label>
      </div>
      <p>Чувствительность в прицеле — множитель обычной: 0,65 означает 65% её скорости.</p>
      <p>
        Нажмите поле и новую клавишу. Escape и 1–4 зарезервированы; системные сочетания не
        назначаются.
      </p>
      <div className="arena-preferences">
        {(Object.keys(actionLabels) as Action[]).map((action) => (
          <label key={action}>
            {actionLabels[action]}
            <input
              readOnly
              aria-label={`Клавиша: ${actionLabels[action]}`}
              value={value.bindings[action]}
              onKeyDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (
                  e.altKey ||
                  e.metaKey ||
                  (e.ctrlKey && !e.code.startsWith('Control')) ||
                  !allowedKey(e.code)
                ) {
                  setError('Эта клавиша или системное сочетание недоступны');
                  return;
                }
                const conflict = (Object.keys(actionLabels) as Action[]).find(
                  (k) => k !== action && value.bindings[k] === e.code,
                );
                if (conflict) {
                  setError(`Клавиша уже назначена: ${actionLabels[conflict]}`);
                  return;
                }
                setError('');
                onChange({ ...value, bindings: { ...value.bindings, [action]: e.code } });
              }}
            />
          </label>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <button
        onClick={() => {
          onChange(defaultPreferences());
          setError('');
        }}
      >
        Сбросить настройки Arena
      </button>
    </details>
  );
}
