import { store } from '../store.ts';
import { facadeView, ui, select, renderAll } from '../state.ts';
import {
  WALLS,
  findModule,
  layoutFacade,
  modulesOn,
  totalElevationWidth,
  wallAtX,
  wallStart,
} from '../geometry.ts';
import { FACADE_FILLS, KIND_LABEL, WALL_LABEL } from '../defaults.ts';
import { validate } from '../validate.ts';
import {
  cycleCellType,
  insertModuleAtPointer,
  moveModule,
  moveSocket,
  moveTv,
  resizeModule,
} from '../edit.ts';
import type { FacadeCell, Project, WardModule } from '../types.ts';

const COL = {
  plate: '#151922',
  plateStroke: '#2b313d',
  floor: '#48505e',
  tick: '#3d4450',
  dim: '#8b94a3',
  body: '#6b5138',
  plinth: '#2a2119',
  accent: '#4da3ff',
  danger: '#ff5252',
  warn: '#ffb74d',
};

const CELL_DEFAULT_FILL: Record<string, string> = {
  door: '#c9a877',
  drawer: '#c9a877',
  glass: '#9fc3d8',
  panel: '#c2c6cc',
  open: '#241c15',
};

function fillOf(cell: FacadeCell): string {
  if (cell.fill) return FACADE_FILLS[cell.fill] ?? cell.fill;
  return CELL_DEFAULT_FILL[cell.type] ?? '#999';
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
  const p = store.project;
  const r = svg?.getBoundingClientRect();
  const total = totalElevationWidth(p);
  if (!r || !r.width) return;
  facadeView.zoom = Math.min(r.width / (total + 500), r.height / (p.ceiling + 420));
  facadeView.cx = total / 2;
  facadeView.cy = p.ceiling / 2 - 20;
  if (svg) renderFacade();
}

export function renderFacade(): void {
  if (!svg) return;
  const p = store.project;
  const C = p.ceiling;
  const fy = (yMm: number) => C - yMm; // пол → y=C, потолок → y=0
  const starts = wallStart(p);
  const issues = validate(p);
  const errorIds = new Set(issues.filter((i) => i.level === 'error').flatMap((i) => i.refs));
  const warnIds = new Set(issues.filter((i) => i.level === 'warn').flatMap((i) => i.refs));
  const sel = ui.sel;

  const parts: string[] = [];
  parts.push(
    `<g font-family="ui-sans-serif, system-ui, sans-serif" text-rendering="geometricPrecision">`,
  );

  // стены
  for (const w of WALLS) {
    const x0 = starts[w];
    const len = p.walls[w].length;
    const active = ui.wall === w;
    parts.push(
      `<rect data-hit="wall" data-wall="${w}" x="${x0 - 40}" y="-70" width="${len + 80}" height="${C + 130}" fill="${COL.plate}" stroke="${active ? COL.accent : COL.plateStroke}" stroke-width="2" vector-effect="non-scaling-stroke" rx="8"/>`,
    );
    parts.push(
      `<text x="${x0}" y="${-110}" font-size="60" fill="${active ? COL.accent : COL.dim}">${WALL_LABEL[w]} — ${len} мм</text>`,
    );
    // рифлёный пол-багет
    parts.push(
      `<line x1="${x0}" y1="${fy(0)}" x2="${x0 + len}" y2="${fy(0)}" stroke="${COL.floor}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`,
    );
    for (let t = 0; t <= len; t += 500) {
      parts.push(
        `<line x1="${x0 + t}" y1="${fy(0)}" x2="${x0 + t}" y2="${fy(0) - 26}" stroke="${COL.tick}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`,
      );
      if (t % 1000 === 0 && t > 0)
        parts.push(
          `<text x="${x0 + t}" y="${fy(0) + 75}" font-size="46" fill="${COL.tick}" text-anchor="middle">${t}</text>`,
        );
    }
  }

  // модули
  for (const w of WALLS) {
    const x0 = starts[w];
    for (const m of modulesOn(p, w)) {
      parts.push(renderModule(p, m, x0, fy, errorIds.has(m.id), warnIds.has(m.id), sel?.kind === 'module' && sel.id === m.id));
    }
  }

  // ТВ поверх фасадов (иначе не выбрать при конфликте)
  if (p.tv) {
    const t = p.tv;
    const x0 = starts[t.wall];
    const bad = errorIds.has('tv');
    const isSel = sel?.kind === 'tv';
    const left = x0 + t.centerX - t.w / 2;
    const top = fy(t.centerY + t.h / 2);
    parts.push(
      `<g data-hit="tv" style="cursor:grab">`,
      `<rect x="${left}" y="${top}" width="${t.w}" height="${t.h}" rx="10" fill="#0c0e12" stroke="${bad ? COL.danger : isSel ? COL.accent : '#59616e'}" stroke-width="${bad || isSel ? 3 : 1.5}" vector-effect="non-scaling-stroke"/>`,
      `<rect x="${left + t.w * 0.03}" y="${top + t.h * 0.04}" width="${t.w * 0.94}" height="${t.h * 0.8}" rx="4" fill="#1d2836"/>`,
      `<text x="${x0 + t.centerX}" y="${fy(t.centerY) + 18}" font-size="${Math.min(90, t.h * 0.3)}" fill="#42536b" text-anchor="middle">ТВ</text>`,
      `</g>`,
    );
  }

  // розетки
  for (const s of p.sockets) {
    const x0 = starts[s.wall];
    const bad = warnIds.has(s.id) || errorIds.has(s.id);
    const isSel = sel?.kind === 'socket' && sel.id === s.id;
    const cx = x0 + s.x;
    const cy = fy(s.y);
    parts.push(
      `<g data-hit="socket" data-id="${s.id}" style="cursor:grab">`,
      `<rect x="${cx - 42}" y="${cy - 42}" width="84" height="84" rx="14" fill="${bad ? '#3a1d1d' : '#f2efe8'}" stroke="${bad ? COL.danger : isSel ? COL.accent : '#5c6470'}" stroke-width="2" vector-effect="non-scaling-stroke"/>`,
      `<circle cx="${cx - 16}" cy="${cy}" r="7" fill="${bad ? COL.danger : '#20242b'}"/>`,
      `<circle cx="${cx + 16}" cy="${cy}" r="7" fill="${bad ? COL.danger : '#20242b'}"/>`,
      `</g>`,
    );
  }

  // хендлы ресайза выбранного модуля (сверху всего)
  if (sel?.kind === 'module') {
    const m = findModule(p, sel.id);
    if (m) {
      const x0 = starts[m.wall];
      const hh = 150;
      for (const dir of ['l', 'r'] as const) {
        const hx = dir === 'l' ? x0 + m.from : x0 + m.from + m.w;
        parts.push(
          `<g data-hit="edge" data-id="${m.id}" data-dir="${dir}" style="cursor:col-resize">`,
          `<rect x="${hx - 18}" y="${fy(m.h)}" width="36" height="${m.h}" fill="${COL.accent}" opacity="0.35"/>`,
          `<rect x="${hx - 26}" y="${fy(m.h) + (m.h - hh) / 2}" width="52" height="${hh}" rx="14" fill="${COL.accent}"/>`,
          `<line x1="${hx - 7}" y1="${fy(m.h) + m.h / 2 - 22}" x2="${hx - 7}" y2="${fy(m.h) + m.h / 2 + 22}" stroke="#0b1220" stroke-width="4"/>`,
          `<line x1="${hx + 7}" y1="${fy(m.h) + m.h / 2 - 22}" x2="${hx + 7}" y2="${fy(m.h) + m.h / 2 + 22}" stroke="#0b1220" stroke-width="4"/>`,
          `</g>`,
        );
      }
      parts.push(
        `<text x="${x0 + m.from + m.w / 2}" y="${fy(0) + 170}" font-size="58" fill="${COL.accent}" text-anchor="middle">${m.w} × ${m.h} × ${m.depth}</text>`,
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
  x0: number,
  fy: (y: number) => number,
  hasError: boolean,
  hasWarn: boolean,
  isSel: boolean,
): string {
  const X = x0 + m.from;
  const Y = fy(m.h);
  const out: string[] = [];
  out.push(
    `<g data-hit="mod" data-id="${m.id}" data-wall="${m.wall}" style="cursor:grab" opacity="${isSel ? 1 : 0.97}">`,
    `<title>${KIND_LABEL[m.kind]} · ${m.w}×${m.h}×${m.depth} мм</title>`,
    // корпус
    `<rect x="${X}" y="${Y}" width="${m.w}" height="${m.h}" fill="${COL.body}"/>`,
  );
  // плинтус
  if (p.base > 0)
    out.push(
      `<rect x="${X + 24}" y="${fy(p.base)}" width="${Math.max(0, m.w - 48)}" height="${p.base}" fill="${COL.plinth}"/>`,
    );
  // фасад
  for (const row of layoutFacade(p, m)) {
    for (const c of row.cells) {
      const cell = c.cell;
      const cx = X + c.x;
      const cy = fy(row.y + row.h);
      const f = fillOf(cell);
      out.push(
        `<rect x="${cx}" y="${cy}" width="${c.w}" height="${row.h}" fill="${f}" stroke="#00000066" stroke-width="1" vector-effect="non-scaling-stroke"/>`,
      );
      if (cell.type === 'open') {
        for (let sy = row.y + 350; sy < row.y + row.h - 40; sy += 350) {
          out.push(
            `<line x1="${cx + 8}" y1="${fy(sy)}" x2="${cx + c.w - 8}" y2="${fy(sy)}" stroke="#00000055" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`,
          );
        }
      }
      if (cell.type === 'door') {
        const hingeLeft = cell.hinge !== 'right';
        const hx = hingeLeft ? cx + 10 : cx + c.w - 10;
        const gx = hingeLeft ? cx + c.w - 40 : cx + 40;
        out.push(
          `<line x1="${hx}" y1="${cy + 14}" x2="${hx}" y2="${cy + row.h - 14}" stroke="#00000044" stroke-width="2" vector-effect="non-scaling-stroke"/>`,
          `<rect x="${gx - 6}" y="${cy + row.h / 2 - 110}" width="12" height="220" rx="6" fill="#2f2620"/>`,
        );
      }
      if (cell.type === 'drawer') {
        out.push(
          `<line x1="${cx + c.w * 0.3}" y1="${cy + row.h / 2}" x2="${cx + c.w * 0.7}" y2="${cy + row.h / 2}" stroke="#2f2620" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`,
        );
      }
      if (cell.type === 'glass') {
        out.push(
          `<line x1="${cx + c.w * 0.15}" y1="${cy + row.h * 0.85}" x2="${cx + c.w * 0.6}" y2="${cy + row.h * 0.15}" stroke="#ffffff55" stroke-width="3" vector-effect="non-scaling-stroke"/>`,
        );
      }
    }
  }
  // габаритная линия
  out.push(
    `<rect x="${X}" y="${Y}" width="${m.w}" height="${m.h}" fill="none" stroke="${hasError ? COL.danger : isSel ? COL.accent : '#00000088'}" stroke-width="${hasError || isSel ? 2.5 : 1.5}" vector-effect="non-scaling-stroke"/>`,
  );
  if (hasWarn && !hasError)
    out.push(
      `<circle cx="${X + m.w - 34}" cy="${Y + 40}" r="16" fill="${COL.warn}"/>`,
    );
  out.push(`</g>`);
  return out.join('');
}

// ---------------------------------------------------------------- interaction

interface DragState {
  mode: 'move' | 'edge' | 'tv' | 'socket' | 'pan';
  id?: string;
  dir?: 'l' | 'r';
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

function floorY(e: MouseEvent): number {
  return store.project.ceiling - toMm(e).y;
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
        drag = { ...base, mode: 'edge', id, dir: (target.getAttribute('data-dir') as 'l' | 'r') ?? 'r', origFrom: m.from, origW: m.w, needCp: true };
      }
    } else if (hit === 'mod' && target) {
      const id = target.getAttribute('data-id') ?? '';
      const m = findModule(store.project, id);
      if (m) {
        select({ kind: 'module', id });
        ui.wall = m.wall;
        drag = { ...base, mode: 'move', id, origFrom: m.from, origW: m.w, needCp: true };
      }
    } else if (hit === 'tv' && store.project.tv) {
      select({ kind: 'tv', id: 'tv' });
      const t = store.project.tv;
      ui.wall = t.wall;
      drag = { ...base, mode: 'tv', origCx: t.centerX, origCy: t.centerY, needCp: true };
    } else if (hit === 'socket' && target) {
      const id = target.getAttribute('data-id') ?? '';
      const s = store.project.sockets.find((v) => v.id === id);
      if (s) {
        select({ kind: 'socket', id });
        ui.wall = s.wall;
        drag = { ...base, mode: 'socket', id, origCx: s.x, origCy: s.y, needCp: true };
      }
    } else {
      if (target?.getAttribute('data-hit') === 'wall') {
        const w = target.getAttribute('data-wall');
        if (w === 'left' || w === 'center' || w === 'right') ui.wall = w;
      }
      drag = { ...base, mode: e.button === 1 ? 'pan' : base.mode };
    }
    renderAll();
  });

  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.mode === 'pan') {
      const dxPx = e.clientX - drag.lastClientX;
      const dyPx = e.clientY - drag.lastClientY;
      if (Math.abs(e.clientX - drag.lastClientX) + Math.abs(e.clientY - drag.lastClientY) > 2)
        drag.moved = true;
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
    const mm = toMm(e);
    const dx = mm.x - drag.startMmX;
    const dy = -(mm.y - drag.startMmY); // инвертируем y: вверх положительные мм
    if (drag.mode === 'move' && drag.id) moveModule(drag.id, drag.origFrom + dx);
    else if (drag.mode === 'edge' && drag.id && drag.dir)
      resizeModule(drag.id, drag.dir, drag.dir === 'l' ? drag.origFrom + dx : drag.origFrom + drag.origW + dx);
    else if (drag.mode === 'tv') moveTv(drag.origCx + dx, drag.origCy + dy);
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
    if (hit === 'mod' && target) {
      const w = target.getAttribute('data-wall') as 'left' | 'center' | 'right' | null;
      if (!w) return;
      const local = mm.x - wallStart(store.project)[w];
      cycleCellType(target.getAttribute('data-id') ?? '', local, floorY(e));
    } else if (hit === 'wall') {
      const at = wallAtX(store.project, mm.x);
      if (at) insertModuleAtPointer('wardrobe', at.wall, at.local);
    }
  });
}
