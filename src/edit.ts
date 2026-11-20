import { store } from './store.ts';
import { renderAll, select, ui } from './state.ts';
import { newModule } from './defaults.ts';
import { clamp, layoutFacade, modulesOn, resolveAround, snap, wallEnd } from './geometry.ts';
import type { CellType, ModuleKind, Project, WallId, WardModule } from './types.ts';
import { uid } from './types.ts';

export const MIN_W = 200;

/** Первый свободный слот стены шириной w; -1 если не влезает. */
function firstFreeFrom(p: Project, wall: WallId, w: number): number {
  const ms = modulesOn(p, wall);
  let cursor = 0;
  for (const m of ms) {
    if (m.from - cursor >= w) return cursor;
    cursor = Math.max(cursor, wallEnd(m));
  }
  return cursor + w <= p.walls[wall].length ? cursor : -1;
}

export function addModule(kind: ModuleKind, wall: WallId): void {
  const p = store.project;
  const proto = newModule(kind, wall, 0, p);
  const from = firstFreeFrom(p, wall, proto.w);
  if (from < 0) {
    ui.message = 'На стене нет места — удлинитe стену или уберите лишние модули';
    renderAll();
    return;
  }
  proto.from = from;
  store.update((pp) => pp.modules.push(proto));
  select({ kind: 'module', id: proto.id });
}

/** Клик по пустому месту стены: вставить модуль так, чтобы его центр был под курсором. */
export function insertModuleAtPointer(kind: ModuleKind, wall: WallId, xMm: number): void {
  const p = store.project;
  const draft = structuredClone(p);
  const proto = newModule(kind, wall, 0, draft);
  const w = proto.w;
  const from = clamp(snap(draft, xMm - w / 2), 0, draft.walls[wall].length - w);
  const anchor = { ...proto, from };
  draft.modules.push(anchor);
  if (!resolveAround(draft, wall, anchor)) {
    ui.message = 'Здесь тесно — модуль добавлен в конец стены';
    addModule(kind, wall);
    renderAll();
    return;
  }
  store.replace(draft);
  select({ kind: 'module', id: anchor.id });
}

export function moveModule(id: string, newFrom: number): void {
  const p = store.project;
  const draft = structuredClone(p);
  const m = draft.modules.find((x) => x.id === id);
  if (!m) return;
  m.from = clamp(snap(draft, newFrom), 0, draft.walls[m.wall].length - m.w);
  if (!resolveAround(draft, m.wall, m)) return;
  store.update((pp) => {
    pp.modules = draft.modules;
  }, false);
}

export function resizeModule(id: string, edge: 'l' | 'r', pos: number): void {
  const p = store.project;
  const draft = structuredClone(p);
  const m = draft.modules.find((x) => x.id === id);
  if (!m) return;
  if (edge === 'l') {
    const f = clamp(snap(draft, pos), 0, m.from + m.w - MIN_W);
    m.w += m.from - f;
    m.from = f;
  } else {
    const end = clamp(snap(draft, pos), m.from + MIN_W, draft.walls[m.wall].length);
    m.w = end - m.from;
  }
  if (!resolveAround(draft, m.wall, m)) return;
  store.update((pp) => {
    pp.modules = draft.modules;
  }, false);
}

export function deleteSelected(): void {
  const sel = ui.sel;
  if (!sel) return;
  store.update((p) => {
    if (sel.kind === 'module') p.modules = p.modules.filter((m) => m.id !== sel.id);
    if (sel.kind === 'socket') p.sockets = p.sockets.filter((s) => s.id !== sel.id);
    if (sel.kind === 'tv') p.tv = null;
  });
  select(null);
}

export function duplicateModule(id: string): void {
  const p = store.project;
  const src = p.modules.find((x) => x.id === id);
  if (!src) return;
  const draft = structuredClone(p);
  const original = draft.modules.find((x) => x.id === id)!;
  const copy = structuredClone(original);
  copy.id = uid('m');
  copy.from = wallEnd(original);
  draft.modules.push(copy);
  if (!resolveAround(draft, copy.wall, copy)) {
    draft.modules.pop();
    copy.from = firstFreeFrom(draft, copy.wall, copy.w);
    if (copy.from < 0) {
      ui.message = 'Нет места для дубликата';
      renderAll();
      return;
    }
    draft.modules.push(copy);
  }
  store.replace(draft);
  select({ kind: 'module', id: copy.id });
}

export function addSocketAt(wall: WallId, x: number, y: number): void {
  const p = store.project;
  const s = { id: uid('s'), wall, x: snap(p, x), y: snap(p, y) };
  store.update((pp) => pp.sockets.push(s));
  select({ kind: 'socket', id: s.id });
}

export function moveSocket(id: string, x: number, y: number): void {
  const p = store.project;
  const s = p.sockets.find((v) => v.id === id);
  if (!s) return;
  const nx = clamp(snap(p, x), 0, p.walls[s.wall].length);
  const ny = clamp(snap(p, y), 0, p.ceiling);
  store.update((pp) => {
    const t = pp.sockets.find((v) => v.id === id);
    if (t) {
      t.x = nx;
      t.y = ny;
    }
  }, false);
}

export function moveTv(cx: number, cy: number): void {
  const p = store.project;
  const t = p.tv;
  if (!t) return;
  const nx = clamp(snap(p, cx), t.w / 2, p.walls[t.wall].length - t.w / 2);
  const ny = clamp(snap(p, cy), t.h / 2, p.ceiling - t.h / 2);
  store.update((pp) => {
    if (pp.tv) {
      pp.tv.centerX = nx;
      pp.tv.centerY = ny;
    }
  }, false);
}

/** Раздвинуть/заменить модули под ТВ открытой нишей. */
export function makeNicheUnderTv(): void {
  const p = store.project;
  if (!p.tv) return;
  const t = p.tv;
  const draft = structuredClone(p);
  const margin = 100;
  const lo = Math.max(0, snap(draft, t.centerX - t.w / 2 - margin));
  const hi = Math.min(draft.walls[t.wall].length, snap(draft, t.centerX + t.w / 2 + margin));
  const onWall = draft.modules.filter((m) => m.wall === t.wall);
  const others = draft.modules.filter((m) => m.wall !== t.wall);
  const rebuilt: WardModule[] = [];
  for (const m of onWall) {
    if (m.from >= lo && wallEnd(m) <= hi) continue; // полностью под нишей — удаляем
    if (wallEnd(m) <= lo || m.from >= hi) {
      rebuilt.push(m); // не пересекается
      continue;
    }
    if (m.from < lo && lo - m.from >= MIN_W) rebuilt.push({ ...m, w: lo - m.from });
    if (wallEnd(m) > hi && wallEnd(m) - hi >= MIN_W)
      rebuilt.push({ ...m, from: hi, w: wallEnd(m) - hi });
  }
  const niche = newModule('tv-niche', t.wall, lo, draft);
  niche.w = hi - lo;
  draft.modules = [...others, ...rebuilt, niche];
  store.replace(draft);
  select({ kind: 'module', id: niche.id });
}

const CELL_CYCLE: CellType[] = ['door', 'drawer', 'open', 'glass', 'panel'];

/**
 * Циклически сменить тип ячейки фасада в точке.
 * xLocal — вдоль стены (мм), yFloor — высота от пола (мм).
 */
export function cycleCellType(id: string, xLocal: number, yFloor: number): void {
  const p = store.project;
  const m = p.modules.find((x) => x.id === id);
  if (!m) return;
  const locate = (project: Project, mm: WardModule) => {
    for (const row of layoutFacade(project, mm)) {
      if (yFloor < row.y - 1 || yFloor > row.y + row.h + 1) continue;
      for (const c of row.cells) {
        if (xLocal >= c.x - 1 && xLocal <= c.x + c.w + 1) return c.cell;
      }
    }
    return null;
  };
  const current = locate(p, m);
  if (!current) return;
  const next = CELL_CYCLE[(CELL_CYCLE.indexOf(current.type) + 1) % CELL_CYCLE.length];
  store.update((pp) => {
    const target = pp.modules.find((x) => x.id === id);
    if (!target) return;
    const cell = locate(pp, target);
    if (cell) cell.type = next;
  });
}
