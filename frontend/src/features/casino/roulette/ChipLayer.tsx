import { points } from '../../../shared/api';
import { BOARD, type Area } from './geometry';
import type { Zone } from './model';
export function ChipLayer({
  areas,
  totals,
  zones,
  result,
}: {
  areas: Area[];
  totals: Record<string, number>;
  zones: Record<string, Zone>;
  result?: number;
}) {
  return (
    <div className="roulette-chips-layer" aria-hidden="true">
      {areas
        .filter((area) => totals[area.key])
        .map((area) => (
          <i
            key={area.key}
            className={`roulette-chip-mark ${result !== undefined && zones[area.key].numbers.includes(result) ? 'winning' : ''}`}
            data-chip-zone={area.key}
            style={{
              left: `${(100 * area.x) / BOARD.width}%`,
              top: `${(100 * area.y) / BOARD.height}%`,
            }}
          >
            {points(totals[area.key])}
          </i>
        ))}
    </div>
  );
}
