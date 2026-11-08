import type { Mode } from '../types';
export type Vec3 = [number, number, number];
export interface MaterialOverride {
  variant?: string;
  baseColor?: string;
  roughness?: number;
  metallic?: number;
  emissiveColor?: string;
  emissiveIntensity?: number;
}
export interface MaterialSlot {
  name: string;
  base?: Omit<MaterialOverride, 'variant'>;
  fields: Partial<Record<Exclude<keyof MaterialOverride, 'variant'>, true | [number, number]>>;
  variants: Record<string, { name: string; values: Omit<MaterialOverride, 'variant'> }>;
}
export interface MapObject {
  editorLocked?:boolean; editorHidden?:boolean;
  textOverrides?: import('./textSlots').TextOverrides;
  id: string;
  assetId: string;
  assetVersion: number;
  name: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  group?: string;
  materialOverrides?: Record<string, MaterialOverride>;
  properties: {
    visible?: boolean;
    collision?: boolean;
    blocksBullets?: boolean;
    castShadow?: boolean;
    receiveShadow?: boolean;
    enabled?: boolean;
    team?: string;
    modes?: Mode[];
    intensity?: number;
    range?: number;
    color?: string;
  };
}
export interface Definition {
  schemaVersion: 1;
  metadata: { name: string; description: string };
  environment: {
    background: string;
    ambientColor: string;
    ambientIntensity: number;
    sunPosition: Vec3;
    sunIntensity: number;
    fogEnabled: boolean;
    fogNear: number;
    fogFar: number;
    ambientGround?: string;
    sunColor?: string;
    sunShadow?: number[];
    ground?: boolean;
    cameraFar?: number;
  };
  objects: MapObject[];
  prefabInstances?: PrefabInstance[];
  groups: { id: string; name: string;parent?:string;editorLocked?:boolean;editorHidden?:boolean }[];
  settings: { modes: Mode[]; respawnPolicy?: 'team' | 'neutral'; respawnFallback?: boolean };
}
export interface PrefabInstance {
  id: string;
  name: string;
  prefabId: string;
  revision: number;
  position: Vec3;
  rotation: Vec3;
  scale: number;
  group?: string;
  editorHidden?: boolean;
  editorLocked?: boolean;
  overrides?: Record<string, {
    materialOverrides?: Record<string, MaterialOverride>;
    textOverrides?: import('./textSlots').TextOverrides;
    properties?: Pick<MapObject['properties'], 'visible' | 'enabled' | 'intensity' | 'color'>;
  }>;
}
export interface PrefabRow {
  id: string;
  name: string;
  category: string;
  revision: number;
  draftVersion: number;
  status: string;
  updatedAt: number;
  ownerLogin?: string;
  editable?: boolean;
}
export interface Asset {
  snapPoints?: Vec3[];
  transformLimits?:{rotate?:boolean;scale?:boolean;minScale?:number;maxScale?:number};
  textSlots?: import('./textSlots').TextSlots;
  deprecated?: boolean;
  origin?: 'system' | 'custom';
  available?: boolean;
  internal?: boolean;
  tags?: string[];
  bounds?: number[][];
  performance?: Record<string, number>;
  warnings?: string[];
  id: string;
  version: number;
  name: string;
  category: string;
  kind: string;
  classification: string;
  rotationStep: number;
  collisionPreset: string;
  bulletPreset: string;
  resource: {
    model?: string;
    node?: string;
    preserveMaterials?: boolean;
    panelBackgrounds?:Record<string,'stripe'|'border'>;
    effect?: {
      count: number;
      color: string;
      size: number;
      opacity: number;
      height: number;
      speed: number;
      spread: number;
      baseRadius: number;
      rotationSpeed: number;
    };
    transform?: { rotation: Vec3; scale: Vec3; offset: Vec3 };
    parts: { shape: string; box: number[]; color: string; slot?: string }[];
  };
  materialSlots?: Record<string, MaterialSlot>;
  colliders: number[][];
  bulletColliders?: number[][];
  defaultScale: Vec3;
  defaults: MapObject['properties'];
}
export function assetFor(assets: Record<string, Asset>, object: MapObject): Asset {
  return assets[`${object.assetId}@${object.assetVersion}`] ?? assets[object.assetId];
}
export function assetRegistry(list: Asset[]) {
  const result: Record<string, Asset> = {};
  for (const a of list) {
    result[`${a.id}@${a.version}`] = a;
    if (!result[a.id] || a.version > result[a.id].version) result[a.id] = a;
  }
  return result;
}
export interface MapRow {
  id: string;
  name: string;
  status: string;
  revision: number;
  draftVersion: number;
  updatedAt?: number;
  updatedBy?: string;
  system: boolean;
  ownerUserId: string;
  ownerLogin: string;
  accessRole: 'admin' | 'owner' | 'editor' | 'viewer';
}
export interface Draft extends MapRow {
  definition: Definition;
}
export interface Report {
  errors: string[];
  warnings: string[];
  objects: number;
  colliders: number;
  bulletColliders: number;
  lights: number;
  shadowLights: number;
  decorations: number;
}
