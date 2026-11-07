import type { Asset, MaterialSlot, Vec3 } from '../editor/types';
export interface AssetDefinition {
  textSlots?: import('../editor/textSlots').TextSlots;
  schemaVersion: 1;
  name: string;
  description: string;
  category: string;
  tags: string[];
  resource: string;
  importInfo: {
    bounds: number[][];
    materialSlots: Record<string, MaterialSlot>;
    performance: Record<string, number>;
    warnings: string[];
  };
  transform: { rotation: Vec3; scale: Vec3; offset: Vec3; pivot: 'bottom' | 'center' | 'custom' };
  player: { mode: string; boxes: number[][] };
  bullet: { mode: string; boxes: number[][] };
  castShadow: boolean;
  receiveShadow: boolean;
  materialSlots: Record<string, MaterialSlot>;
}
export interface AssetRow {
  id: string;
  name: string;
  category: string;
  tags: string[];
  status: string;
  revision: number;
  draftVersion: number;
}
export interface AssetDraft extends AssetRow {
  definition: AssetDefinition;
  asset: Asset;
}
