import type { ArenaScene } from '../scene';
import type { Manifest } from '../types';
import { buildDataMap } from '../editor/dataScene';

export function buildMap(scene: ArenaScene, world: Manifest) {
  if (!world.definition)
    throw new Error('Версия карты устарела. Вернитесь в комнату и начните новый матч.');
  buildDataMap(scene, world);
}
