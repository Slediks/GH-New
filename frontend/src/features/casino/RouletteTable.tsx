import { useMemo, useState } from 'react';
import { points } from '../../shared/api';
import { areaStyle, BOARD, tableAreas } from './roulette/geometry';
import { chipTotals, rouletteColor, type Chip, type Zone } from './roulette/model';
import { ChipLayer } from './roulette/ChipLayer';
import './roulette.css';
export { rouletteColor } from './roulette/model';
export { RouletteWheel } from './roulette/RouletteWheel';

export function RouletteTable({
  zones,
  chips,
  disabled,
  amount,
  setAmount,
  bet,
  undo,
  clear,
  result,
}: {
  zones: Record<string, Zone>;
  chips: Chip[];
  disabled: boolean;
  amount: string;
  setAmount: (value: string) => void;
  bet: (zone: string) => void;
  undo: () => void;
  clear: () => void;
  result?: number;
}) {
  const [hoveredZone, setFocus] = useState<string | null>(null);
  const focus = disabled ? null : hoveredZone;
  const areas = useMemo(() => tableAreas(zones), [zones]);
  const totals = chipTotals(chips);
  const highlighted = new Set(focus ? zones[focus]?.numbers : []);
  return (
    <div className="roulette-table">
      <div className="roulette-chip-tray" aria-label="Номинал фишки">
        {[1, 5, 10, 25, 100, 500].map((value, index) => (
          <button
            key={value}
            type="button"
            disabled={disabled}
            className={`roulette-chip denomination-${index} ${amount === String(value) ? 'selected' : ''}`}
            aria-pressed={amount === String(value)}
            onClick={() => setAmount(String(value))}
          >
            {value}
          </button>
        ))}
        <label className="roulette-manual-stake">
          Ставка / фишка, шейкели
          <input
            inputMode="decimal"
            value={amount}
            disabled={disabled}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
      </div>
      <div className="roulette-table-heading">
        <span>EUROPEAN ROULETTE</span>
        <small>
          {disabled
            ? 'Стол закрыт для ставок'
            : 'Центр — число · граница — сплит · пересечение — группа'}
        </small>
      </div>
      <div className="roulette-board-scroll">
        <div
          className="roulette-layout"
          style={{ aspectRatio: `${BOARD.width} / ${BOARD.height}` }}
          aria-label="Поле ставок европейской рулетки"
        >
          {areas.map((area) => {
            const zone = zones[area.key];
            const isNumber = area.number !== undefined;
            return (
              <button
                key={area.key}
                type="button"
                data-zone={area.key}
                disabled={disabled}
                className={`roulette-bet ${area.layer ? 'roulette-boundary' : 'roulette-cell'} ${isNumber ? rouletteColor(area.number!) : area.key === 'red' || area.key === 'black' ? area.key : ''} ${isNumber && highlighted.has(area.number!) ? 'highlighted' : ''} ${focus === area.key ? 'aimed' : ''} ${isNumber && result === area.number ? 'winning' : ''}`}
                style={areaStyle(area)}
                onClick={() => bet(area.key)}
                onMouseEnter={() => setFocus(area.key)}
                onMouseLeave={() => setFocus(null)}
                onFocus={() => setFocus(area.key)}
                onBlur={() => setFocus(null)}
                aria-label={`${zone.label}, полный возврат ×${zone.multiplier}${totals[area.key] ? `, поставлено ${points(totals[area.key])} шейкелей` : ''}`}
              >
                {area.label || <span className="roulette-junction" aria-hidden="true" />}
              </button>
            );
          })}
          <ChipLayer areas={areas} totals={totals} zones={zones} result={result} />
        </div>
      </div>
      <div className="roulette-table-footer">
        <span aria-live="polite">
          {focus
            ? `${zones[focus].label} · возврат ×${zones[focus].multiplier}`
            : 'Стриты и линии — на нижнем краю числового поля. Выплаты включают возврат ставки.'}
        </span>
        <div>
          <button type="button" disabled={disabled || !chips.length} onClick={undo}>
            ↶ Последняя
          </button>
          <button type="button" disabled={disabled || !chips.length} onClick={clear}>
            Очистить
          </button>
        </div>
      </div>
    </div>
  );
}
