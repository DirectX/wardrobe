// Доменная модель. Все размеры — в миллиметрах.

export type WallId = 'left' | 'center' | 'right';

export type CellType = 'door' | 'drawer' | 'open' | 'glass' | 'panel';

export interface FacadeCell {
  type: CellType;
  hinge?: 'left' | 'right';
  /** ключ палитры FACADE_FILLS или hex */
  fill?: string;
}

/** Ряд фасада; высота ряда = (h - плинтус) * weight / сумма весов. Ряды сверху вниз. */
export interface FacadeRow {
  weight: number;
  cells: FacadeCell[];
}

export type ModuleKind = 'wardrobe' | 'shelves' | 'drawers' | 'open' | 'tv-niche';

export interface WardModule {
  id: string;
  wall: WallId;
  /** левый торец вдоль стены, мм (отсчёт от внутреннего угла для боковых стен, от левого угла для центральной) */
  from: number;
  w: number;
  h: number;
  depth: number;
  kind: ModuleKind;
  facade: FacadeRow[];
}

export interface TvSpec {
  wall: WallId;
  centerX: number;
  centerY: number;
  w: number;
  h: number;
}

export interface SocketSpec {
  id: string;
  wall: WallId;
  x: number;
  y: number;
}

export interface WallSpec {
  length: number;
}

export interface Project {
  version: 1;
  name: string;
  ceiling: number;
  /** плинтус (цколь), мм */
  base: number;
  grid: number;
  walls: Record<WallId, WallSpec>;
  modules: WardModule[];
  tv: TvSpec | null;
  sockets: SocketSpec[];
}

export interface Issue {
  level: 'error' | 'warn';
  message: string;
  refs: string[];
}

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
