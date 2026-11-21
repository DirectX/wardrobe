import type { BoxNode, LeafNode, Project, Path, SplitNode, WallId, WardModule } from './types.ts';
import { getNode } from './types.ts';

export const WALLS: WallId[] = ['left', 'center', 'right'];
/** визуальный зазор между раскрытыми фасадами стен, мм */
export const WALL_GAP = 180;
/** толщина корпуса/перегородки по умолчанию, мм */
export const CARCASS_T = 18;
/** половина общей стенки — каждый соседний модуль владеет 9 мм */
export const HALF_WALL = CARCASS_T / 2;

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

/**
 * Фактическая толщина левой/правой стенки модуля в мм:
 *  - общая с соседом → 9 (половина панели 18)
 *  - своя → 18
 */
export function wallT(m: WardModule, side: 'l' | 'r'): number {
  return side === 'l'
    ? m.leftShared
      ? HALF_WALL
      : CARCASS_T
    : m.rightShared
      ? HALF_WALL
      : CARCASS_T;
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
}

/**
 * Внутренняя полезная зона модуля с учётом общих/своих стенок.
 * Общая стенка = 9 мм на каждый модуль стыка.
 */
export function interiorBox(p: Project, m: WardModule) {
  const tL = wallT(m, 'l');
  const tR = wallT(m, 'r');
  const T = CARCASS_T;
  return {
    x: m.from + tL,
    y: p.base + T,
    w: Math.max(10, m.w - tL - tR),
    h: Math.max(10, m.h - p.base - 2 * T),
  };
}

/**
 * Раскладка дерева в абсолютные координаты.
 * child.size — мм вдоль оси сплита. Если сумма children.size + (n-1)*t ≠ axisLen,
 * выполняется ПРОПОРЦИОНАЛЬНАЯ нормализация (это нужно только при ресайзе модуля).
 */
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
    const sum = split.children.reduce((s, c) => s + Math.max(0, c.size), 0);
    // АБСОЛЮТНАЯ раскладка: каждый ребёнок рисуется строго своим размером,
    // расхождение (drift) отдаётся последнему. Соседние ряды не пересчитываются.
    const drift = avail - sum;
    let cursor = split.dir === 'v' ? x : y;
    split.children.forEach((child, i) => {
      let len = Math.max(0, child.size);
      if (i === n - 1) len = Math.max(1, len + drift);
      if (split.dir === 'v') {
        place(child.node, cursor, y, len, h, [...path, i]);
        if (i < n - 1) {
          dividers.push({
            path, after: i, dir: 'v',
            x: cursor + len, y, w: t, h,
          });
        }
        cursor += len + t;
      } else {
        place(child.node, x, cursor, w, len, [...path, i]);
        if (i < n - 1) {
          dividers.push({
            path, after: i, dir: 'h',
            x, y: cursor + len, w, h: t,
          });
        }
        cursor += len + t;
      }
    });
  };

  place(m.root, box.x, box.y, box.w, box.h, []);
  return { leaves, dividers };
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

/**
 * Кандидаты привязки для тяги разделителя dir на стене wall.
 * Координата в той же системе, что pos в dragDivider:
 *   для h — высота от пола (y), для v — x вдоль стены.
 *
 * Собираются ПО ВСЕЙ СТЕНЕ, чтобы полки/перегородки соседних модулей
 * выравнивались друг с другом:
 *   - все перегородки того же направления во всех модулях стены
 *     (кроме перетаскиваемой — exclude);
 *   - для h дополнительно — линии полок внутри открытых ниш
 *     («уже установленные горизонтальные полки»);
 *   - для v дополнительно — центры модулей и вложенных секций
 *     (симметричное деление проёма пополам).
 */
export function dividerSnapCandidates(
  p: Project,
  wall: WallId,
  dir: 'v' | 'h',
  exclude?: { moduleId: string; path: Path; after: number },
): number[] {
  const out: number[] = [];
  for (const m of modulesOn(p, wall)) {
    const { leaves, dividers } = layoutModule(p, m);
    for (const d of dividers) {
      if (d.dir !== dir) continue;
      if (
        exclude &&
        m.id === exclude.moduleId &&
        d.after === exclude.after &&
        d.path.length === exclude.path.length &&
        d.path.every((v, i) => v === exclude.path[i])
      )
        continue;
      out.push(dir === 'v' ? d.x + d.w / 2 : d.y + d.h / 2);
    }
    if (dir === 'h') {
      for (const lb of leaves) {
        if (lb.leaf.face.kind !== 'open') continue;
        const f = lb.leaf.face;
        for (const sy of shelfYsIn(lb.y, lb.h, f.shelves, f.shelfPitch)) out.push(sy);
      }
    }
    if (dir === 'v') {
      // центр модуля и центры вложенных секций — для симметричного деления
      out.push(m.from + m.w / 2);
      for (const [key, b] of nodeBoxes(p, m)) {
        if (key === '') continue;
        const node = getNode(m.root, key.split('.').map(Number));
        if (node?.type === 'split') out.push(b.x + b.w / 2);
      }
    }
  }
  return out;
}

/**
 * Допуск привязки, мм. Магнит должен ловиться мышью на ЭКРАНЕ: если передан
 * текущий zoom (px на мм), допуск = max(grid/2, ~8 px в мм). На общем плане
 * это десятки мм, при сильном приближении — grid/2.
 */
export function snapTolerance(p: Project, zoom?: number): number {
  const gridTol = p.grid > 0 ? p.grid / 2 : 25;
  const pxTol = zoom && zoom > 0 ? 8 / zoom : 0;
  return clamp(Math.max(gridTol, pxTol), 10, 400);
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

/**
 * Габариты каждого узла дерева (ключ — путь через точку, '' — корень/нутро короба).
 * Считается объединением боксов листьев и перегородок соответствующих поддеревьев.
 */
export function nodeBoxes(
  p: Project,
  m: WardModule,
): Map<string, { x: number; y: number; w: number; h: number }> {
  const { leaves, dividers } = layoutModule(p, m);
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  const add = (key: string, x: number, y: number, w: number, hh: number) => {
    const cur = boxes.get(key);
    if (!cur) boxes.set(key, { x, y, w, h: hh });
    else {
      const x2 = Math.max(cur.x + cur.w, x + w);
      const y2 = Math.max(cur.y + cur.h, y + hh);
      cur.x = Math.min(cur.x, x);
      cur.y = Math.min(cur.y, y);
      cur.w = x2 - cur.x;
      cur.h = y2 - cur.y;
    }
  };
  const ib = interiorBox(p, m);
  add('', ib.x, ib.y, ib.w, ib.h);
  for (const lb of leaves) {
    for (let i = 1; i <= lb.path.length; i++) add(lb.path.slice(0, i).join('.'), lb.x, lb.y, lb.w, lb.h);
  }
  for (const d of dividers) {
    for (let i = 1; i <= d.path.length; i++) add(d.path.slice(0, i).join('.'), d.x, d.y, d.w, d.h);
    add(d.path.join('.'), d.x, d.y, d.w, d.h);
  }
  return boxes;
}

// ------------------------------------------------------------------ нормализация и общие стенки

/**
 * ПРОПОРЦИОНАЛЬНО пересчитать размеры дерева под новые габариты нутра.
 * Применяется только когда меняется весь контейнер: ресайз модуля, смена
 * высоты/ширины в свойствах, поворот нарезки, миграция.
 * Локальные правки (тяга перегородки, толщина, общие стенки, удаление узла)
 * используют fitTree — они не должны двигать нетронутые отсеки.
 */
export function normalizeTree(p: Project, m: WardModule): void {
  const ib = interiorBox(p, m);
  const walk = (node: BoxNode, w: number, h: number) => {
    if (node.type !== 'split') return;
    const n = node.children.length;
    if (!n) return;
    const axisLen = node.dir === 'v' ? w : h;
    const t = Math.max(0, node.t);
    const avail = Math.max(1, axisLen - t * (n - 1));
    const sum = node.children.reduce((s, c) => s + Math.max(0, c.size), 0);
    const scale = sum > 0 ? avail / sum : 1;
    for (const c of node.children) c.size = Math.max(1, c.size * scale);
    for (const c of node.children) {
      const cw = node.dir === 'v' ? c.size : w;
      const ch = node.dir === 'v' ? h : c.size;
      walk(c.node, cw, ch);
    }
  };
  walk(m.root, ib.w, ib.h);
}

/**
 * Абсолютная подгонка дерева под нутро модуля: размеры детей сохраняются,
 * разница (drift) отдаётся ПОСЛЕДНЕМУ ребёнку каждого сплита. Используется
 * после локальных изменений (толщина перегородки, общие стенки, удаление
 * узла, новый разрез) — нетронутые отсеки не двигаются.
 * Пропорциональный normalizeTree — только при ресайзе контейнера целиком.
 */
export function fitTree(p: Project, m: WardModule): void {
  const ib = interiorBox(p, m);
  const walk = (node: BoxNode, w: number, h: number): void => {
    if (node.type !== 'split') return;
    const n = node.children.length;
    if (!n) return;
    const axisLen = node.dir === 'v' ? w : h;
    const t = Math.max(0, node.t);
    const avail = Math.max(1, axisLen - t * (n - 1));
    const sum = node.children.reduce((s, c) => s + Math.max(0, c.size), 0);
    let drift = avail - sum;
    for (let i = n - 1; i >= 0 && Math.abs(drift) > 1e-6; i--) {
      const c = node.children[i];
      const cur = Math.max(0, c.size);
      const want = Math.max(1, cur + drift);
      drift -= want - cur;
      c.size = want;
    }
    for (const c of node.children) {
      walk(c.node, node.dir === 'v' ? c.size : w, node.dir === 'v' ? h : c.size);
    }
  };
  walk(m.root, ib.w, ib.h);
}

/** Пары модулей, стоящих вплотную (стык = потенциально общая стенка). */
export function flushPairs(p: Project): Set<string> {
  const s = new Set<string>();
  for (const wall of WALLS) {
    const ms = modulesOn(p, wall);
    for (let i = 0; i < ms.length - 1; i++) {
      if (Math.abs(wallEnd(ms[i]) - ms[i + 1].from) < 1) s.add(`${ms[i].id}|${ms[i + 1].id}`);
    }
  }
  return s;
}

/**
 * Применить умолчания общих стенок по изменению стыков:
 * newPairs — пары, появившиеся после изменения (ставить shared=true),
 * gonePairs — исчезнувшие (ставить shared=false). Уже существующие стыки
 * не трогаем — там действует выбор пользователя.
 * @returns id модулей, у которых изменились стенки (им подгоняем дерево через fitTree).
 */
export function applySharedTransitions(
  p: Project,
  newPairs: Iterable<string>,
  gonePairs: Iterable<string>,
): string[] {
  const touched = new Set<string>();
  const byId = new Map(p.modules.map((m) => [m.id, m]));
  for (const pair of newPairs) {
    const [la, rb] = pair.split('|');
    const L = byId.get(la);
    const R = byId.get(rb);
    if (L && !L.rightShared) {
      L.rightShared = true;
      touched.add(L.id);
    }
    if (R && !R.leftShared) {
      R.leftShared = true;
      touched.add(R.id);
    }
  }
  for (const pair of gonePairs) {
    const [la, rb] = pair.split('|');
    const L = byId.get(la);
    const R = byId.get(rb);
    if (L && L.rightShared) {
      L.rightShared = false;
      touched.add(L.id);
    }
    if (R && R.leftShared) {
      R.leftShared = false;
      touched.add(R.id);
    }
  }
  for (const id of touched) {
    const m = byId.get(id);
    if (m) fitTree(p, m);
  }
  return [...touched];
}

// ------------------------------------------------------------------ купе

export interface SlidingBox {
  /** путь split-узла с купейной системой */
  path: Path;
  doors: number;
  overlap: number;
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  glass?: boolean;
}

/** Все купейные системы модуля с их боксами (по nodeBoxes). */
export function slidingBoxes(p: Project, m: WardModule): SlidingBox[] {
  const boxes = nodeBoxes(p, m);
  const out: SlidingBox[] = [];
  const walk = (node: BoxNode, path: Path) => {
    if (node.type !== 'split') return;
    const sl = node.sliding;
    if (sl && sl.doors >= 2) {
      const b = boxes.get(path.join('.'));
      if (b)
        out.push({
          path,
          doors: sl.doors,
          overlap: sl.overlap ?? 25,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
          fill: sl.fill,
          glass: sl.glass,
        });
    }
    node.children.forEach((c, i) => walk(c.node, [...path, i]));
  };
  walk(m.root, []);
  return out;
}

/** Есть ли закрытая створка купе в точке (xLocal вдоль стены, yFloor от пола). */
export function slidingAtPoint(p: Project, m: WardModule, xLocal: number, yFloor: number): SlidingBox | null {
  for (const sb of slidingBoxes(p, m)) {
    if (xLocal >= sb.x - 0.5 && xLocal <= sb.x + sb.w + 0.5 && yFloor >= sb.y - 0.5 && yFloor <= sb.y + sb.h + 0.5)
      return sb;
  }
  return null;
}
