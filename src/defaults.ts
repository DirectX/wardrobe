import type { FacadeRow, ModuleKind, Project, WallId, WardModule } from './types.ts';
import { uid } from './types.ts';

export const WALL_LABEL: Record<string, string> = {
  left: 'Левая стена',
  center: 'Центральная стена',
  right: 'Правая стена',
};

/** Палитра фасадов: ключ → цвет (или спец. значение для стекла). */
export const FACADE_FILLS: Record<string, string> = {
  белый: '#e9e7e2',
  беж: '#d9c6a0',
  'дуб лён': '#c9a877',
  орех: '#8a5f3c',
  'венге': '#4a382c',
  графит: '#4b4f57',
  'сталь': '#9aa3ad',
};

export const CELL_LABEL: Record<string, string> = {
  door: 'Дверь',
  drawer: 'Ящик',
  open: 'Открыто',
  glass: 'Стекло',
  panel: 'Панель',
};

export const KIND_LABEL: Record<ModuleKind, string> = {
  wardrobe: 'Шкаф с дверцами',
  shelves: 'Полки (открытый)',
  drawers: 'Ящики',
  open: 'Пустой отсек',
  'tv-niche': 'Ниша под ТВ',
};

interface KindDefaults {
  w: number;
  depth: number;
  fullHeight: boolean;
}

export const KIND_DEFAULTS: Record<ModuleKind, KindDefaults> = {
  wardrobe: { w: 800, depth: 600, fullHeight: true },
  shelves: { w: 600, depth: 450, fullHeight: true },
  drawers: { w: 800, depth: 600, fullHeight: true },
  open: { w: 500, depth: 600, fullHeight: true },
  'tv-niche': { w: 1100, depth: 450, fullHeight: true },
};

export function defaultFacade(kind: ModuleKind, w: number, h: number): FacadeRow[] {
  switch (kind) {
    case 'wardrobe': {
      const cols = Math.max(2, Math.round(w / 500));
      return [
        {
          weight: 1,
          cells: Array.from({ length: cols }, (_, i) => ({
            type: 'door' as const,
            hinge: (i % 2 === 0 ? 'left' : 'right') as 'left' | 'right',
            fill: 'дуб лён',
          })),
        },
      ];
    }
    case 'drawers': {
      const rows = Math.max(3, Math.round((h - 100) / 250));
      return Array.from({ length: rows }, () => ({
        weight: 1,
        cells: [{ type: 'drawer' as const, fill: 'дуб лён' }],
      }));
    }
    case 'shelves':
      return [{ weight: 1, cells: [{ type: 'open' as const }] }];
    case 'tv-niche':
      return [{ weight: 1, cells: [{ type: 'open' as const }] }];
    case 'open':
      return [{ weight: 1, cells: [{ type: 'open' as const }] }];
  }
}

export function newModule(kind: ModuleKind, wall: WallId, from: number, p: Project): WardModule {
  const d = KIND_DEFAULTS[kind];
  const h = d.fullHeight ? p.ceiling : 1200;
  return {
    id: uid('m'),
    wall,
    from,
    w: Math.min(d.w, p.walls[wall].length),
    h,
    depth: d.depth,
    kind,
    facade: defaultFacade(kind, d.w, h),
  };
}

export function defaultProject(): Project {
  const p: Project = {
    version: 1,
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
  m1.facade = defaultFacade('wardrobe', 1300, m1.h);
  const niche = newModule('tv-niche', 'center', 1300, p);
  niche.w = 1100;
  const m3 = newModule('wardrobe', 'center', 2400, p);
  m3.w = 1100;
  m3.facade = defaultFacade('wardrobe', 1100, m3.h);
  p.modules = [m1, niche, m3];
  p.tv = { wall: 'center', centerX: 1850, centerY: 1150, w: 1240, h: 720 };
  p.sockets = [
    { id: uid('s'), wall: 'center', x: 1850, y: 1000 },
    { id: uid('s'), wall: 'center', x: 650, y: 300 },
    { id: uid('s'), wall: 'right', x: 300, y: 600 },
  ];
  return p;
}
