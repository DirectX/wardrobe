import { store } from './store.ts';
import { renderAll, select, ui } from './state.ts';
import { leaf, newModule } from './defaults.ts';
import {
  CARCASS_T,
  applySharedTransitions,
  clamp,
  cornerZones,
  fitTree,
  flushPairs,
  interiorBox,
  layoutModule,
  modulesOn,
  nodeBoxes,
  normalizeTree,
  resolveAround,
  snap,
  wallEnd,
} from './geometry.ts';
import type {
  BoxNode,
  LeafFace,
  Path,
  Project,
  SlidingSpec,
  SplitNode,
  WallId,
  WardModule,
} from './types.ts';
import { uid } from './types.ts';

export const MIN_W = 200;
export const MIN_LEAF = 80;

// ------------------------------------------------------------------ общие стенки

/**
 * Применить умолчания общих стенок: сравнить стыки ПОСЛЕ изменения
 * со снимком ДО. Новые стыки → shared=true, исчезнувшие → shared=false.
 * Существующие стыки не трогаем — там действует выбор пользователя.
 */
function syncSharedFrom(p: Project, before: Set<string>): void {
  const after = flushPairs(p);
  const added: string[] = [];
  const gone: string[] = [];
  for (const pair of after) if (!before.has(pair)) added.push(pair);
  for (const pair of before) if (!after.has(pair)) gone.push(pair);
  applySharedTransitions(p, added, gone);
}

// ------------------------------------------------------------------ модули

function firstFreeFrom(p: Project, wall: WallId, w: number): number {
  const z = cornerZones(p, wall);
  const hi = p.walls[wall].length - z.end;
  const ms = modulesOn(p, wall);
  let cursor = z.start;
  for (const m of ms) {
    if (m.from - cursor >= w) return cursor;
    cursor = Math.max(cursor, wallEnd(m));
  }
  return cursor + w <= hi ? cursor : -1;
}

export function addModule(wall: WallId): void {
  const p = store.project;
  const z = cornerZones(p, wall);
  const usable = p.walls[wall].length - z.start - z.end;
  const w = Math.min(600, usable);
  if (w < MIN_W) {
    ui.message =
      z.start + z.end > 0
        ? 'Углы заняты глубиной смежного ряда — на стене не осталось места'
        : 'На стене нет места — удлините стену или уберите лишние модули';
    renderAll();
    return;
  }
  const from = firstFreeFrom(p, wall, w);
  if (from < 0) {
    ui.message = 'На стене нет места — удлините стену или уберите лишние модули';
    renderAll();
    return;
  }
  const m = newModule(wall, from, w, p);
  const before = flushPairs(p);
  store.update((pp) => {
    pp.modules.push(m);
    syncSharedFrom(pp, before);
  });
  select({ kind: 'module', id: m.id }, []);
}

/** Двойной клик по пустому месту стены: контейнер центром под курсором. */
export function insertModuleAtPointer(wall: WallId, xMm: number): void {
  const p = store.project;
  const draft = structuredClone(p);
  const z = cornerZones(draft, wall);
  const usable = draft.walls[wall].length - z.start - z.end;
  if (usable < MIN_W) return;
  const proto = newModule(wall, 0, Math.min(600, usable), draft);
  const from = clamp(
    snap(draft, xMm - proto.w / 2),
    z.start,
    draft.walls[wall].length - z.end - proto.w,
  );
  proto.from = from;
  draft.modules.push(proto);
  if (!resolveAround(draft, wall, proto)) {
    ui.message = 'Здесь тесно — контейнер добавлен в конец стены';
    addModule(wall);
    renderAll();
    return;
  }
  syncSharedFrom(draft, flushPairs(p));
  store.replace(draft);
  select({ kind: 'module', id: proto.id }, []);
}

export function moveModule(id: string, newFrom: number): void {
  const p = store.project;
  const draft = structuredClone(p);
  const m = draft.modules.find((x) => x.id === id);
  if (!m) return;
  const z = cornerZones(draft, m.wall);
  m.from = clamp(
    snap(draft, newFrom),
    z.start,
    draft.walls[m.wall].length - z.end - m.w,
  );
  if (!resolveAround(draft, m.wall, m)) return;
  syncSharedFrom(draft, flushPairs(p));
  store.update((pp) => {
    pp.modules = draft.modules;
  }, false);
}

/**
 * Ресайз контейнера: габарит меняется, внутренние размеры пересчитываются
 * ПРОПОРЦИОНАЛЬНО (единственный случай, когда это нужно).
 */
export function resizeModule(id: string, edge: 'l' | 'r', pos: number): void {
  const p = store.project;
  const draft = structuredClone(p);
  const m = draft.modules.find((x) => x.id === id);
  if (!m) return;
  const z = cornerZones(draft, m.wall);
  const hi = draft.walls[m.wall].length - z.end;
  if (edge === 'l') {
    const f = clamp(snap(draft, pos), z.start, m.from + m.w - MIN_W);
    m.w += m.from - f;
    m.from = f;
  } else {
    const end = clamp(snap(draft, pos), m.from + MIN_W, hi);
    m.w = end - m.from;
  }
  if (!resolveAround(draft, m.wall, m)) return;
  normalizeTree(draft, m);
  syncSharedFrom(draft, flushPairs(p));
  store.update((pp) => {
    pp.modules = draft.modules;
  }, false);
}

/** Смена габарита из панели свойств: с пропорциональной нормализацией дерева. */
export function setModuleBox(id: string, patch: Partial<WardModule>): void {
  const p = store.project;
  store.update((pp) => {
    const m = pp.modules.find((x) => x.id === id);
    if (!m) return;
    Object.assign(m, patch);
    normalizeTree(pp, m);
  });
}

/** Переключить общую стенку вручную. */
export function setSharedWall(id: string, side: 'l' | 'r', shared: boolean): void {
  store.update((pp) => {
    const m = pp.modules.find((x) => x.id === id);
    if (!m) return;
    if (side === 'l') m.leftShared = shared;
    else m.rightShared = shared;
    fitTree(pp, m);
  });
}

export function deleteSelected(): void {
  const sel = ui.sel;
  if (!sel) return;
  const before = flushPairs(store.project);
  store.update((p) => {
    if (sel.kind === 'module') p.modules = p.modules.filter((m) => m.id !== sel.id);
    if (sel.kind === 'socket') p.sockets = p.sockets.filter((s) => s.id !== sel.id);
    if (sel.kind === 'tv') p.tv = null;
    syncSharedFrom(p, before);
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
  syncSharedFrom(draft, flushPairs(p));
  store.replace(draft);
  select({ kind: 'module', id: copy.id }, []);
}

// ------------------------------------------------------------------ нарезка

function patchModule(id: string, fn: (m: WardModule) => void, commit = true): void {
  store.update((pp) => {
    const t = pp.modules.find((x) => x.id === id);
    if (t) fn(t);
  }, commit);
}

/** Фактический размер узла (по раскладке), мм. */
function nodeAxisSize(p: Project, m: WardModule, path: Path): { w: number; h: number } {
  const b = nodeBoxes(p, m).get(path.join('.'));
  if (b) return { w: b.w, h: b.h };
  const ib = interiorBox(p, m);
  return { w: ib.w, h: ib.h };
}

/**
 * Разделить лист пополам абсолютными мм: dir 'v' — вертикальной перегородкой
 * (две ячейки рядом), 'h' — горизонтальной (полка-перегородка, две ячейки друг над другом).
 */
export function splitLeaf(id: string, path: Path, dir: 'v' | 'h'): void {
  const p = store.project;
  const m = p.modules.find((x) => x.id === id);
  if (!m) return;
  const node = resolveNode(m.root, path);
  if (!node || node.type !== 'leaf') return;
  const { w, h } = nodeAxisSize(p, m, path);
  const t = CARCASS_T;
  const axis = dir === 'v' ? w : h;
  const half = Math.max(MIN_LEAF, (axis - t) / 2);
  const other = Math.max(MIN_LEAF, axis - t - half);
  patchModule(id, (mm) => {
    const n = resolveNode(mm.root, path);
    if (!n || n.type !== 'leaf') return;
    const a = structuredClone(n);
    const b = structuredClone(n);
    a.id = uid('l');
    mm.root = replaceNode(mm.root, path, {
      type: 'split',
      dir,
      t,
      children: [
        { size: half, node: a },
        { size: other, node: b },
      ],
    });
    fitTree(p, mm);
  });
  select({ kind: 'module', id }, [...path, 1]);
}

/** Убрать узел (лист или секцию целиком): размер уходит соседу, пустой сплит схлопывается. */
export function removeNode(id: string, path: Path): void {
  if (path.length === 0) return;
  patchModule(id, (m) => {
    m.root = dropLeaf(m.root, path);
    fitTree(store.project, m);
  });
  select({ kind: 'module', id }, path.slice(0, -1));
}

function dropLeaf(root: BoxNode, path: Path): BoxNode {
  if (path.length === 1) {
    if (root.type !== 'split') return root;
    const parent = root;
    const i = path[0];
    if (parent.children.length <= 1) return root;
    const gone = parent.children[i];
    const t = parent.t;
    if (parent.children.length === 2) {
      const keep = parent.children[i === 0 ? 1 : 0];
      // освободившийся размер + перегородка уходят оставшемуся ребёнку
      keep.size = parent.dir === 'v' ? keep.size + gone.size + t : keep.size + gone.size + t;
      return keep.node;
    }
    parent.children.splice(i, 1);
    // сосед рядом с удалённым получает его размер и перегородку
    const nb = parent.children[Math.min(i, parent.children.length - 1)];
    if (nb) nb.size += gone.size + t;
    return root;
  }
  if (root.type !== 'split') return root;
  const child = root.children[path[0]];
  child.node = dropLeaf(child.node, path.slice(1));
  // схлопнуть ставшийся одиночным сплит
  if (child.node.type === 'split' && child.node.children.length === 1) {
    child.node = child.node.children[0].node;
  }
  // вложенный сплит того же направления схлопываем в родителя
  if (child.node.type === 'split' && child.node.dir === root.dir && child.node.t === root.t) {
    const flat = child.node.children;
    root.children.splice(path[0], 1, ...flat);
  }
  return root;
}

/** Толщина разделителя сплита, содержащего лист по path. */
export function setDividerT(id: string, path: Path, t: number): void {
  if (path.length === 0) return;
  patchModule(id, (m) => {
    const parentPath = path.slice(0, -1);
    const node = resolveNode(m.root, parentPath);
    if (node?.type === 'split') {
      node.t = clamp(Math.round(t), 0, 60);
      fitTree(store.project, m);
    }
  });
}

/** Толщина разделителя самого узла path (когда выбрана секция-split). */
export function setSplitT(id: string, path: Path, t: number): void {
  patchModule(id, (m) => {
    const node = resolveNode(m.root, path);
    if (node?.type === 'split') {
      node.t = clamp(Math.round(t), 0, 60);
      fitTree(store.project, m);
    }
  });
}

/**
 * Повернуть нарезку секции: v ↔ h.
 * Абсолютные размеры вдоль старой оси становятся размерами вдоль новой,
 * затем нормализуем под фактический бокс.
 */
export function setSplitDir(id: string, path: Path): void {
  const p = store.project;
  patchModule(id, (m) => {
    const node = resolveNode(m.root, path);
    if (!node || node.type !== 'split') return;
    node.dir = node.dir === 'v' ? 'h' : 'v';
    normalizeTree(p, m);
  });
}

/** Включить/выключить купейную систему поверх секции (split-узла). */
export function setSliding(
  id: string,
  path: Path,
  spec: { doors: number; fill?: string; glass?: boolean } | null,
): void {
  patchModule(id, (m) => {
    const node = resolveNode(m.root, path);
    if (node?.type !== 'split') return;
    node.sliding = spec ? { doors: clamp(spec.doors, 2, 6), fill: spec.fill, glass: spec.glass, overlap: 25 } : null;
  });
}

export function setFace(id: string, path: Path, face: LeafFace): void {
  patchModule(id, (m) => {
    const node = resolveNode(m.root, path);
    if (node?.type === 'leaf') node.face = face;
  });
}

/** Массово задать лицо всем листам под узлом path (секция целиком). */
export function setFaceGroup(id: string, path: Path, face: LeafFace): void {
  patchModule(id, (m) => {
    const node = resolveNode(m.root, path);
    if (!node) return;
    const walk = (n: BoxNode) => {
      if (n.type === 'leaf') n.face = structuredClone(face);
      else n.children.forEach((c) => walk(c.node));
    };
    walk(node);
  });
}

/**
 * Двойной клик по отсеку: цикл ниша → дверца → ящик → ниша.
 * Ящик — выдвижной на шариковых направляющих: число ящиков подбираем
 * по высоте отсека (~240 мм на ящик, 1..6).
 */
export function toggleFace(id: string, path: Path): void {
  const p = store.project;
  const m = p.modules.find((x) => x.id === id);
  if (!m) return;
  const node = resolveNode(m.root, path);
  if (node?.type !== 'leaf') return;
  const cur = node.face.kind;
  if (cur === 'open') {
    setFace(id, path, { kind: 'door', hinge: 'left', fill: 'дуб лён' });
  } else if (cur === 'door') {
    const key = path.join('.');
    const lb = layoutModule(p, m).leaves.find((l) => l.path.join('.') === key);
    const h = lb?.h ?? 600;
    const n = Math.max(1, Math.min(6, Math.round(h / 240)));
    setFace(id, path, { kind: 'drawers', drawers: n, fill: 'дуб лён' });
  } else {
    setFace(id, path, { kind: 'open', shelves: 0, shelfPitch: null });
  }
}

/** Параметры привязки: кандидаты (в тех же координатах, что pos) и допуск. */
export interface DividerSnap {
  candidates: number[];
  tol: number;
}

/**
 * Тяга разделителя: pos — координата в системе стены
 * (x вдоль стены для v, y от пола для h), трактуется как центр перегородки.
 *
 * Меняются ТОЛЬКО два смежных ребёнка (их абсолютные размеры), остальные
 * перегородки группы остаются на месте. Ограничение — позиции соседних
 * перегородок: не выйти за пределы пары и не сделать проём меньше MIN_LEAF.
 */
export function dragDivider(
  id: string,
  splitPath: Path,
  after: number,
  pos: number,
  snap?: DividerSnap,
): void {
  const p = store.project;
  const m = p.modules.find((x) => x.id === id);
  if (!m) return;
  const { dividers } = layoutModule(p, m);
  const d = dividers.find(
    (x) => x.after === after && x.path.length === splitPath.length && x.path.every((v, i) => v === splitPath[i]),
  );
  if (!d) return;
  const split = resolveNode(m.root, splitPath);
  if (split?.type !== 'split') return;
  const a = split.children[after];
  const b = split.children[after + 1];
  if (!a || !b) return;

  // начало левого/нижнего ребёнка: левый край перегородки минус его размер
  const thickness = d.dir === 'v' ? d.w : d.h;
  const childStart = (d.dir === 'v' ? d.x : d.y) - a.size;

  let effective = pos;
  if (snap && snap.tol > 0 && snap.candidates.length) {
    let best: number | null = null;
    let bestDist = Infinity;
    for (const c of snap.candidates) {
      const dist = Math.abs(c - pos);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    if (best !== null && bestDist <= snap.tol) effective = best;
  }

  // желаемый размер левого/нижнего ребёнка в мм
  const target = effective - childStart - thickness / 2;
  const pairLen = a.size + b.size; // сумма пары постоянна
  const nA = Math.round(clamp(target, MIN_LEAF, pairLen - MIN_LEAF));
  const nB = pairLen - nA;
  if (nA === Math.round(a.size) && nB === Math.round(b.size)) return;
  if (nB < MIN_LEAF) return;

  store.update((pp) => {
    const mm = pp.modules.find((x) => x.id === id);
    if (!mm) return;
    const node = resolveNode(mm.root, splitPath);
    if (node?.type !== 'split') return;
    const aa = node.children[after];
    const bb = node.children[after + 1];
    if (!aa || !bb) return;
    aa.size = nA;
    bb.size = nB;
  }, false);
}

function resolveNode(root: BoxNode, path: Path): BoxNode | null {
  let n: BoxNode = root;
  for (const i of path) {
    if (n.type !== 'split' || i < 0 || i >= n.children.length) return null;
    n = n.children[i].node;
  }
  return n;
}

function replaceNode(root: BoxNode, path: Path, replacement: BoxNode): BoxNode {
  if (path.length === 0) return replacement;
  if (root.type !== 'split') return root;
  const next = structuredClone(root) as SplitNode;
  const i = path[0];
  if (path.length === 1) next.children[i].node = replacement;
  else next.children[i].node = replaceNode(next.children[i].node, path.slice(1), replacement);
  return next;
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

/** Освободить место под ТВ: вырезать контейнер с полностью открытым отсеком. */
export function makeNicheUnderTv(): void {
  const p = store.project;
  if (!p.tv) return;
  const t = p.tv;
  const draft = structuredClone(p);
  const margin = 100;
  const z = cornerZones(draft, t.wall);
  const lo = Math.max(z.start, snap(draft, t.centerX - t.w / 2 - margin));
  const hi = Math.min(
    draft.walls[t.wall].length - z.end,
    snap(draft, t.centerX + t.w / 2 + margin),
  );
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
      normalizeTree(draft, left);
      rebuilt.push(left);
    }
    if (wallEnd(m) > hi && wallEnd(m) - hi >= MIN_W) {
      const right = structuredClone(m);
      right.from = hi;
      right.w = wallEnd(m) - hi;
      normalizeTree(draft, right);
      rebuilt.push(right);
    }
  }
  const niche: WardModule = {
    ...newModule(t.wall, lo, hi - lo, draft),
    depth: 450,
    root: leaf({ kind: 'open', shelves: 0 }),
  };
  draft.modules = [...others, ...rebuilt, niche];
  syncSharedFrom(draft, flushPairs(p));
  store.replace(draft);
  select({ kind: 'module', id: niche.id }, []);
}
