export const ART = {
  classic: ['🍒', '🍋', '🔔', '7', '◆', 'W', '✦'],
  cascade: ['🍒', '🍋', '🔔', '◆'],
  hold: ['·', '◆', '·', '✧'],
  lock: ['◆', '⚡', '◉'],
  streak: ['❄', '🔥'],
  wheel: ['◆', '♣', '🔔', '7', '🎡'],
};
export type Variant = keyof typeof ART;
export const SLOT_DESCRIPTIONS: Record<string, string> = {
  slots_classic: 'Комбинации на пяти линиях, Wild и бесплатные вращения.',
  slots_cascade: 'Разрушайте группы символов и продолжайте цепочку каскадов.',
  slots_hold: 'Закрепляйте монеты и заполняйте золотой сейф.',
  slots_lock: 'Выбирайте целые барабаны для фиксации перед повторным вращением.',
  slots_streak: 'Заберите банк серии или рискните им на следующей ступени.',
  slots_wheel: 'Собирайте жетоны и превращайте их в собственное бонусное колесо.',
};
export const TITLES = {
  classic: 'ROYAL SEVENS · ПЯТЬ ЛИНИЙ',
  cascade: 'CRYSTAL FALLS · КАСКАДЫ',
  hold: 'GOLD VAULT · НАКОПЛЕНИЕ',
  lock: 'MAGNET LAB · ЛИПКИЕ БАРАБАНЫ',
  streak: 'HOT RUN · ГОРЯЧАЯ СЕРИЯ',
  wheel: 'WHEEL FORGE · СОБЕРИ СВОЁ КОЛЕСО',
};
export const LINES = [
  [0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
];
export interface Frame {
  grid?: number[][];
  wins?: { line: number; count: number }[];
  payout?: number;
  accumulated: number;
  runes?: number[];
  chest?: number;
  removed?: number[][];
  multipliers?: number[];
  coins?: Record<string, number>;
  lives?: number;
  spin?: number;
  free?: boolean;
  locked?: number[];
}
export function displayGrid(frame: Frame | undefined, variant: Variant): string[][] {
  if (frame?.grid) return frame.grid.map((column) => column.map((symbol) => ART[variant][symbol]));
  if (frame?.coins)
    return Array.from({ length: 5 }, (_, col) =>
      Array.from({ length: 3 }, (_, row) => {
        const value = frame.coins![row * 5 + col];
        return value ? `◆ ×${value}` : '·';
      }),
    );
  return Array.from({ length: 5 }, (_, col) =>
    Array.from(
      { length: variant === 'cascade' ? 4 : 3 },
      (_, row) => ART[variant][(col + row) % ART[variant].length],
    ),
  );
}
export function isWinning(frame: Frame | undefined, col: number, row: number, lines = LINES) {
  return !!(
    frame?.wins?.some((win) => col < win.count && lines[win.line]?.[col] === row) ||
    frame?.removed?.[col]?.includes(row) ||
    frame?.coins?.[row * 5 + col]
  );
}
