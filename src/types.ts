// Доменная модель v4. Все размеры — в миллиметрах.
//
// Ключевое отличие v4: размеры детей сплита — АБСОЛЮТНЫЕ мм, а не относительные
// веса. Поэтому перетаскивание перегородки меняет только два смежных проёма,
// а остальные перегородки группы стоят на месте. Пропорциональный пересчёт
// всего дерева происходит только при изменении габарита контейнера целиком.

export type WallId = 'left' | 'center' | 'right';

// ---------------------------------------------------------------- faces

export interface LeafOpen {
  kind: 'open';
  /** ниша: видно нутро и полки */
  shelves: number;
  /** если задано — шаг полки от низа отсека */
  shelfPitch?: number | null;
}
export interface LeafDoor {
  kind: 'door';
  hinge: 'left' | 'right';
  /** стеклянная створка */
  glass?: boolean;
  fill?: string;
}
export interface LeafDrawers {
  kind: 'drawers';
  /** число выдвижных ящиков на высоту отсека */
  drawers: number;
  fill?: string;
}
export interface LeafPanel {
  kind: 'panel';
  fill?: string;
}

export type LeafFace = LeafOpen | LeafDoor | LeafDrawers | LeafPanel;

// ---------------------------------------------------------------- дерево

export interface LeafNode {
  type: 'leaf';
  id: string;
  face: LeafFace;
}

export interface SplitChild {
  /** размер вдоль оси сплита, мм (абсолютный) */
  size: number;
  node: BoxNode;
}

/** Купейная система: раздвижные створки поверх секции целиком. */
export interface SlidingSpec {
  /** число створок, 2..6 */
  doors: number;
  fill?: string;
  glass?: boolean;
  /** нахлёст створок, мм (стандарт купейных систем) */
  overlap?: number;
}

export interface SplitNode {
  type: 'split';
  /** v: дети слева направо (ось — ширина); h: сверху вниз (ось — высота) */
  dir: 'v' | 'h';
  /** толщина перегородки между детьми, мм */
  t: number;
  children: SplitChild[];
  /** купейные двери поверх всей секции (опционально) */
  sliding?: SlidingSpec | null;
}

export type BoxNode = LeafNode | SplitNode;

// ---------------------------------------------------------------- проект

export interface WardModule {
  id: string;
  wall: WallId;
  from: number;
  w: number;
  h: number;
  depth: number;
  /**
   * Боковая стенка общая с соседним модулем: на стыке одна панель 18 мм,
   * каждый модуль «владеет» её половиной (9 мм). false — своя панель 18 мм.
   */
  leftShared: boolean;
  rightShared: boolean;
  root: BoxNode;
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
  version: 4;
  name: string;
  ceiling: number;
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

// ---------------------------------------------------------------- утилиты дерева

export type Path = number[];

export function pathEq(a: Path | null, b: Path | null): boolean {
  if (!a || !b) return !a && !b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function pathKey(path: Path): string {
  return path.join('.');
}

export function getNode(root: BoxNode, path: Path): BoxNode | null {
  let n: BoxNode = root;
  for (const i of path) {
    if (n.type !== 'split' || i < 0 || i >= n.children.length) return null;
    n = n.children[i].node;
  }
  return n;
}

export function isLeafFrontOpen(node: BoxNode | null): boolean {
  return !!node && node.type === 'leaf' && node.face.kind === 'open';
}
