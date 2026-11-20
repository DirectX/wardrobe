// Доменная модель v2. Все размеры — в миллиметрах.
// Базовая единица — ячейка (секция) модуля: ширина, полки, опциональный фасад.

export type WallId = 'left' | 'center' | 'right';

export type FacadeKind = 'door' | 'drawer' | 'panel' | 'glass';

export interface Cell {
  /** ширина секции, мм; сумма ширин ячеек = ширина модуля */
  w: number;
  /** null — открытая секция (полки на виду) */
  facade: FacadeKind | null;
  hinge: 'left' | 'right';
  /** ключ палитры FACADE_FILLS или hex */
  fill?: string;
  /** число полок при ручной раскладке */
  shelves: number;
  /** если задано — высота одного отсека, полки считаются по ней */
  shelfPitch: number | null;
  /** число ящиков для facade='drawer' */
  drawers: number;
}

export type ModuleKind = 'wardrobe' | 'shelves' | 'drawers' | 'open' | 'tv-niche';

export interface WardModule {
  id: string;
  wall: WallId;
  /** левый торец вдоль стены (для боковых стен — от внутреннего угла) */
  from: number;
  w: number;
  h: number;
  depth: number;
  kind: ModuleKind;
  cells: Cell[];
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
  version: 2;
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
