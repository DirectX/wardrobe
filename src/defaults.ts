import type {
  BoxNode,
  LeafFace,
  Project,
  SplitChild,
  WallId,
  WardModule,
} from './types.ts';
import { CARCASS_T } from './geometry.ts';
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

export const FACE_LABEL: Record<LeafFace['kind'], string> = {
  open: 'Ниша',
  door: 'Дверца',
  drawers: 'Ящики',
  panel: 'Панель',
};

// ---------------------------------------------------------- builders

export const leaf = (face: LeafFace): { type: 'leaf'; id: string; face: LeafFace } => ({
  type: 'leaf',
  id: uid('l'),
  face: { ...face },
});

/** вертикальный сплит: size — абсолютные мм вдоль ширины */
export const splitV = (parts: Array<{ size: number; node: BoxNode }>, t = CARCASS_T): BoxNode => ({
  type: 'split',
  dir: 'v',
  t,
  children: parts.map((x): SplitChild => ({ size: x.size, node: x.node })),
});

/** горизонтальный сплит: size — абсолютные мм вдоль высоты */
export const splitH = (parts: Array<{ size: number; node: BoxNode }>, t = CARCASS_T): BoxNode => ({
  type: 'split',
  dir: 'h',
  t,
  children: parts.map((x): SplitChild => ({ size: x.size, node: x.node })),
});

export const newModule = (
  wall: WallId,
  from: number,
  w: number,
  p: Project,
  over: Partial<WardModule> = {},
): WardModule => ({
  id: uid('m'),
  wall,
  from,
  w,
  h: p.ceiling,
  depth: 450,
  leftShared: false,
  rightShared: false,
  root: leaf({ kind: 'open', shelves: 0 }),
  ...over,
});

export function defaultProject(): Project {
  const ceiling = 2700;
  const p: Project = {
    version: 4,
    name: 'Гостиная',
    ceiling,
    base: 80,
    grid: 50,
    walls: { left: { length: 1200 }, center: { length: 3500 }, right: { length: 1200 } },
    modules: [],
    tv: null,
    sockets: [],
  };

  // Внутренняя высота короба (вычитаем цоколь 80 и верх/низ по 18)
  const innerH = ceiling - 80 - 2 * CARCASS_T; // 2586

  // двери — равные вертикальные секции
  const doors = (n: number, widthMm: number): BoxNode =>
    splitV(
      Array.from({ length: n }, (_, i) => ({
        size: Math.round((widthMm - (n - 1) * CARCASS_T) / n),
        node: leaf({
          kind: 'door' as const,
          hinge: (i % 2 === 0 ? 'left' : 'right') as 'left' | 'right',
          fill: 'дуб лён',
        }),
      })),
    );

  const m1w = 1300;
  const m1Inner = m1w - 2 * CARCASS_T;
  const m1: WardModule = {
    id: uid('m'),
    wall: 'center',
    from: 0,
    w: m1w,
    h: ceiling,
    depth: 600,
    leftShared: false,
    rightShared: true,
    root: splitH(
      [
        { size: 2000, node: doors(2, m1Inner) },
        {
          size: innerH - 2000 - 16,
          node: splitV([
            { size: Math.round(m1Inner * 0.6), node: doors(1, m1Inner * 0.6) },
            { size: Math.round(m1Inner * 0.4) - 18, node: leaf({ kind: 'open', shelves: 2 }) },
          ]),
        },
      ],
      16,
    ),
  };

  const nicheW = 1100;
  const niche: WardModule = {
    id: uid('m'),
    wall: 'center',
    from: 1300,
    w: nicheW,
    h: ceiling,
    depth: 450,
    leftShared: true,
    rightShared: true,
    root: splitH(
      [
        { size: 1400, node: leaf({ kind: 'open', shelves: 0 }) },
        { size: 400, node: leaf({ kind: 'drawers', drawers: 2, fill: 'дуб лён' }) },
        { size: innerH - 1400 - 400 - 32, node: leaf({ kind: 'open', shelves: 1 }) },
      ],
      16,
    ),
  };

  const m3w = 1100;
  const m3Inner = m3w - 2 * CARCASS_T;
  const m3: WardModule = {
    id: uid('m'),
    wall: 'center',
    from: 2400,
    w: m3w,
    h: ceiling,
    depth: 600,
    leftShared: true,
    rightShared: false,
    root: splitH(
      [
        { size: 2000, node: doors(2, m3Inner) },
        { size: innerH - 2000 - 16, node: doors(1, m3Inner) },
      ],
      16,
    ),
  };

  p.modules = [m1, niche, m3];
  p.tv = { wall: 'center', centerX: 1850, centerY: 1150, w: 1240, h: 720 };
  p.sockets = [
    { id: uid('s'), wall: 'center', x: 1850, y: 1000 },
    { id: uid('s'), wall: 'center', x: 650, y: 300 },
    { id: uid('s'), wall: 'right', x: 300, y: 600 },
  ];
  return p;
}
