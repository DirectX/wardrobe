import { store } from './store.ts';
import { renderAll, select, ui } from './state.ts';
import { leaf, newModule } from './defaults.ts';
import {
  CARCASS_T,
  clamp,
  cornerZones,
  layoutModule,
  modulesOn,
  resolveAround,
  snap,
  wallEnd,
} from './geometry.ts';
import type {
  BoxNode,
  LeafFace,
  Path,
  Project,
  SplitNode,
  WallId,
  WardModule,
} from './types.ts';
import { uid } from './types.ts';

export const MIN_W = 200;
export const MIN_LEAF = 80;

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
        : 'На стене нет места — удлинитe стену или уберите лишние модули';
    renderAll();
    return;
  }
  const from = firstFreeFrom(p, wall, w);
  if (from < 0) {
    ui.message = 'На стене нет места — удлинитe стену или уберите лишние модули';
    renderAll();
    return;
  }
  const m = newModule(wall, from, w, p);
  store.update((pp) => pp.modules.push(m));
  select({ kind: 'module', id: m.id }, [0]);
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
  store.replace(draft);
  select({ kind: 'module', id: proto.id }, [0]);
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
  store.update((pp) => {
    pp.modules = draft.modules;
  }, false);
}

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

// ------------------------------------------------------------------ нарезка

function patchModule(id: string, fn: (m: WardModule) => void, commit = true): void {
  store.update((pp) => {
    const t = pp.modules.find((x) => x.id === id);
    if (t) fn(t);
  }, commit);
}

/** Разделить лист пополам: dir 'v' — вертикальным разделителем, 'h' — горизонтальной полкой-перегородкой. */
export function splitLeaf(id: string, path: Path, dir: 'v' | 'h'): void {
  patchModule(id, (m) => {
    const node = resolveNode(m.root, path);
    if (!node || node.type !== 'leaf') return;
    const a = structuredClone(node);
    const b = structuredClone(node);
    a.id = uid('l');
    m.root = replaceNode(m.root, path, {
      type: 'split',
      dir,
      t: CARCASS_T,
      children: [
        { size: 1, node: a },
        { size: 1, node: b },
      ],
    });
  });
  select({ kind: 'module', id }, [...path, 1]);
}

/** Убрать лист: его размер уходит соседу, пустой сплит схлопывается. */
export function removeLeaf(id: string, path: Path): void {
  if (path.length === 0) return;
  patchModule(id, (m) => {
    m.root = dropLeaf(m.root, path);
  });
  select({ kind: 'module', id }, path.length > 1 ? path.slice(0, -1) : null);
}

function dropLeaf(root: BoxNode, path: Path): BoxNode {
  if (path.length === 1) {
    const parent = root;
    if (parent.type !== 'split') return root;
    const i = path[0];
    const neighbors = parent.children.filter((_, j) => j !== i);
    if (parent.children.length === 1) return root;
    if (parent.children.length === 2) return neighbors[0].node;
    parent.children.splice(i, 1);
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
    if (node?.type === 'split') node.t = clamp(Math.round(t), 0, 60);
  });
}

export function setFace(id: string, path: Path, face: LeafFace): void {
  patchModule(id, (m) => {
    const node = resolveNode(m.root, path);
    if (node?.type === 'leaf') node.face = face;
  });
}

/** Двойной клик по отсеку: ниша ↔ дверца. */
export function toggleFace(id: string, path: Path): void {
  const p = store.project;
  const m = p.modules.find((x) => x.id === id);
  if (!m) return;
  const node = resolveNode(m.root, path);
  if (node?.type !== 'leaf') return;
  const face: LeafFace =
    node.face.kind === 'open'
      ? { kind: 'door', hinge: 'left', fill: 'дуб лён' }
      : { kind: 'open', shelves: 0, shelfPitch: null };
  setFace(id, path, face);
}

/** Параметры привязки: кандидаты (в тех же координатах, что pos) и допуск. */
export interface DividerSnap {
  candidates: number[];
  tol: number;
}

/**
 * Тяга разделителя: pos — координата в системе стены
 * (x вдоль стены для v, y от пола для h), трактуется как центр перегородки.
 * snap — привязка к ранее установленным перегородкам (например, горизонтальным полкам).
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
  if (!split || split.type !== 'split') return;
  const a = split.children[after];
  const b = split.children[after + 1];
  if (!a || !b) return;
  const curLeftScaled = a.size * d.scale;
  // начало левого/нижнего ребёнка (d.x/d.y — это уже край после него)
  const childStart = (d.dir === 'v' ? d.x : d.y) - curLeftScaled;
  // толщина перегородки вдоль оси тяги: v → d.w, h → d.h
  const thickness = d.dir === 'v' ? d.w : d.h;
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
  const target = effective - childStart - thickness / 2; // желаемый размер левого/нижнего ребёнка
  const minScaled = MIN_LEAF;
  const maxTarget = d.pairLen - thickness - minScaled;
  const clamped = clamp(target, minScaled, Math.max(minScaled, maxTarget));
  const shift = clamped - curLeftScaled;
  store.update((pp) => {
    const mm = pp.modules.find((x) => x.id === id);
    if (!mm) return;
    const node = resolveNode(mm.root, splitPath);
    if (!node || node.type !== 'split') return;
    const aa = node.children[after];
    const bb = node.children[after + 1];
    if (!aa || !bb) return;
    const nA = Math.max(MIN_LEAF / d.scale, aa.size + shift / d.scale);
    const nB = bb.size - (nA - aa.size);
    if (nB < MIN_LEAF / d.scale) return;
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
      rebuilt.push(left);
    }
    if (wallEnd(m) > hi && wallEnd(m) - hi >= MIN_W) {
      const right = structuredClone(m);
      right.from = hi;
      right.w = wallEnd(right) - hi;
      rebuilt.push(right);
    }
  }
  const niche: WardModule = {
    id: uid('m'),
    wall: t.wall,
    from: lo,
    w: hi - lo,
    h: p.ceiling,
    depth: 450,
    root: leaf({ kind: 'open', shelves: 0 }),
  };
  draft.modules = [...others, ...rebuilt, niche];
  store.replace(draft);
  select({ kind: 'module', id: niche.id });
}
