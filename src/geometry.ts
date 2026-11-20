import type { Cell, FacadeKind, Project, WallId, WardModule } from './types.ts';

export const WALLS: WallId[] = ['left', 'center', 'right'];
/** визуальный зазор между раскрытыми фасадами стен, мм */
export const WALL_GAP = 180;
/** толщина корпуса/перегородки, мм (визуально) */
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

/** Какой стене принадлежит глобальная координата раскрытого фасада. */
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

// ------------------------------------------------------------------ ячейки

export interface CellLayout {
  index: number;
  /** левый край внутри стены, мм */
  x: number;
  w: number;
  cell: Cell;
}

/**
 * Разложить ячейки модуля вдоль стены.
 * Ширина рисуется с масштабированием, чтобы расхождение сумм не ломало картинку
 * (расхождение ловит валидатор).
 */
export function layoutCells(p: Project, m: WardModule): CellLayout[] {
  void p;
  const sum = m.cells.reduce((s, c) => s + Math.max(0, c.w), 0) || 1;
  const scale = m.w / sum;
  let x = m.from;
  return m.cells.map((cell, index) => {
    const w = Math.max(0, cell.w) * scale;
    const l = { index, x, w, cell };
    x += w;
    return l;
  });
}

export function cellsSum(m: WardModule): number {
  return m.cells.reduce((s, c) => s + c.w, 0);
}

export function isCellOpen(cell: Cell): boolean {
  return cell.facade === null;
}

export const PARTITION = CARCASS_T / 2; // перегородка между ячейками пополам от соседей

/** Число полок в открытой секции (для отрисовки и подсказок). */
export function shelfCount(m: WardModule, p: Project, cell: Cell): number {
  const bottom = p.base + CARCASS_T;
  const top = m.h - CARCASS_T;
  const avail = Math.max(0, top - bottom);
  if (cell.shelfPitch && cell.shelfPitch > 0) return Math.max(0, Math.floor(avail / cell.shelfPitch));
  return Math.max(0, Math.round(cell.shelves));
}

/** Высоты полок от пола, мм (в координатах стены). */
export function shelfYs(m: WardModule, p: Project, cell: Cell): number[] {
  const bottom = p.base + CARCASS_T;
  const top = m.h - CARCASS_T;
  const ys: number[] = [];
  if (top - bottom <= 0) return ys;
  if (cell.shelfPitch && cell.shelfPitch > 0) {
    for (let y = bottom + cell.shelfPitch; y < top; y += cell.shelfPitch) ys.push(y);
    return ys;
  }
  const n = Math.max(0, Math.round(cell.shelves));
  for (let i = 1; i <= n; i++) ys.push(bottom + ((top - bottom) * i) / (n + 1));
  return ys;
}

/** Найти ячейку модуля в точке (x вдоль стены, y от пола); null — вне корпуса. */
export function cellAt(p: Project, m: WardModule, x: number, y: number): Cell | null {
  if (x < m.from || x > m.from + m.w || y < p.base || y > m.h) return null;
  for (const cl of layoutCells(p, m)) {
    if (x >= cl.x && x <= cl.x + cl.w) return cl.cell;
  }
  return null;
}

/** Индекс ячейки в той же точке (или -1). */
export function cellIndexAt(p: Project, m: WardModule, x: number, y: number): number {
  if (x < m.from || x > m.from + m.w || y < p.base || y > m.h) return -1;
  for (const cl of layoutCells(p, m)) {
    if (x >= cl.x && x <= cl.x + cl.w) return cl.index;
  }
  return -1;
}

// ------------------------------------------------------------------ packing

export interface FacadeRowV1 {
  weight: number;
  cells: { type: string; hinge?: 'left' | 'right'; fill?: string }[];
}

/**
 * Расставить модули стены вокруг anchor: толкаем соседей влево и вправо.
 * @returns false, если втиснуть не удалось.
 */
export function resolveAround(p: Project, wall: WallId, anchor: WardModule): boolean {
  const ms = modulesOn(p, wall)
    .slice()
    .sort(
      (a, b) =>
        a.from - b.from || (a.id === anchor.id ? -1 : b.id === anchor.id ? 1 : 0),
    );
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
  return ms.every((m) => m.from >= -0.5 && wallEnd(m) <= p.walls[wall].length + 0.5);
}

/** Пропорционально пересчитать ширины ячеек под новую ширину модуля. */
export function rescaleCells(m: WardModule, newW: number): void {
  const n = m.cells.length;
  if (!n) return;
  const old = m.cells.map((c) => Math.max(0, c.w));
  const sum = old.reduce((s, v) => s + v, 0);
  if (sum <= 0 || n === 1) {
    m.cells.forEach((c) => (c.w = newW));
    return;
  }
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const w = Math.max(100, Math.round((newW * old[i]) / sum));
    m.cells[i].w = w;
    acc += w;
  }
  const last = newW - acc;
  if (last >= 100) m.cells[n - 1].w = last;
  else {
    const even = Math.floor(newW / n);
    m.cells.forEach((c) => (c.w = even));
    m.cells[n - 1].w = newW - even * (n - 1);
  }
}

export type { FacadeKind };
