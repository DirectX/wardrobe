import type { FacadeCell, FacadeRow, Project, WallId, WardModule } from './types.ts';

export const WALLS: WallId[] = ['left', 'center', 'right'];
/** визуальный зазор между раскрытыми фасадами стен, мм */
export const WALL_GAP = 180;

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

export interface LaidCell {
  x: number;
  w: number;
  cell: FacadeCell;
}

export interface LaidRow {
  /** низ ряда, мм от пола */
  y: number;
  h: number;
  cells: LaidCell[];
}

/** Разложить фасад модуля по рядам и ячейкам (координаты вдоль стены). */
export function layoutFacade(p: Project, m: WardModule): LaidRow[] {
  const rows: FacadeRow[] = m.facade.length ? m.facade : [{ weight: 1, cells: [{ type: 'open' }] }];
  const areaH = Math.max(1, m.h - p.base);
  const totalW = rows.reduce((s, r) => s + (r.weight > 0 ? r.weight : 0), 0) || 1;
  let acc = m.h; // идём сверху вниз
  const out: LaidRow[] = [];
  for (const r of rows) {
    const rh = (areaH * (r.weight > 0 ? r.weight : 0)) / totalW;
    const y = acc - rh;
    const n = Math.max(1, r.cells.length);
    const cw = m.w / n;
    out.push({
      y,
      h: rh,
      cells: r.cells.map((cell, i) => ({ x: m.from + i * cw, w: cw, cell })),
    });
    acc = y;
  }
  return out;
}

/** Найти тип ячейки фасада в точке (x вдоль стены, y от пола). null — вне модуля. */
export function cellAt(p: Project, m: WardModule, x: number, y: number): FacadeCell | null {
  if (x < m.from || x > m.from + m.w || y < 0 || y > m.h) return null;
  if (y < p.base) return { type: 'panel' }; // плинтус закрыт
  for (const row of layoutFacade(p, m)) {
    if (y >= row.y && y <= row.y + row.h) {
      for (const c of row.cells) {
        if (x >= c.x && x <= c.x + c.w) return c.cell;
      }
    }
  }
  return null;
}

/** Сдвинуть все модули стены правее `after`, устраняя наложения. */
export function packRight(p: Project, wall: WallId, after: WardModule): void {
  const ms = modulesOn(p, wall);
  const i = ms.findIndex((m) => m.id === after.id);
  let prevEnd = wallEnd(after);
  for (let j = i + 1; j < ms.length; j++) {
    const m = ms[j];
    if (m.from < prevEnd) m.from = prevEnd;
    prevEnd = wallEnd(m);
  }
}

/**
 * Расставить модули стены вокруг anchor: толкаем соседей влево и вправо.
 * @returns false, если втиснуть не удалось (цепочка вылезает за стену) — состояние не изменять нельзя,
 * поэтому вызывающий должен работать на «черновике» и откатывать при false.
 */
export function resolveAround(p: Project, wall: WallId, anchor: WardModule): boolean {
  const ms = modulesOn(p, wall).slice().sort(
    (a, b) =>
      a.from - b.from ||
      (a.id === anchor.id ? -1 : b.id === anchor.id ? 1 : 0),
  );
  const i = ms.findIndex((m) => m.id === anchor.id);
  // вправо
  let bound = wallEnd(anchor);
  for (let j = i + 1; j < ms.length; j++) {
    const m = ms[j];
    if (m.from < bound) m.from = bound;
    bound = wallEnd(m);
  }
  // влево
  bound = anchor.from;
  for (let j = i - 1; j >= 0; j--) {
    const m = ms[j];
    if (wallEnd(m) > bound) m.from = bound - m.w;
    bound = m.from;
  }
  return ms.every((m) => m.from >= -0.5 && wallEnd(m) <= p.walls[wall].length + 0.5);
}
