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

// ---------------------------------------------------------- builders (для пресетов и миграции)

export const leaf = (face: LeafFace): { type: 'leaf'; id: string; face: LeafFace } => ({
  type: 'leaf',
  id: uid('l'),
  face: { ...face },
});

/** вертикальный сплит: доли — относительные размеры */
export const splitV = (parts: Array<{ size?: number; node: BoxNode }>, t = CARCASS_T): BoxNode => ({
  type: 'split',
  dir: 'v',
  t,
  children: parts.map((x): SplitChild => ({ size: x.size ?? 1, node: x.node })),
});

export const splitH = (parts: Array<{ size?: number; node: BoxNode }>, t = CARCASS_T): BoxNode => ({
  type: 'split',
  dir: 'h',
  t,
  children: parts.map((x): SplitChild => ({ size: x.size ?? 1, node: x.node })),
});

export const newModule = (wall: WallId, from: number, w: number, p: Project): WardModule => ({
  id: uid('m'),
  wall,
  from,
  w,
  h: p.ceiling,
  depth: 450,
  root: leaf({ kind: 'open', shelves: 0 }),
});

export function defaultProject(): Project {
  const p: Project = {
    version: 3,
    name: 'Гостиная',
    ceiling: 2700,
    base: 80,
    grid: 50,
    walls: { left: { length: 600 }, center: { length: 3500 }, right: { length: 600 } },
    modules: [],
    tv: null,
    sockets: [],
  };
  const doors = (n: number): BoxNode =>
    splitV(
      Array.from({ length: n }, (_, i) => ({
        node: leaf({
          kind: 'door',
          hinge: i % 2 === 0 ? 'left' : 'right',
          fill: 'дуб лён',
        }),
      })),
    );
  const m1: WardModule = {
    id: uid('m'),
    wall: 'center',
    from: 0,
    w: 1300,
    h: p.ceiling,
    depth: 600,
    root: splitH(
      [
        { size: 2000, node: doors(2) },
        { size: p.ceiling - 2000 - 80 - 36, node: splitV([{ node: doors(1) }, { size: 0.5, node: leaf({ kind: 'open', shelves: 2 }) }]) },
      ],
      16,
    ),
  };
  const niche: WardModule = {
    id: uid('m'),
    wall: 'center',
    from: 1300,
    w: 1100,
    h: p.ceiling,
    depth: 450,
    root: splitH(
      [
        { size: 1400, node: leaf({ kind: 'open', shelves: 0 }) },
        { size: 400, node: leaf({ kind: 'drawers', drawers: 2, fill: 'дуб лён' }) },
        { size: p.ceiling - 1400 - 400 - 80 - 36, node: leaf({ kind: 'open', shelves: 1 }) },
      ],
      16,
    ),
  };
  const m3: WardModule = {
    id: uid('m'),
    wall: 'center',
    from: 2400,
    w: 1100,
    h: p.ceiling,
    depth: 600,
    root: splitH(
      [
        { size: 2000, node: doors(2) },
        { size: p.ceiling - 2000 - 80 - 36, node: doors(1) },
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
