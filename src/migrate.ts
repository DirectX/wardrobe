// Миграция сохранённых проектов v1 (фасад-сетка рядов×ячеек) → v2 (секции).
import type { Cell, FacadeKind, Project, WardModule } from './types.ts';

interface V1Cell {
  type: 'door' | 'drawer' | 'open' | 'glass' | 'panel';
  hinge?: 'left' | 'right';
  fill?: string;
}
interface V1Row {
  weight: number;
  cells: V1Cell[];
}
interface V1Module {
  id: string;
  wall: WardModule['wall'];
  from: number;
  w: number;
  h: number;
  depth: number;
  kind: WardModule['kind'];
  facade?: V1Row[];
}

function cellsFromV1(m: V1Module, p: Project): Cell[] {
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
  const cells: Cell[] = [];
  for (let j = 0; j < cols; j++) {
    let facade: FacadeKind | null = null;
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

/** Приводит проект известной версии к v2. Возвращает null, если данные не распознаны. */
export function migrate(input: unknown): Project | null {
  if (!input || typeof input !== 'object') return null;
  const p = input as Project & { version: number };
  if (!p.walls?.center || !Array.isArray(p.modules)) return null;
  if (p.version === 2) return p;
  if (p.version !== 1) return null;

  const proj = p as unknown as Project;
  const legacyModules = p.modules as unknown as V1Module[];
  proj.modules = legacyModules.map((m) => {
    const legacy = { ...m };
    delete legacy.facade;
    return { ...legacy, cells: cellsFromV1(m, proj) } as unknown as WardModule;
  });
  proj.version = 2;
  return proj;
}
