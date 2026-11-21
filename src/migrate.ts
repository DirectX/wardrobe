// Миграция проектов v1 (фасад-сетка) и v2 (плоские секции) → v3 (дерево нарезки).
import type { BoxNode, LeafFace, Project, WardModule } from './types.ts';
import { CARCASS_T } from './geometry.ts';
import { leaf, splitV } from './defaults.ts';
import { uid } from './types.ts';

const MIN_V2 = 120;

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
  shelfPitch: number | null;
  drawers: number;
}

type LegacyModule = Omit<WardModule, 'root'> & {
  facade?: V1Row[];
  cells?: V2Cell[];
  kind?: string;
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
  return splitV(meaningful.map((c) => ({ size: c.w, node: leaf(faceFromV2(c)) })), CARCASS_T);
}

/** v1 (rows×cells) → набор v2-ячеек, дальше общая дорога. */
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

/** Приводит проект известной версии к v3. null — если не распознан. */
export function migrate(input: unknown): Project | null {
  if (!input || typeof input !== 'object') return null;
  const proj = input as Project & { version?: number };
  const version = Number(proj.version);
  if (!proj.walls?.center || !Array.isArray(proj.modules)) return null;
  if (version === 3 && proj.modules.every((m) => (m as WardModule).root)) {
    proj.version = 3;
    return proj;
  }
  if (version !== 1 && version !== 2) return null;
  const legacyModules = proj.modules as unknown as (LegacyModule & Record<string, unknown>)[];
  proj.modules = legacyModules.map((lm) => {
    const cellsV2 =
      lm.cells ?? (lm.facade ? cellsFromV1(lm, proj) : undefined);
    const { facade, cells, kind, root, ...rest } = lm as LegacyModule & {
      kind?: unknown;
      root?: unknown;
    };
    void facade;
    void cells;
    void kind;
    void root;
    const m = rest as WardModule;
    m.id = m.id || uid('m');
    m.root = cellsV2 ? treeFromV2Cells(cellsV2) : leaf({ kind: 'open', shelves: 0 });
    void MIN_V2;
    return m;
  });
  proj.version = 3;
  return proj;
}
