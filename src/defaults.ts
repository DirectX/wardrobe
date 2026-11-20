import type { Cell, FacadeKind, ModuleKind, Project, WallId, WardModule } from './types.ts';
import { uid } from './types.ts';

export const WALL_LABEL: Record<string, string> = {
  left: 'Левая стена',
  center: 'Центральная стена',
  right: 'Правая стена',
};

/** Палитра фасадов: ключ → цвет. */
export const FACADE_FILLS: Record<string, string> = {
  белый: '#e9e7e2',
  беж: '#d9c6a0',
  'дуб лён': '#c9a877',
  орех: '#8a5f3c',
  венге: '#4a382c',
  графит: '#4b4f57',
  сталь: '#9aa3ad',
};

export const FACADE_LABEL: Record<FacadeKind, string> = {
  door: 'Дверь',
  drawer: 'Ящики',
  panel: 'Панель',
  glass: 'Стекло',
};

export const KIND_LABEL: Record<ModuleKind, string> = {
  wardrobe: 'Шкаф-купе',
  shelves: 'Полки (открытый)',
  drawers: 'Ящики',
  open: 'Пустой отсек',
  'tv-niche': 'Ниша под ТВ',
};

interface KindDefaults {
  w: number;
  depth: number;
}

export const KIND_DEFAULTS: Record<ModuleKind, KindDefaults> = {
  wardrobe: { w: 900, depth: 600 },
  shelves: { w: 600, depth: 450 },
  drawers: { w: 700, depth: 600 },
  open: { w: 500, depth: 600 },
  'tv-niche': { w: 1100, depth: 450 },
};

export function newCell(p: Project, w: number, over: Partial<Cell> = {}): Cell {
  return {
    w: Math.round(w),
    facade: 'door',
    hinge: 'left',
    fill: 'дуб лён',
    shelves: 4,
    shelfPitch: null,
    drawers: 4,
    ...over,
  };
}

/** Секции по умолчанию для типа модуля. */
export function defaultCells(kind: ModuleKind, p: Project, w: number, h: number): Cell[] {
  const cells = cellsUncorrected(kind, p, Math.round(w), h);
  // остаток от округления — последней секции, чтобы сумма была точной
  const drift = Math.round(w) - cells.reduce((s, c) => s + c.w, 0);
  if (cells.length) cells[cells.length - 1].w += drift;
  return cells;
}

function cellsUncorrected(kind: ModuleKind, p: Project, w: number, h: number): Cell[] {
  const availH = Math.max(200, h - p.base - 36);
  switch (kind) {
    case 'wardrobe': {
      const n = Math.max(2, Math.round(w / 500));
      return Array.from({ length: n }, (_, i) =>
        newCell(p, w / n, {
          facade: 'door',
          hinge: i % 2 === 0 ? 'left' : 'right',
          shelves: Math.max(2, Math.round(availH / 400) - 1),
        }),
      );
    }
    case 'shelves':
      return [
        newCell(p, w, {
          facade: null,
          shelves: Math.max(2, Math.round(availH / 350) - 1),
        }),
      ];
    case 'drawers':
      return [
        newCell(p, w, {
          facade: 'drawer',
          drawers: Math.max(3, Math.round(availH / 240)),
        }),
      ];
    case 'tv-niche':
      return [newCell(p, w, { facade: null, shelves: 0 })];
    case 'open':
      return [newCell(p, w, { facade: null, shelves: 0 })];
  }
}

export function newModule(kind: ModuleKind, wall: WallId, from: number, p: Project): WardModule {
  const d = KIND_DEFAULTS[kind];
  const h = p.ceiling;
  const w = Math.min(d.w, p.walls[wall].length);
  return {
    id: uid('m'),
    wall,
    from,
    w,
    h,
    depth: d.depth,
    kind,
    cells: defaultCells(kind, p, w, h),
  };
}

export function defaultProject(): Project {
  const p: Project = {
    version: 2,
    name: 'Гостиная',
    ceiling: 2700,
    base: 80,
    grid: 50,
    walls: { left: { length: 600 }, center: { length: 3500 }, right: { length: 600 } },
    modules: [],
    tv: null,
    sockets: [],
  };
  const m1 = newModule('wardrobe', 'center', 0, p);
  m1.w = 1300;
  m1.cells = defaultCells('wardrobe', p, 1300, m1.h);
  const niche = newModule('tv-niche', 'center', 1300, p);
  niche.w = 1100;
  niche.cells = defaultCells('tv-niche', p, 1100, niche.h);
  const m3 = newModule('wardrobe', 'center', 2400, p);
  m3.w = 1100;
  m3.cells = defaultCells('wardrobe', p, 1100, m3.h);
  p.modules = [m1, niche, m3];
  p.tv = { wall: 'center', centerX: 1850, centerY: 1150, w: 1240, h: 720 };
  p.sockets = [
    { id: uid('s'), wall: 'center', x: 1850, y: 1000 },
    { id: uid('s'), wall: 'center', x: 650, y: 300 },
    { id: uid('s'), wall: 'right', x: 300, y: 600 },
  ];
  return p;
}
