import { store } from '../store.ts';
import { facadeView, ui, select, renderAll } from '../state.ts';
import {
  WALLS,
  CARCASS_T,
  cornerStart,
  findModule,
  layoutCells,
  modulesOn,
  shelfYs,
  totalElevationWidth,
  wallAtX,
  wallStart,
} from '../geometry.ts';
import { FACADE_FILLS, KIND_LABEL, WALL_LABEL } from '../defaults.ts';
import { validate } from '../validate.ts';
import {
  dragCellBoundary,
  insertModuleAtPointer,
  moveModule,
  moveSocket,
  moveTv,
  resizeModule,
  toggleCellFacade,
} from '../edit.ts';
import type { Cell, Project, WardModule, WallId } from '../types.ts';

const COL = {
  plate: '#151922',
  plateStroke: '#2b313d',
  floor: '#48505e',
  tick: '#3d4450',
  dim: '#8b94a3',
  carcass: '#5d4531',
  partition: '#4a3524',
  interior: '#241c15',
  shelf: '#8a6a48',
  plinth: '#2a2119',
  accent: '#4da3ff',
  cell: '#ffd166',
  danger: '#ff5252',
  warn: '#ffb74d',
  corner: '#39414f',
};

const DEFAULT_FILL: Record<string, string> = {
  door: '#c9a877',
  drawer: '#c9a877',
  glass: '#9fc3d8',
  panel: '#c2c6cc',
};

function fillOf(cell: Cell): string {
  if (cell.fill) return FACADE_FILLS[cell.fill] ?? cell.fill;
  return DEFAULT_FILL[cell.facade ?? 'panel'] ?? '#999';
}

// ------------------------------------------------- данные ↔ экранные координаты
// Данные: `from` вдоль стены; для боковых стен — от угла с центральной.
// Левая стена на фасаде зеркалится: угол — у правого края её плиты.

function isMirror(wall: WallId): boolean {
  return wall === 'left';
}

/** Точка данных (мм от начала стены) → x на фасаде. */
function elevOf(p: Project, wall: WallId, x0: number, dataX: number): number {
  return isMirror(wall) ? x0 + p.walls[wall].length - dataX : x0 + dataX;
}

/** X с фасада → точка данных (мм от начала стены). */
function dataOf(p: Project, wall: WallId, x0: number, elevX: number): number {
  return isMirror(wall) ? x0 + p.walls[wall].length - elevX : elevX - x0;
}

/** Знак для приращений: на левой стене движение мыши вправо — это «уменьшение from». */
function dataSign(wall: WallId): number {
  return isMirror(wall) ? -1 : 1;
}

// ---------------------------------------------------------------- rendering

let svg: SVGSVGElement;

function applyViewBox(): void {
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const vw = r.width / facadeView.zoom;
  const vh = r.height / facadeView.zoom;
  svg.setAttribute(
    'viewBox',
    `${facadeView.cx - vw / 2} ${facadeView.cy - vh / 2} ${vw} ${vh}`,
  );
}

export function fitFacade(): void {
  if (!svg) return;
  const p = store.project;
  const r = svg.getBoundingClientRect();
  const total = totalElevationWidth(p);
  if (!r || !r.width) return;
  facadeView.zoom = Math.min(r.width / (total + 500), r.height / (p.ceiling + 420));
  facadeView.cx = total / 2;
  facadeView.cy = p.ceiling / 2 - 20;
  renderFacade();
}

export function renderFacade(): void {
  if (!svg) return;
  const p = store.project;
  const C = p.ceiling;
  const fy = (yMm: number) => C - yMm;
  const starts = wallStart(p);
  const issues = validate(p);
  const errorIds = new Set(issues.filter((i) => i.level === 'error').flatMap((i) => i.refs));
  const warnIds = new Set(issues.filter((i) => i.level === 'warn').flatMap((i) => i.refs));
  const sel = ui.sel;

  const parts: string[] = [];
  parts.push(`<g font-family="ui-sans-serif, system-ui, sans-serif">`);

  for (const w of WALLS) {
    const x0 = starts[w];
    const len = p.walls[w].length;
    const active = ui.wall === w;
    parts.push(
      `<rect data-hit="wall" data-wall="${w}" x="${x0 - 40}" y="-70" width="${len + 80}" height="${C + 130}" fill="${COL.plate}" stroke="${active ? COL.accent : COL.plateStroke}" stroke-width="2" vector-effect="non-scaling-stroke" rx="8"/>`,
      `<text x="${x0}" y="${-110}" font-size="60" fill="${active ? COL.accent : COL.dim}">${WALL_LABEL[w]} — ${len} мм</text>`,
      `<line x1="${x0}" y1="${fy(0)}" x2="${x0 + len}" y2="${fy(0)}" stroke="${COL.floor}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`,
    );
    // риски: отсчёт от начала стены (у боковых — от угла)
    for (let t = 500; t < len; t += 500) {
      const xT = elevOf(p, w, x0, t);
      parts.push(
        `<line x1="${xT}" y1="${fy(0)}" x2="${xT}" y2="${fy(0) - 26}" stroke="${COL.tick}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`,
      );
      if (t % 1000 === 0)
        parts.push(
          `<text x="${xT}" y="${fy(0) + 75}" font-size="46" fill="${COL.tick}" text-anchor="middle">${t}</text>`,
        );
    }
    // угловая зона боковой стены (глубина центрального ряда)
    if (w !== 'center') {
      const cs = cornerStart(p, w);
      if (cs > 0) {
        const rx = isMirror(w) ? x0 + len - cs : x0;
        const clipId = `corner-clip-${w}`;
        let hatch = '';
        for (let q = -C; q < cs + 40; q += 150) {
          hatch += `<line x1="${rx + q}" y1="${-70}" x2="${rx + q + C + 140}" y2="${C + 60}" stroke="${COL.corner}" stroke-width="14" opacity="0.28" vector-effect="non-scaling-stroke"/>`;
        }
        parts.push(
          `<clipPath id="${clipId}"><rect x="${rx}" y="-70" width="${cs}" height="${C + 130}"/></clipPath>`,
          `<g clip-path="url(#${clipId})">${hatch}</g>`,
          `<line x1="${rx + (isMirror(w) ? cs : 0)}" y1="${-70}" x2="${rx + (isMirror(w) ? cs : 0)}" y2="${fy(0)}" stroke="${COL.corner}" stroke-width="2" stroke-dasharray="30 24" vector-effect="non-scaling-stroke"/>`,
          `<text x="${rx + 14}" y="${-24}" font-size="42" fill="${COL.dim}">угол ${cs}</text>`,
        );
      }
    }
  }

  for (const w of WALLS) {
    const x0 = starts[w];
    for (const m of modulesOn(p, w)) {
      const isSel = sel?.kind === 'module' && sel.id === m.id;
      parts.push(
        renderModule(p, m, w, x0, fy, errorIds.has(m.id), isSel, isSel ? ui.cell : null),
      );
    }
  }

  if (p.tv) {
    const t = p.tv;
    const x0 = starts[t.wall];
    const bad = errorIds.has('tv');
    const isSel = sel?.kind === 'tv';
    const a = t.centerX - t.w / 2;
    const left = isMirror(t.wall) ? x0 + p.walls[t.wall].length - (a + t.w) : x0 + a;
    const top = fy(t.centerY + t.h / 2);
    parts.push(
      `<g data-hit="tv" style="cursor:grab">`,
      `<rect x="${left}" y="${top}" width="${t.w}" height="${t.h}" rx="10" fill="#0c0e12" stroke="${bad ? COL.danger : isSel ? COL.accent : '#59616e'}" stroke-width="${bad || isSel ? 3 : 1.5}" vector-effect="non-scaling-stroke"/>`,
      `<rect x="${left + t.w * 0.03}" y="${top + t.h * 0.04}" width="${t.w * 0.94}" height="${t.h * 0.8}" rx="4" fill="#1d2836"/>`,
      `<text x="${elevOf(p, t.wall, x0, t.centerX)}" y="${fy(t.centerY) + 18}" font-size="${Math.min(90, t.h * 0.3)}" fill="#42536b" text-anchor="middle">ТВ</text>`,
      `</g>`,
    );
  }

  for (const s of p.sockets) {
    const x0 = starts[s.wall];
    const bad = warnIds.has(s.id) || errorIds.has(s.id);
    const isSel = sel?.kind === 'socket' && sel.id === s.id;
    const cx = elevOf(p, s.wall, x0, s.x);
    const cy = fy(s.y);
    parts.push(
      `<g data-hit="socket" data-id="${s.id}" style="cursor:grab">`,
      `<rect x="${cx - 42}" y="${cy - 42}" width="84" height="84" rx="14" fill="${bad ? '#3a1d1d' : '#f2efe8'}" stroke="${bad ? COL.danger : isSel ? COL.accent : '#5c6470'}" stroke-width="2" vector-effect="non-scaling-stroke"/>`,
      `<circle cx="${cx - 16}" cy="${cy}" r="7" fill="${bad ? COL.danger : '#20242b'}"/>`,
      `<circle cx="${cx + 16}" cy="${cy}" r="7" fill="${bad ? COL.danger : '#20242b'}"/>`,
      `</g>`,
    );
  }

  // хендлы: синие — края модуля, жёлтые — границы секций
  if (sel?.kind === 'module') {
    const m = findModule(p, sel.id);
    if (m) {
      const x0 = starts[m.wall];
      const hh = 150;
      for (const [dir, dataEdge] of [
        ['l', m.from],
        ['r', m.from + m.w],
      ] as const) {
        const hx = elevOf(p, m.wall, x0, dataEdge);
        parts.push(
          `<g data-hit="edge" data-id="${m.id}" data-dir="${dir}" style="cursor:col-resize">`,
          `<rect x="${hx - 18}" y="${fy(m.h)}" width="36" height="${m.h}" fill="${COL.accent}" opacity="0.3"/>`,
          `<rect x="${hx - 24}" y="${fy(m.h) + (m.h - hh) / 2}" width="48" height="${hh}" rx="14" fill="${COL.accent}"/>`,
          `<line x1="${hx - 6}" y1="${fy(m.h) + m.h / 2 - 20}" x2="${hx - 6}" y2="${fy(m.h) + m.h / 2 + 20}" stroke="#0b1220" stroke-width="4"/>`,
          `<line x1="${hx + 6}" y1="${fy(m.h) + m.h / 2 - 20}" x2="${hx + 6}" y2="${fy(m.h) + m.h / 2 + 20}" stroke="#0b1220" stroke-width="4"/>`,
          `</g>`,
        );
      }
      if (m.cells.length > 1) {
        const layout = layoutCells(p, m);
        for (let i = 0; i < layout.length - 1; i++) {
          const hx = elevOf(p, m.wall, x0, layout[i].x + layout[i].w);
          parts.push(
            `<g data-hit="cell-edge" data-id="${m.id}" data-idx="${i}" style="cursor:col-resize">`,
            `<rect x="${hx - 16}" y="${fy(m.h)}" width="32" height="${m.h - p.base}" fill="${COL.cell}" opacity="0.22"/>`,
            `<rect x="${hx - 20}" y="${fy(m.h) + (m.h - p.base - hh) / 2}" width="40" height="${hh}" rx="12" fill="${COL.cell}"/>`,
            `<line x1="${hx - 5}" y1="${fy(m.h) + (m.h - p.base) / 2 - 18}" x2="${hx - 5}" y2="${fy(m.h) + (m.h - p.base) / 2 + 18}" stroke="#3a2c00" stroke-width="3.5"/>`,
            `<line x1="${hx + 5}" y1="${fy(m.h) + (m.h - p.base) / 2 - 18}" x2="${hx + 5}" y2="${fy(m.h) + (m.h - p.base) / 2 + 18}" stroke="#3a2c00" stroke-width="3.5"/>`,
            `</g>`,
          );
        }
      }
      parts.push(
        `<text x="${elevOf(p, m.wall, x0, m.from + m.w / 2)}" y="${fy(0) + 170}" font-size="58" fill="${COL.accent}" text-anchor="middle">${m.w} × ${m.h} × ${m.depth}</text>`,
      );
    }
  }

  parts.push(`</g>`);
  svg.innerHTML = parts.join('');
  applyViewBox();
}

function renderModule(
  p: Project,
  m: WardModule,
  wall: WallId,
  x0: number,
  fy: (y: number) => number,
  hasError: boolean,
  isSel: boolean,
  selCell: number | null,
): string {
  const mirror = isMirror(wall);
  const len = p.walls[wall].length;
  // точка данных → x фасада (с зеркалом левой стены)
  const ex = (dataX: number) => (mirror ? x0 + len - dataX : x0 + dataX);
  // левый край прямоугольника, покрывающего данные [d1, d1+w]
  const span = (d1: number, w: number) => (mirror ? ex(d1 + w) : ex(d1));

  const X = span(m.from, m.w);
  const Y = fy(m.h);
  const bodyH = m.h - p.base;
  const T = CARCASS_T;
  const out: string[] = [];
  out.push(
    `<g data-hit="mod" data-id="${m.id}" data-wall="${wall}" style="cursor:grab">`,
    `<title>${KIND_LABEL[m.kind]} · ${m.w}×${m.h}×${m.depth} мм</title>`,
    `<rect x="${X}" y="${Y}" width="${m.w}" height="${m.h}" fill="${COL.carcass}"/>`,
    `<rect x="${X + T / 2}" y="${Y + T / 2}" width="${Math.max(0, m.w - T)}" height="${Math.max(0, bodyH - T / 2)}" fill="${COL.interior}"/>`,
  );

  const layout = layoutCells(p, m);
  for (const cl of layout) {
    const cx = span(cl.x, cl.w);
    const open = cl.cell.facade === null;
    out.push(`<g data-hit="cell" data-id="${m.id}" data-idx="${cl.index}" style="cursor:pointer">`);
    out.push(
      `<title>Секция ${cl.index + 1}: ${cl.cell.facade ?? 'открытая'}, ${Math.round(cl.cell.w)} мм</title>`,
    );
    if (open) {
      for (const y of shelfYs(m, p, cl.cell)) {
        out.push(
          `<rect x="${cx + T / 2}" y="${fy(y) - 8}" width="${Math.max(0, cl.w - T)}" height="16" fill="${COL.shelf}" stroke="#00000044" stroke-width="1" vector-effect="non-scaling-stroke"/>`,
        );
      }
    } else {
      const f = fillOf(cl.cell);
      const kind = cl.cell.facade as string;
      out.push(
        `<rect x="${cx}" y="${Y}" width="${cl.w}" height="${bodyH}" fill="${f}" stroke="#00000066" stroke-width="1" vector-effect="non-scaling-stroke"/>`,
      );
      if (kind === 'door') {
        const hingeLeft = cl.cell.hinge !== 'right';
        // петли и ручка считаем в данных, зеркалит ex()
        const hx = ex(cl.x + (hingeLeft ? 8 : cl.w - 8));
        const gx = ex(cl.x + (hingeLeft ? cl.w - 42 : 42));
        out.push(
          `<line x1="${hx}" y1="${Y + 12}" x2="${hx}" y2="${Y + bodyH - 12}" stroke="#00000044" stroke-width="2" vector-effect="non-scaling-stroke"/>`,
          `<rect x="${gx - 6}" y="${Y + bodyH / 2 - 110}" width="12" height="220" rx="6" fill="#2f2620"/>`,
        );
      } else if (kind === 'drawer') {
        const n = Math.max(1, Math.round(cl.cell.drawers));
        const dh = bodyH / n;
        for (let d = 1; d < n; d++) {
          out.push(
            `<line x1="${cx + 6}" y1="${Y + dh * d}" x2="${cx + cl.w - 6}" y2="${Y + dh * d}" stroke="#00000066" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`,
          );
        }
        for (let d = 0; d < n; d++) {
          out.push(
            `<line x1="${cx + cl.w * 0.3}" y1="${Y + dh * (d + 0.5)}" x2="${cx + cl.w * 0.7}" y2="${Y + dh * (d + 0.5)}" stroke="#2f2620" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`,
          );
        }
      } else if (kind === 'glass') {
        out.push(
          `<line x1="${cx + cl.w * 0.15}" y1="${Y + bodyH * 0.85}" x2="${cx + cl.w * 0.6}" y2="${Y + bodyH * 0.15}" stroke="#ffffff55" stroke-width="3" vector-effect="non-scaling-stroke"/>`,
        );
      }
    }
    if (isSel && selCell === cl.index) {
      out.push(
        `<rect x="${cx + 2}" y="${Y + 2}" width="${Math.max(0, cl.w - 4)}" height="${bodyH - 4}" fill="none" stroke="${COL.cell}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`,
      );
    }
    out.push(`</g>`);
  }

  // перегородки между секциями
  for (let i = 1; i < layout.length; i++) {
    const bx = ex(layout[i].x);
    out.push(
      `<rect x="${bx - T / 2}" y="${Y + T / 2}" width="${T}" height="${bodyH - T / 2}" fill="${COL.partition}"/>`,
    );
  }

  if (p.base > 0)
    out.push(
      `<rect x="${X + 24}" y="${fy(p.base)}" width="${Math.max(0, m.w - 48)}" height="${p.base}" fill="${COL.plinth}"/>`,
    );

  out.push(
    `<rect x="${X}" y="${Y}" width="${m.w}" height="${m.h}" fill="none" stroke="${hasError ? COL.danger : isSel ? COL.accent : '#00000088'}" stroke-width="${hasError || isSel ? 2.5 : 1.5}" vector-effect="non-scaling-stroke"/>`,
    `</g>`,
  );
  return out.join('');
}

// ---------------------------------------------------------------- interaction

interface DragState {
  mode: 'move' | 'edge' | 'cell-edge' | 'tv' | 'socket' | 'pan';
  id?: string;
  dir?: 'l' | 'r';
  idx?: number;
  wall?: WallId;
  sign: number;
  startMmX: number;
  startMmY: number;
  lastClientX: number;
  lastClientY: number;
  origFrom: number;
  origW: number;
  origCx: number;
  origCy: number;
  moved: boolean;
  needCp: boolean;
}

let drag: DragState | null = null;

function toMm(e: MouseEvent): { x: number; y: number } {
  const r = svg.getBoundingClientRect();
  const vw = r.width / facadeView.zoom;
  const vh = r.height / facadeView.zoom;
  return {
    x: facadeView.cx - vw / 2 + ((e.clientX - r.left) / r.width) * vw,
    y: facadeView.cy - vh / 2 + ((e.clientY - r.top) / r.height) * vh,
  };
}

function floorY(mm: { x: number; y: number }): number {
  return store.project.ceiling - mm.y;
}

export function attachFacade(el: SVGSVGElement): void {
  svg = el;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const mm = toMm(e);
    const target = (e.target as Element).closest('[data-hit]');
    const hit = target?.getAttribute('data-hit') ?? null;
    el.setPointerCapture(e.pointerId);
    const base: DragState = {
      mode: 'pan',
      sign: 1,
      startMmX: mm.x,
      startMmY: mm.y,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      origFrom: 0,
      origW: 0,
      origCx: 0,
      origCy: 0,
      moved: false,
      needCp: false,
    };
    if (hit === 'edge' && target) {
      const id = target.getAttribute('data-id') ?? '';
      const m = findModule(store.project, id);
      if (m) {
        select({ kind: 'module', id });
        ui.wall = m.wall;
        drag = {
          ...base,
          mode: 'edge',
          id,
          dir: (target.getAttribute('data-dir') as 'l' | 'r') ?? 'r',
          wall: m.wall,
          sign: dataSign(m.wall),
          origFrom: m.from,
          origW: m.w,
          needCp: true,
        };
      }
    } else if (hit === 'cell-edge' && target) {
      const id = target.getAttribute('data-id') ?? '';
      const idx = Number(target.getAttribute('data-idx'));
      const m = findModule(store.project, id);
      if (m && Number.isFinite(idx)) {
        drag = {
          ...base,
          mode: 'cell-edge',
          id,
          idx,
          wall: m.wall,
          sign: dataSign(m.wall),
          needCp: true,
        };
      }
    } else if (hit === 'cell' && target) {
      const id = target.getAttribute('data-id') ?? '';
      const idx = Number(target.getAttribute('data-idx'));
      const m = findModule(store.project, id);
      if (m) {
        select({ kind: 'module', id }, Number.isFinite(idx) ? idx : null);
        ui.wall = m.wall;
        drag = {
          ...base,
          mode: 'move',
          id,
          wall: m.wall,
          sign: dataSign(m.wall),
          origFrom: m.from,
          origW: m.w,
          needCp: true,
        };
      }
    } else if (hit === 'mod' && target) {
      const id = target.getAttribute('data-id') ?? '';
      const m = findModule(store.project, id);
      if (m) {
        select({ kind: 'module', id });
        ui.wall = m.wall;
        drag = {
          ...base,
          mode: 'move',
          id,
          wall: m.wall,
          sign: dataSign(m.wall),
          origFrom: m.from,
          origW: m.w,
          needCp: true,
        };
      }
    } else if (hit === 'tv' && store.project.tv) {
      select({ kind: 'tv', id: 'tv' });
      const t = store.project.tv;
      ui.wall = t.wall;
      drag = {
        ...base,
        mode: 'tv',
        wall: t.wall,
        sign: dataSign(t.wall),
        origCx: t.centerX,
        origCy: t.centerY,
        needCp: true,
      };
    } else if (hit === 'socket' && target) {
      const id = target.getAttribute('data-id') ?? '';
      const s = store.project.sockets.find((v) => v.id === id);
      if (s) {
        select({ kind: 'socket', id });
        ui.wall = s.wall;
        drag = {
          ...base,
          mode: 'socket',
          id,
          wall: s.wall,
          sign: dataSign(s.wall),
          origCx: s.x,
          origCy: s.y,
          needCp: true,
        };
      }
    } else {
      if (target?.getAttribute('data-hit') === 'wall') {
        const w = target.getAttribute('data-wall');
        if (w === 'left' || w === 'center' || w === 'right') ui.wall = w;
      }
      drag = base;
    }
    renderAll();
  });

  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.mode === 'pan') {
      const dxPx = e.clientX - drag.lastClientX;
      const dyPx = e.clientY - drag.lastClientY;
      if (Math.abs(dxPx) + Math.abs(dyPx) > 2) drag.moved = true;
      facadeView.cx -= dxPx / facadeView.zoom;
      facadeView.cy -= dyPx / facadeView.zoom;
      drag.lastClientX = e.clientX;
      drag.lastClientY = e.clientY;
      applyViewBox();
      return;
    }
    drag.moved = true;
    if (drag.needCp) {
      store.checkpoint();
      drag.needCp = false;
    }
    const p = store.project;
    const mm = toMm(e);
    const dxE = mm.x - drag.startMmX; // экранное смещение
    const dx = drag.sign * dxE; // в данных
    const dy = -(mm.y - drag.startMmY);
    if (drag.mode === 'move' && drag.id) moveModule(drag.id, drag.origFrom + dx);
    else if (drag.mode === 'edge' && drag.id && drag.dir)
      resizeModule(
        drag.id,
        drag.dir,
        (drag.dir === 'l' ? drag.origFrom : drag.origFrom + drag.origW) + dx,
      );
    else if (drag.mode === 'cell-edge' && drag.id && drag.wall && drag.idx !== undefined) {
      const localData = dataOf(p, drag.wall, wallStart(p)[drag.wall], mm.x);
      dragCellBoundary(drag.id, drag.idx, localData);
    } else if (drag.mode === 'tv') moveTv(drag.origCx + dx, drag.origCy + dy);
    else if (drag.mode === 'socket' && drag.id) moveSocket(drag.id, drag.origCx + dx, drag.origCy + dy);
  });

  const endDrag = () => {
    if (drag?.mode === 'pan' && !drag.moved) {
      select(null);
      renderAll();
    }
    drag = null;
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const mm = toMm(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    const z = Math.min(1.6, Math.max(0.03, facadeView.zoom * factor));
    facadeView.cx = mm.x - (mm.x - facadeView.cx) * (facadeView.zoom / z);
    facadeView.cy = mm.y - (mm.y - facadeView.cy) * (facadeView.zoom / z);
    facadeView.zoom = z;
    applyViewBox();
  }, { passive: false });

  el.addEventListener('dblclick', (e) => {
    const target = (e.target as Element).closest('[data-hit]');
    const hit = target?.getAttribute('data-hit') ?? null;
    const mm = toMm(e);
    const p = store.project;
    if (hit === 'cell' && target) {
      const id = target.getAttribute('data-id') ?? '';
      const m = findModule(p, id);
      if (!m) return;
      const localData = dataOf(p, m.wall, wallStart(p)[m.wall], mm.x);
      toggleCellFacade(id, localData, floorY(mm));
    } else if (hit === 'wall') {
      const at = wallAtX(p, mm.x);
      if (!at) return;
      const elevGlobal = wallStart(p)[at.wall] + at.local;
      insertModuleAtPointer('wardrobe', at.wall, dataOf(p, at.wall, wallStart(p)[at.wall], elevGlobal));
    }
  });
}
