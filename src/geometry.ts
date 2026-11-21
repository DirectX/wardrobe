import type { BoxNode, LeafNode, Project, Path, SplitNode, WallId, WardModule } from './types.ts';

export const WALLS: WallId[] = ['left', 'center', 'right'];
/** визуальный зазор между раскрытыми фасадами стен, мм */
export const WALL_GAP = 180;
/** толщина корпуса/перегородки по умолчанию, мм */
export const CARCASS_T = 18;

export function wallStart(p: Project): Record<WallId, number> {
  const center = p.walls.left.length + WALL_GAP;
  return {
    left: 0,
    center,
    right: center + p.walls.center.length + WALL_GAP,
  };
}

export function totalElevationWidth(p: Project): number {
  return p.walls.left.length + p.walls.center.length + p.walls.right.length + WALL_GAP * 2;
}

export function wallAtX(p: Project, xGlobal: number): { wall: WallId; local: number } | null {
  const s = wallStart(p);
  for (const w of WALLS) {
    const a = s[w];
    if (xGlobal >= a - 45 && xGlobal <= a + p.walls[w].length + 45)
      return { wall: w, local: clamp(xGlobal - a, 0, p.walls[w].length) };
  }
  return null;
}

export function snap(p: Project, v: number): number {
  if (p.grid <= 0) return Math.round(v);
  return Math.round(v / p.grid) * p.grid;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export function modulesOn(p: Project, wall: WallId): WardModule[] {
  return p.modules.filter((m) => m.wall === wall).sort((a, b) => a.from - b.from);
}

export function wallEnd(m: WardModule): number {
  return m.from + m.w;
}

export function findModule(p: Project, id: string): WardModule | undefined {
  return p.modules.find((m) => m.id === id);
}

// ------------------------------------------------------------------ углы

/**
 * Симметричные угловые зоны. Модуль, задвинутый в угол на любой стене,
 * занимает уголковый квадрат и резервирует на СМЕЖНОЙ стене зону своей глубины.
 * start/end — сколько мм от начала/конца стены занято.
 *  - у боковой стены угол только один — с центральной (её начало, from=0);
 *  - у центральной стены два угла: начало — с левой, конец — с правой.
 */
export function cornerZones(p: Project, wall: WallId): { start: number; end: number } {
  const Lc = p.walls.center.length;
  const maxDepth = (pred: (m: WardModule) => boolean, ws: WallId[]): number => {
    let d = 0;
    for (const m of p.modules) if (ws.includes(m.wall) && pred(m)) d = Math.max(d, m.depth);
    return d;
  };
  if (wall === 'left' || wall === 'right') {
    const start = maxDepth(
      (m) => (wall === 'left' ? m.from <= 1 : wallEnd(m) >= Lc - 1),
      ['center'],
    );
    return { start: Math.min(start, p.walls[wall].length), end: 0 };
  }
  const start = maxDepth((m) => m.from <= 1, ['left']);
  const end = maxDepth((m) => m.from <= 1, ['right']);
  return {
    start: Math.min(start, Lc),
    end: Math.min(end, Lc - start),
  };
}

// ------------------------------------------------------------------ раскладка

export interface LeafBox {
  path: Path;
  /** координаты в системе стены: x — от начала стены, y — от пола */
  x: number;
  y: number;
  w: number;
  h: number;
  leaf: LeafNode;
}

export interface DividerBox {
  /** путь сплита */
  path: Path;
  /** разделитель после ребёнка с этим индексом */
  after: number;
  dir: 'v' | 'h';
  x: number;
  y: number;
  w: number;
  h: number;
  /** масштаб: размер из дерева * scale = размер на чертеже */
  scale: number;
  /** суммарный размер пары детей (с разделителем) в чертёжных мм */
  pairLen: number;
}

export function interiorBox(p: Project, m: WardModule) {
  const T = CARCASS_T;
  return {
    x: m.from + T,
    y: p.base + T,
    w: Math.max(10, m.w - 2 * T),
    h: Math.max(10, m.h - p.base - 2 * T),
  };
}

export function layoutModule(p: Project, m: WardModule): { leaves: LeafBox[]; dividers: DividerBox[] } {
  const leaves: LeafBox[] = [];
  const dividers: DividerBox[] = [];
  const box = interiorBox(p, m);

  const place = (node: BoxNode, x: number, y: number, w: number, h: number, path: Path) => {
    if (node.type === 'leaf') {
      leaves.push({ path, x, y, w, h, leaf: node });
      return;
    }
    const split = node;
    const n = split.children.length;
    if (n === 0) return;
    const axisLen = split.dir === 'v' ? w : h;
    const t = Math.max(0, split.t);
    const avail = Math.max(10, axisLen - t * (n - 1));
    const sum = split.children.reduce((s, c) => s + Math.max(0, c.size), 0) || 1;
    const scale = avail / sum;
    let cursor = split.dir === 'v' ? x : y;
    split.children.forEach((child, i) => {
      const len = Math.max(0, child.size) * scale;
      if (split.dir === 'v') {
        place(child.node, cursor, y, len, h, [...path, i]);
        if (i < n - 1) {
          dividers.push({
            path, after: i, dir: 'v',
            x: cursor + len, y, w: t, h,
            scale, pairLen: 0,
          });
        }
        cursor += len + t;
      } else {
        place(child.node, x, cursor, w, len, [...path, i]);
        if (i < n - 1) {
          dividers.push({
            path, after: i, dir: 'h',
            x, y: cursor + len, w, h: t,
            scale, pairLen: 0,
          });
        }
        cursor += len + t;
      }
    });
    // pairLen для соседей (чтобы тяга границы не трогала остальных)
    for (const d of dividers.filter((d) => samePathArr(d.path, path))) {
      const a = split.children[d.after];
      const b = split.children[d.after + 1];
      if (a && b) d.pairLen = (Math.max(0, a.size) + Math.max(0, b.size)) * scale + t;
    }
  };

  place(m.root, box.x, box.y, box.w, box.h, []);
  return { leaves, dividers };
}

function samePathArr(a: Path, b: Path): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Найти лист в точке (xLocal — от начала стены, yFloor — от пола). */
export function leafAtPoint(
  p: Project,
  m: WardModule,
  xLocal: number,
  yFloor: number,
): { leaf: LeafNode; path: Path } | null {
  const { leaves } = layoutModule(p, m);
  for (const lb of leaves) {
    if (xLocal >= lb.x - 0.5 && xLocal <= lb.x + lb.w + 0.5 && yFloor >= lb.y - 0.5 && yFloor <= lb.y + lb.h + 0.5)
      return { leaf: lb.leaf, path: lb.path };
  }
  return null;
}

/** Высоты полок внутри листа (от пола). */
export function shelfYsIn(bottom: number, height: number, shelves: number, pitch?: number | null): number[] {
  const top = bottom + height;
  const ys: number[] = [];
  const inner0 = bottom + 16;
  const inner1 = top - 16;
  if (inner1 - inner0 <= 0) return ys;
  if (pitch && pitch > 0) {
    for (let y = bottom + pitch; y < top - 8; y += pitch) ys.push(y);
    return ys;
  }
  const n = Math.max(0, Math.round(shelves));
  for (let i = 1; i <= n; i++) ys.push(inner0 + ((inner1 - inner0) * i) / (n + 1));
  return ys;
}

export function countLeaves(node: BoxNode): number {
  return node.type === 'leaf' ? 1 : node.children.reduce((s, c) => s + countLeaves(c.node), 0);
}

export function findSplit(root: BoxNode, path: Path): SplitNode | null {
  let n: BoxNode = root;
  for (const i of path) {
    if (n.type !== 'split' || i < 0 || i >= n.children.length) return null;
    n = n.children[i].node;
  }
  return n.type === 'split' ? n : null;
}

// ------------------------------------------------------------------ packing

/**
 * Расставить модули стены вокруг anchor: толкаем соседей влево и вправо.
 * @returns false, если втиснуть не удалось.
 */
export function resolveAround(p: Project, wall: WallId, anchor: WardModule): boolean {
  const z = cornerZones(p, wall);
  const ms = modulesOn(p, wall)
    .slice()
    .sort((a, b) => a.from - b.from || (a.id === anchor.id ? -1 : b.id === anchor.id ? 1 : 0));
  const i = ms.findIndex((m) => m.id === anchor.id);
  let bound = wallEnd(anchor);
  for (let j = i + 1; j < ms.length; j++) {
    const m = ms[j];
    if (m.from < bound) m.from = bound;
    bound = wallEnd(m);
  }
  bound = anchor.from;
  for (let j = i - 1; j >= 0; j--) {
    const m = ms[j];
    if (wallEnd(m) > bound) m.from = bound - m.w;
    bound = m.from;
  }
  return ms.every(
    (m) => m.from >= z.start - 0.5 && wallEnd(m) <= p.walls[wall].length - z.end + 0.5,
  );
}
