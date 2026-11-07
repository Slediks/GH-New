import type { Zone } from './model';
const GRID = {
  x: 72,
  y: 20,
  columns: 12,
  rows: 3,
  cellWidth: 64,
  cellHeight: 70,
  zeroWidth: 60,
  columnWidth: 72,
  bandHeight: 50,
  streetGap: 26,
  bandGap: 2,
  bottomPadding: 12,
};
const { x: gridX, y: gridY, cellWidth, cellHeight } = GRID;
const numberWidth = GRID.columns * cellWidth;
const numberHeight = GRID.rows * cellHeight;
const bottom = gridY + numberHeight;
const dozenY = bottom + GRID.streetGap + GRID.bandHeight / 2;
const outsideY = dozenY + GRID.bandHeight + GRID.bandGap;
// Hit strips leave independent targets at cell centers and intersections.
const HIT = { strip: 20, junction: 24, edgeHeight: 28 };
export const BOARD = {
  width: gridX + numberWidth + GRID.columnWidth,
  height: outsideY + GRID.bandHeight / 2 + GRID.bottomPadding,
};
export type Area = {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
  label: string;
  number?: number;
};
const center = (number: number) => ({
  x: gridX + (Math.floor((number - 1) / GRID.rows) + 0.5) * cellWidth,
  y: gridY + (GRID.rows - 1 - ((number - 1) % GRID.rows) + 0.5) * cellHeight,
});
const area = (
  key: string,
  x: number,
  y: number,
  width: number,
  height: number,
  layer: number,
  label = '',
): Area => ({ key, x, y, width, height, layer, label });
// Every area uses the authoritative zone ID/numbers returned by the API.
// Coordinates follow the single desktop board grid, including the zero boundary.
export function tableAreas(zones: Record<string, Zone>): Area[] {
  return Object.entries(zones)
    .map(([key, zone]) => {
      const [type, index] = key.split(':');
      const n = Number(index);
      if (type === 'number')
        return {
          ...area(
            key,
            n ? center(n).x : gridX - GRID.zeroWidth / 2,
            n ? center(n).y : gridY + numberHeight / 2,
            n ? cellWidth : GRID.zeroWidth,
            n ? cellHeight : numberHeight,
            0,
            String(n),
          ),
          number: n,
        };
      if (type === 'column')
        return area(
          key,
          gridX + numberWidth + GRID.columnWidth / 2,
          gridY + (GRID.rows - 1 - n + 0.5) * cellHeight,
          GRID.columnWidth,
          cellHeight,
          0,
          '2 : 1',
        );
      if (type === 'dozen')
        return area(
          key,
          gridX + ((n + 0.5) * numberWidth) / 3,
          dozenY,
          numberWidth / 3,
          GRID.bandHeight,
          0,
          `${n * 12 + 1}–${n * 12 + 12}`,
        );
      const outside = ['low', 'even', 'red', 'black', 'odd', 'high'].indexOf(key);
      if (outside >= 0)
        return area(
          key,
          gridX + ((outside + 0.5) * numberWidth) / 6,
          outsideY,
          numberWidth / 6,
          GRID.bandHeight,
          0,
          ['1–18', 'ЧЁТ', '◆ КРАСНОЕ', '◆ ЧЁРНОЕ', 'НЕЧЁТ', '19–36'][outside],
        );
      if (type === 'street')
        return area(key, center(n).x, bottom, cellWidth - HIT.junction, HIT.edgeHeight, 2, '');
      if (type === 'six')
        return area(key, center(n).x + cellWidth / 2, bottom, HIT.junction, HIT.edgeHeight, 3);
      if (key === 'first_four') return area(key, gridX, bottom, HIT.junction, HIT.edgeHeight, 3);
      if (type === 'trio')
        return area(
          key,
          gridX,
          gridY + (GRID.rows - n) * cellHeight,
          HIT.junction,
          HIT.junction,
          3,
        );
      if (type === 'split' && zone.numbers[0] === 0)
        return area(key, gridX, center(zone.numbers[1]).y, HIT.strip, cellHeight - HIT.junction, 2);
      const cells = zone.numbers.map(center);
      const x = cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length;
      const y = cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length;
      if (type === 'corner') return area(key, x, y, HIT.junction, HIT.junction, 3);
      if (type === 'split')
        return area(
          key,
          x,
          y,
          cells[0].x === cells[1].x ? cellWidth - HIT.junction : HIT.strip,
          cells[0].x === cells[1].x ? HIT.strip : cellHeight - HIT.junction,
          2,
        );
      throw new Error(`Unsupported roulette zone: ${key}`);
    })
    .sort((a, b) => a.layer - b.layer);
}
export const areaStyle = (area: Area) => ({
  left: `${(100 * (area.x - area.width / 2)) / BOARD.width}%`,
  top: `${(100 * (area.y - area.height / 2)) / BOARD.height}%`,
  width: `${(100 * area.width) / BOARD.width}%`,
  height: `${(100 * area.height) / BOARD.height}%`,
  zIndex: area.layer + 1,
});
