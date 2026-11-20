import { store } from './store.ts';
import { renderAll, select, ui } from './state.ts';
import { defaultCells, newModule } from './defaults.ts';
import {
  cellIndexAt,
  clamp,
  layoutCells,
  modulesOn,
  rescaleCells,
  resolveAround,
  snap,
  wallEnd,
} from './geometry.ts';
import type { Cell, ModuleKind, Project, WallId, WardModule } from './types.ts';
import { uid } from './types.ts';

export const MIN_W = 200;
export const MIN_CELL_W = 120;

const minCell = (p: Project) => Math.max(MIN_CELL_W, p.grid);

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
    ui.message = 'На стене нет места — удлините стену или уберите лишние модули';
    renderAll();
    return;
  }
  proto.from = from;
  store.update((pp) => pp.modules.push(proto));
  select({ kind: 'module', id: proto.id });
}

/** Двойной клик по пустому месту стены: вставить модуль центром под курсор. */
export function insertModuleAtPointer(kind: ModuleKind, wall: WallId, xMm: number): void {
  const p = store.project;
  const draft = structuredClone(p);
  const proto = newModule(kind, wall, 0, draft);
  const from = clamp(snap(draft, xMm - proto.w / 2), 0, draft.walls[wall].length - proto.w);
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

/** Изменить ширину модуля; ширины ячеек пересчитываются пропорционально. */
export function resizeModule(id: string, edge: 'l' | 'r', pos: number): void {
  const p = store.project;
  const draft = structuredClone(p);
  const m = draft.modules.find((x) => x.id === id);
  if (!m) return;
  if (edge === 'l') {
    const f = clamp(snap(draft, pos), 0, m.from + m.w - MIN_W);
    const newW = m.w + (m.from - f);
    rescaleCells(m, newW);
    m.w = newW;
    m.from = f;
  } else {
    const end = clamp(snap(draft, pos), m.from + MIN_W, draft.walls[m.wall].length);
    const newW = end - m.from;
    rescaleCells(m, newW);
    m.w = newW;
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
    copy.from = firstFreeFrom(draft, copy.wall, copy.w);
    if (copy.from < 0) {
      ui.message = 'Нет места для дубликата';
      renderAll();
      return;
    }
  }
  store.replace(draft);
  select({ kind: 'module', id: copy.id });
}

// ------------------------------------------------------------------ ячейки

function patchModuleCommit(id: string, fn: (m: WardModule) => void): void {
  store.update((pp) => {
    const t = pp.modules.find((x) => x.id === id);
    if (t) fn(t);
  });
}

/** Установить ширину ячейки за счёт соседа (инвариант: сумма ширин = ширина модуля). */
export function setCellWidth(id: string, idx: number, newW: number): void {
  patchModuleCommit(id, (m) => {
    const cell = m.cells[idx];
    if (!cell || m.cells.length === 0) return;
    if (m.cells.length === 1) {
      cell.w = m.w;
      return;
    }
    const target = clamp(Math.round(newW), minCell(store.project), m.w - minCell(store.project) * (m.cells.length - 1));
    const delta = target - cell.w;
    const right = m.cells[idx + 1];
    const left = m.cells[idx - 1];
    if (right && right.w - delta >= minCell(store.project)) {
      cell.w = target;
      right.w -= delta;
    } else if (left && left.w + delta >= minCell(store.project)) {
      cell.w = target;
      left.w += delta;
    } else {
      cell.w = m.w - minCell(store.project) * (m.cells.length - 1);
      for (const c of m.cells) if (c !== cell) c.w = minCell(store.project);
    }
  });
}

/** Разделить ячейку пополам. */
export function splitCell(id: string, idx: number): void {
  patchModuleCommit(id, (m) => {
    const cell = m.cells[idx];
    if (!cell || cell.w < minCell(store.project) * 2) return;
    const half = Math.floor(cell.w / 2);
    const a: Cell = { ...structuredClone(cell), w: cell.w - half };
    const b: Cell = { ...structuredClone(cell), w: half };
    m.cells.splice(idx, 1, a, b);
  });
}

/** Добавить ячейку: режем пополам самую широкую. */
export function addCell(id: string): void {
  const p = store.project;
  const m = p.modules.find((x) => x.id === id);
  if (!m) return;
  let best = -1;
  let bestW = minCell(p) * 2;
  m.cells.forEach((c, i) => {
    if (c.w >= bestW) {
      bestW = c.w;
      best = i;
    }
  });
  if (best < 0) {
    ui.message = 'Ячейки уже узкие — расширьте модуль';
    renderAll();
    return;
  }
  splitCell(id, best);
}

/** Удалить ячейку, её ширина уходит соседу. */
export function removeCell(id: string, idx: number): void {
  patchModuleCommit(id, (m) => {
    if (m.cells.length <= 1) return;
    const [gone] = m.cells.splice(idx, 1);
    const target = m.cells[Math.min(idx, m.cells.length - 1)];
    target.w += gone.w;
  });
}

/** Вкл/выкл фасад у ячейки в точке (x вдоль стены, y от пола). */
export function toggleCellFacade(id: string, xLocal: number, yFloor: number): void {
  const p = store.project;
  const m = p.modules.find((x) => x.id === id);
  if (!m) return;
  const idx = cellIndexAt(p, m, xLocal, yFloor);
  if (idx < 0) return;
  patchModuleCommit(id, (mm) => {
    const cell = mm.cells[idx];
    if (!cell) return;
    if (cell.facade === null) {
      cell.facade = 'door';
      if (!cell.fill) cell.fill = 'дуб лён';
    } else {
      cell.facade = null;
    }
  });
  select({ kind: 'module', id }, idx);
}

/** Тяга границы между ячейками idx и idx+1: pos — координата границы вдоль стены. */
export function dragCellBoundary(id: string, leftIdx: number, posWallLocal: number): void {
  const p = store.project;
  const m = p.modules.find((x) => x.id === id);
  if (!m) return;
  const layout = layoutCells(p, m);
  const left = layout[leftIdx];
  const right = layout[leftIdx + 1];
  if (!left || !right) return;
  const pairW = left.cell.w + right.cell.w;
  const target = clamp(Math.round(posWallLocal - left.x), minCell(p), pairW - minCell(p));
  store.update((pp) => {
    const t = pp.modules.find((x) => x.id === id);
    if (!t) return;
    const a = t.cells[leftIdx];
    const b = t.cells[leftIdx + 1];
    if (a && b) {
      a.w = target;
      b.w = pairW - target;
    }
  }, false);
}

/** Сменить тип модуля — пересоздаёт секции по умолчанию. */
export function setModuleKind(id: string, kind: ModuleKind): void {
  const p = store.project;
  patchModuleCommit(id, (m) => {
    m.kind = kind;
    m.cells = defaultCells(kind, p, m.w, m.h);
  });
}

// ------------------------------------------------------------------ ТВ и розетки

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
    if (m.from >= lo && wallEnd(m) <= hi) continue;
    if (wallEnd(m) <= lo || m.from >= hi) {
      rebuilt.push(m);
      continue;
    }
    if (m.from < lo && lo - m.from >= MIN_W) {
      const left = structuredClone(m);
      left.w = lo - m.from;
      rescaleCells(left, left.w);
      rebuilt.push(left);
    }
    if (wallEnd(m) > hi && wallEnd(m) - hi >= MIN_W) {
      const right = structuredClone(m);
      right.from = hi;
      right.w = wallEnd(m) - hi;
      rescaleCells(right, right.w);
      rebuilt.push(right);
    }
  }
  const niche = newModule('tv-niche', t.wall, lo, draft);
  niche.w = hi - lo;
  niche.cells = defaultCells('tv-niche', draft, niche.w, niche.h);
  draft.modules = [...others, ...rebuilt, niche];
  store.replace(draft);
  select({ kind: 'module', id: niche.id });
}
