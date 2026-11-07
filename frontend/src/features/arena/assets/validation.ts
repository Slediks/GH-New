import type { AssetDefinition } from './types';
import type { Asset } from '../editor/types';

/** Immediate form feedback; the server always performs the authoritative validation. */
export function draftErrors(d: AssetDefinition, asset: Asset): string[] {
  const errors: string[] = [];
  if (!d.name.trim() || d.name.length > 100) errors.push('Название: от 1 до 100 символов.');
  if (d.transform.scale.some((v) => !Number.isFinite(v) || v < 0.00001 || v > 10000))
    errors.push('Scale: 0,00001–10000.');
  if (d.transform.rotation.some((v) => !Number.isFinite(v) || Math.abs(v) > 360))
    errors.push('Rotation: −360…360°.');
  if (asset.bounds?.flat().some((v) => !Number.isFinite(v) || Math.abs(v) > 250))
    errors.push('Габариты: в пределах ±250 м. Уменьшите scale.');
  for (const role of ['player', 'bullet'] as const) {
    const c = d[role];
    if (
      c.boxes.length > 32 ||
      (c.mode === 'box' && c.boxes.length !== 1) ||
      (c.mode === 'compound' && !c.boxes.length)
    )
      errors.push(`${role}: требуется 1–32 бокса (Custom Box — ровно один).`);
    if (
      c.boxes.some(
        (b) =>
          b.length !== 6 ||
          b.some((v, i) => !Number.isFinite(v) || Math.abs(v) > 250 || (i >= 3 && v < 0.01)),
      )
    )
      errors.push(`${role}: позиция ±250 м, размер 0,01–250 м.`);
  }
  return errors;
}
