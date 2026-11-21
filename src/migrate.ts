// Миграция проектов v1 (фасад-сетка), v2 (плоские секции), v3 (дерево, относительные веса)
// → v4 (дерево, абсолютные мм + общие стенки).
import type { BoxNode, LeafFace, Project, WallId, WardModule } from './types.ts';
import { uid } from './types.ts';
import { CARCASS_T, modulesOn, normalizeTree, wallEnd } from './geometry.ts';
import { leaf } from './defaults.ts';

interface V1Cell {
  type: 'door' | 'drawer' | 'open' | 'glass' | 'panel';
  hinge?: 'left' | 'right';
  fill?: string;
}
interface V1Row {
  weight: number;
  cells: V1Cell[];
}

interface V2Cell {
  w: number;
  facade: 'door' | 'drawer' | 'panel' | 'glass' | null;
  hinge?: 'left' | 'right';
  fill?: string;
  shelves: number;
  shelfPitch?: number | null;
  drawers: number;
}

type LegacyModule = {
  id: string;
  wall: WallId;
  from: number;
  w: number;
  h: number;
  depth: number;
  kind?: string;
  facade?: V1Row[];
  cells?: V2Cell[];
  root?: BoxNode;
};

function faceFromV2(c: V2Cell): LeafFace {
  switch (c.facade) {
    case 'door':
      return { kind: 'door', hinge: c.hinge ?? 'left', fill: c.fill };
    case 'glass':
      return { kind: 'door', hinge: c.hinge ?? 'left', glass: true, fill: c.fill };
    case 'drawer':
      return { kind: 'drawers', drawers: Math.max(1, c.drawers), fill: c.fill };
    case 'panel':
      return { kind: 'panel', fill: c.fill };
    default:
      return { kind: 'open', shelves: c.shelves, shelfPitch: c.shelfPitch };
  }
}

function treeFromV2Cells(cells: V2Cell[]): BoxNode {
  const meaningful = cells.filter((c) => c.w > 0);
  if (meaningful.length <= 1) {
    const c = meaningful[0];
    return c ? leaf(faceFromV2(c)) : leaf({ kind: 'open', shelves: 0 });
  }
  return {
    type: 'split',
    dir: 'v',
    t: CARCASS_T,
    children: meaningful.map((c) => ({ size: c.w, node: leaf(faceFromV2(c)) })),
  };
}

/** v1 (rows×cells) → набор v2-ячеек. */
function cellsFromV1(m: LegacyModule, p: Project): V2Cell[] {
  const rows: V1Row[] = m.facade?.length ? m.facade : [{ weight: 1, cells: [{ type: 'open' }] }];
  const all = rows.flatMap((r) => r.cells);
  const avail = Math.max(200, m.h - p.base - 36);
  const defShelves = Math.max(2, Math.round(avail / 350) - 1);

  if (all.length && all.every((c) => c.type === 'drawer')) {
    return [
      {
        w: m.w,
        facade: 'drawer',
        hinge: 'left',
        fill: rows[0].cells[0]?.fill,
        shelves: 0,
        shelfPitch: 240,
        drawers: Math.max(2, rows.length),
      },
    ];
  }
  const cols = Math.max(...rows.map((r) => r.cells.length), 1);
  const cells: V2Cell[] = [];
  for (let j = 0; j < cols; j++) {
    let facade: V2Cell['facade'] = null;
    let hinge: 'left' | 'right' = 'left';
    let fill: string | undefined;
    for (const r of rows) {
      const c = r.cells[Math.min(j, r.cells.length - 1)];
      if (!c) continue;
      if (c.type === 'door' || c.type === 'glass' || c.type === 'panel') {
        facade = c.type;
        hinge = c.hinge ?? 'left';
        fill = c.fill;
        break;
      }
    }
    const open = facade === null;
    cells.push({
      w: Math.round(m.w / cols),
      facade,
      hinge,
      fill,
      shelves: open && (m.kind === 'tv-niche' || m.kind === 'open') ? 0 : defShelves,
      shelfPitch: null,
      drawers: 4,
    });
  }
  const drift = Math.round(m.w) - cells.reduce((s, c) => s + c.w, 0);
  cells[cells.length - 1].w += drift;
  return cells;
}

/** Обеспечивает структуру v4: leftShared/rightShared по соседству, абсолютные размеры. */
function finalizeV4(proj: Project): Project {
  for (const wall of ['left', 'center', 'right'] as WallId[]) {
    const ms = modulesOn(proj, wall);
    ms.forEach((m, i) => {
      const prev = ms[i - 1];
      const next = ms[i + 1];
      m.leftShared = !!prev && Math.abs(wallEnd(prev) - m.from) < 1;
      m.rightShared = !!next && Math.abs(wallEnd(m) - next.from) < 1;
      normalizeTree(proj, m);
    });
  }
  return proj;
}

/** Приводит проект известной версии к v4. null — если не распознан. */
export function migrate(input: unknown): Project | null {
  if (!input || typeof input !== 'object') return null;
  const proj = input as Project & { version?: number };
  const version = Number(proj.version);
  if (!proj.walls?.center || !Array.isArray(proj.modules)) return null;

  if (version === 4 && proj.modules.every((m) => m.root && 'leftShared' in m)) return proj;
  if (version !== 1 && version !== 2 && version !== 3) return null;

  const legacyModules = proj.modules as unknown as LegacyModule[];
  proj.modules = legacyModules.map((lm) => {
    let root: BoxNode;
    if (version === 3 && lm.root) {
      // v3: относительные веса — оставляем как есть, normalizeTree пересчитает в мм
      root = structuredClone(lm.root);
    } else {
      const cellsV2 = lm.cells ?? (lm.facade ? cellsFromV1(lm, proj) : undefined);
      root = cellsV2 ? treeFromV2Cells(cellsV2) : leaf({ kind: 'open', shelves: 0 });
    }
    const m: WardModule = {
      id: lm.id || uid('m'),
      wall: lm.wall,
      from: lm.from,
      w: lm.w,
      h: lm.h,
      depth: lm.depth,
      leftShared: false,
      rightShared: false,
      root,
    };
    return m;
  });
  proj.version = 4;
  return finalizeV4(proj);
}
