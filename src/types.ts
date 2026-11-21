// Доменная модель v3. Все размеры — в миллиметрах.
// Идея: модуль — это короб (контейнер), внутри — дерево нарезки:
//_split_ (вертикальная/горизонтальная, с толщиной перегородки) и _лист_ (отсек
// с лицом: ниша с полками, дверь, ящики, панель).

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
  /** размер вдоль оси сплита (мм, относительный — layout нормализует под короб) */
  size: number;
  node: BoxNode;
}

export interface SplitNode {
  type: 'split';
  /** v: дети слева направо; h: сверху вниз */
  dir: 'v' | 'h';
  /** толщина перегородки между детьми */
  t: number;
  children: SplitChild[];
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
  version: 3;
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
  if (!a || !b) return a === b || (!a && !b);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function getNode(root: BoxNode, path: Path): BoxNode | null {
  let n: BoxNode = root;
  for (const i of path) {
    if (n.type !== 'split' || i < 0 || i >= n.children.length) return null;
    n = n.children[i].node;
  }
  return n;
}

export function parentSplit(root: BoxNode, path: Path): { split: SplitNode; index: number } | null {
  if (path.length === 0) return null;
  const parentPath = path.slice(0, -1);
  const parent = getNode(root, parentPath);
  const index = path[path.length - 1];
  if (parent?.type === 'split' && index >= 0 && index < parent.children.length) {
    return { split: parent, index };
  }
  return null;
}

export function newLeaf(face?: Partial<LeafFace> & { kind?: LeafFace['kind'] }): LeafNode {
  const kind = face?.kind ?? 'open';
  const base: LeafFace =
    kind === 'door'
      ? { kind: 'door', hinge: 'left', ...(face as object) }
      : kind === 'drawers'
        ? { kind: 'drawers', drawers: 3, ...(face as object) }
        : kind === 'panel'
          ? { kind: 'panel', ...(face as object) }
          : { kind: 'open', shelves: 0, shelfPitch: null, ...(face as object) };
  return { type: 'leaf', id: uid('l'), face: base as LeafFace };
}

export function isLeafFrontOpen(node: BoxNode | null): boolean {
  return !!node && node.type === 'leaf' && node.face.kind === 'open';
}
