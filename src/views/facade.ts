import { store } from '../store.ts';
import { facadeView, ui, select, renderAll } from '../state.ts';
import {
  WALLS,
  CARCASS_T,
  cornerZones,
  dividerSnapCandidates,
  findModule,
  layoutModule,
  modulesOn,
  shelfYsIn,
  snapTolerance,
  totalElevationWidth,
  wallAtX,
  wallStart,
} from '../geometry.ts';
import { FACADE_FILLS, WALL_LABEL } from '../defaults.ts';
import { validate } from '../validate.ts';
import {
  dragDivider,
  insertModuleAtPointer,
  moveModule,
  moveSocket,
  moveTv,
  resizeModule,
  toggleFace,
} from '../edit.ts';
import type { DividerBox, LeafBox } from '../geometry.ts';
import type { Path, Project, WardModule, WallId } from '../types.ts';

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
  drawers: '#c9a877',
  panel: '#c2c6cc',
  open: '#241c15',
};

function fillOf(fill: string | undefined, kind: string): string {
  if (fill) return FACADE_FILLS[fill] ?? fill;
  return DEFAULT_FILL[kind] ?? '#999';
}

// ------------------------------------------------- данные ↔ экран

function isMirror(wall: WallId): boolean {
  return wall === 'left';
}

function elevOf(p: Project, wall: WallId, x0: number, dataX: number): number {
  return isMirror(wall) ? x0 + p.walls[wall].length - dataX : x0 + dataX;
}

function dataOf(p: Project, wall: WallId, x0: number, elevX: number): number {
  return isMirror(wall) ? x0 + p.walls[wall].length - elevX : elevX - x0;
}

function dataSign(wall: WallId): number {
  return isMirror(wall) ? -1 : 1;
}

function pathStr(path: Path): string {
  return path.join('.');
}

export function pathParse(s: string): Path {
  return s === '' ? [] : s.split('.').map(Number);
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
    // угловые зоны: начало и конец стены, зеркалится только левая
    const z = cornerZones(p, w);
    const hatch = (dataFrom: number, dataTo: number, label: string) => {
      if (dataTo - dataFrom < 10) return;
      const a = Math.min(dataFrom, dataTo);
      const wd = Math.abs(dataTo - dataFrom);
      const rx = isMirror(w) ? x0 + len - (a + wd) : x0 + a;
      const clipId = `cz-${w}-${dataFrom}`;
      let lines = '';
      for (let q = -C; q < wd + 40; q += 150) {
        lines += `<line x1="${rx + q}" y1="${-70}" x2="${rx + q + C + 140}" y2="${C + 60}" stroke="${COL.corner}" stroke-width="14" opacity="0.28" vector-effect="non-scaling-stroke"/>`;
      }
      parts.push(
        `<clipPath id="${clipId}"><rect x="${rx}" y="-70" width="${wd}" height="${C + 130}"/></clipPath>`,
        `<g clip-path="url(#${clipId})">${lines}</g>`,
      );
      const edgeX = isMirror(w) ? rx + wd : rx;
      parts.push(
        `<line x1="${edgeX}" y1="${-70}" x2="${edgeX}" y2="${fy(0)}" stroke="${COL.corner}" stroke-width="2" stroke-dasharray="30 24" vector-effect="non-scaling-stroke"/>`,
        `<text x="${rx + 14}" y="${-24}" font-size="42" fill="${COL.dim}">${label}</text>`,
      );
    };
    if (z.start > 0) hatch(0, z.start, `угол ${z.start}`);
    if (z.end > 0) hatch(len - z.end, len, `угол ${z.end}`);
  }

  for (const w of WALLS) {
    const x0 = starts[w];
    for (const m of modulesOn(p, w)) {
      const isSel = sel?.kind === 'module' && sel.id === m.id;
      parts.push(renderModule(p, m, w, x0, fy, errorIds.has(m.id), isSel));
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

  // подсветка сработавшей привязки разделителя
  if (drag?.mode === 'divider' && drag.snapAt !== null && drag.wall && drag.axis) {
    const dm = drag.id ? findModule(p, drag.id) : undefined;
    if (dm && dm.wall === drag.wall) {
      const x0 = starts[drag.wall];
      if (drag.axis === 'h') {
        const yLine = fy(drag.snapAt);
        parts.push(
          `<line x1="${x0 + dm.from - 30}" y1="${yLine}" x2="${x0 + dm.from + dm.w + 30}" y2="${yLine}" stroke="${COL.cell}" stroke-width="3" stroke-dasharray="40 24" vector-effect="non-scaling-stroke"/>`,
        );
      } else {
        const xLine = elevOf(p, drag.wall, x0, drag.snapAt);
        parts.push(
          `<line x1="${xLine}" y1="${fy(dm.h) - 30}" x2="${xLine}" y2="${fy(0)}" stroke="${COL.cell}" stroke-width="3" stroke-dasharray="40 24" vector-effect="non-scaling-stroke"/>`,
        );
      }
    }
  }

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
      parts.push(
        `<text x="${elevOf(p, m.wall, x0, m.from + m.w / 2)}" y="${fy(0) + 170}" font-size="58" fill="${COL.accent}" text-anchor="middle">${m.w} × ${m.h} × ${m.depth}</text>`,
      );
    }
  }

  parts.push(`</g>`);
  svg.innerHTML = parts.join('');
  applyViewBox();
}

// --------------------------------------------------------------- модуль

interface RenderCtx {
  p: Project;
  wall: WallId;
  x0: number;
  fy: (y: number) => number;
  span: (d1: number, w: number) => number; // левый x фасада для данных [d1, d1+w]
  ex: (d: number) => number; // точка данных → x
}

function renderModule(
  p: Project,
  m: WardModule,
  wall: WallId,
  x0: number,
  fy: (y: number) => number,
  hasError: boolean,
  isSel: boolean,
): string {
  const mirror = isMirror(wall);
  const len = p.walls[wall].length;
  const ex = (d: number) => (mirror ? x0 + len - d : x0 + d);
  const span = (d1: number, w: number) => (mirror ? ex(d1 + w) : ex(d1));
  const ctx: RenderCtx = { p, wall, x0, fy, span, ex };

  const X = span(m.from, m.w);
  const Y = fy(m.h);
  const T = CARCASS_T;
  const out: string[] = [];
  out.push(
    `<g data-hit="mod" data-id="${m.id}" data-wall="${wall}" style="cursor:grab">`,
    `<title>Контейнер · ${m.w}×${m.h}×${m.depth} мм</title>`,
    `<rect x="${X}" y="${Y}" width="${m.w}" height="${m.h}" fill="${COL.carcass}"/>`,
    `<rect x="${X + T / 2}" y="${Y + T / 2}" width="${Math.max(0, m.w - T)}" height="${Math.max(0, m.h - T)}" fill="${COL.interior}"/>`,
  );

  const { leaves, dividers } = layoutModule(p, m);
  for (const lb of leaves) out.push(renderLeaf(ctx, m, lb, isSel));
  for (const d of dividers) out.push(renderDividerStructure(ctx, d));

  if (p.base > 0)
    out.push(
      `<rect x="${X + 24}" y="${fy(p.base)}" width="${Math.max(0, m.w - 48)}" height="${p.base}" fill="${COL.plinth}"/>`,
    );

  out.push(
    `<rect x="${X}" y="${Y}" width="${m.w}" height="${m.h}" fill="none" stroke="${hasError ? COL.danger : isSel ? COL.accent : '#00000088'}" stroke-width="${hasError || isSel ? 2.5 : 1.5}" vector-effect="non-scaling-stroke"/>`,
    `</g>`,
  );

  // грифы разделителей — поверх, при выбранном модуле.
  // Зона захвата строго в границах самой перегородки (d.x/y/w/h), чтобы не перекрывать ячейки.
  if (isSel) {
    for (const d of dividers) {
      const label = pathStr(d.path);
      if (d.dir === 'v') {
        // вертикальная перегородка: тонкая по x, тянется по y в пределах своего сплита
        const cx = span(d.x + d.w / 2, 0);
        const topY = fy(d.y + d.h);
        const dh = d.h;
        out.push(
          `<g data-hit="divider" data-id="${m.id}" data-path="${label}" data-after="${d.after}" data-dir="v" style="cursor:col-resize">`,
          `<rect x="${cx - 15}" y="${topY}" width="30" height="${dh}" fill="${COL.cell}" opacity="0.18"/>`,
          `<rect x="${cx - 18}" y="${topY + (dh - 140) / 2}" width="36" height="${Math.min(140, dh * 0.6)}" rx="11" fill="${COL.cell}"/>`,
          `<line x1="${cx - 4}" y1="${topY + dh / 2 - 16}" x2="${cx - 4}" y2="${topY + dh / 2 + 16}" stroke="#3a2c00" stroke-width="3"/>`,
          `<line x1="${cx + 4}" y1="${topY + dh / 2 - 16}" x2="${cx + 4}" y2="${topY + dh / 2 + 16}" stroke="#3a2c00" stroke-width="3"/>`,
          `</g>`,
        );
      } else {
        // горизонтальная перегородка: тянется по x в пределах своего сплита, тонкая по y
        const cy = fy(d.y + d.h / 2);
        const leftX = span(d.x, d.w);
        out.push(
          `<g data-hit="divider" data-id="${m.id}" data-path="${label}" data-after="${d.after}" data-dir="h" style="cursor:row-resize">`,
          `<rect x="${leftX}" y="${cy - 15}" width="${d.w}" height="30" fill="${COL.cell}" opacity="0.18"/>`,
          `<rect x="${leftX + (d.w - 140) / 2}" y="${cy - 18}" width="${Math.min(140, d.w * 0.6)}" height="36" rx="11" fill="${COL.cell}"/>`,
          `<line x1="${leftX + d.w / 2 - 16}" y1="${cy - 4}" x2="${leftX + d.w / 2 + 16}" y2="${cy - 4}" stroke="#3a2c00" stroke-width="3"/>`,
          `<line x1="${leftX + d.w / 2 - 16}" y1="${cy + 4}" x2="${leftX + d.w / 2 + 16}" y2="${cy + 4}" stroke="#3a2c00" stroke-width="3"/>`,
          `</g>`,
        );
      }
    }
  }

  return out.join('');
}

function renderDividerStructure(ctx: RenderCtx, d: DividerBox): string {
  const x = ctx.span(d.x, d.w);
  const y = ctx.fy(d.y + d.h);
  return `<rect x="${x}" y="${y}" width="${d.w}" height="${d.h}" fill="${COL.partition}"/>`;
}

function renderLeaf(ctx: RenderCtx, m: WardModule, lb: LeafBox, moduleSelected: boolean): string {
  const { fy, span, ex } = ctx;
  const x = span(lb.x, lb.w);
  const y = fy(lb.y + lb.h);
  const face = lb.leaf.face;
  const selected =
    moduleSelected &&
    ui.path &&
    ui.path.length === lb.path.length &&
    ui.path.every((v, i) => v === lb.path[i]);
  const out: string[] = [];
  const faceTitle =
    face.kind === 'open'
      ? 'ниша'
      : face.kind === 'door'
        ? face.glass
          ? 'стекло'
          : 'дверца'
        : face.kind === 'drawers'
          ? `ящики ×${face.drawers}`
          : 'панель';
  out.push(
    `<g data-hit="leaf" data-id="${m.id}" data-path="${pathStr(lb.path)}" style="cursor:pointer">`,
    `<title>Отсек ${pathStr(lb.path) || '—'}: ${faceTitle} · ${Math.round(lb.w)}×${Math.round(lb.h)}</title>`,
    // невидимая подложка: лист кликабелен даже когда он «пустой» (ниша без полок)
    `<rect x="${x}" y="${y}" width="${Math.max(0, lb.w)}" height="${Math.max(0, lb.h)}" fill="transparent" pointer-events="all"/>`,
  );
  if (face.kind === 'open') {
    for (const sy of shelfYsIn(lb.y, lb.h, face.shelves, face.shelfPitch)) {
      out.push(
        `<rect x="${x + 6}" y="${fy(sy) - 8}" width="${Math.max(0, lb.w - 12)}" height="16" fill="${COL.shelf}" stroke="#00000044" stroke-width="1" vector-effect="non-scaling-stroke"/>`,
      );
    }
  } else {
    const f = fillOf(face.fill, face.kind);
    if (face.kind === 'drawers') {
      const n = Math.max(1, Math.round(face.drawers));
      const dh = lb.h / n;
      for (let d = 0; d < n; d++) {
        out.push(
          `<rect x="${x}" y="${fy(lb.y + dh * (d + 1))}" width="${lb.w}" height="${dh}" fill="${f}" stroke="#00000066" stroke-width="1" vector-effect="non-scaling-stroke"/>`,
          `<line x1="${x + lb.w * 0.3}" y1="${fy(lb.y + dh * (d + 0.5))}" x2="${x + lb.w * 0.7}" y2="${fy(lb.y + dh * (d + 0.5))}" stroke="#2f2620" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`,
        );
      }
    } else {
      out.push(
        `<rect x="${x}" y="${y}" width="${lb.w}" height="${lb.h}" fill="${face.kind === 'door' && face.glass ? '#9fc3d888' : f}" stroke="#00000066" stroke-width="1" vector-effect="non-scaling-stroke"/>`,
      );
      if (face.kind === 'door') {
        // зеркалит ex(): данные считаем в local-координатах стены
        void ex;
        const mirror = isMirror(ctx.wall);
        const hingeAtDataLeft = face.hinge !== 'right';
        const dataHingeEdge = hingeAtDataLeft ? lb.x : lb.x + lb.w;
        const dataGrip = hingeAtDataLeft ? lb.x + lb.w : lb.x;
        const hx = span(dataHingeEdge, 0) + (hingeAtDataLeft ? (mirror ? -8 : 8) : mirror ? 8 : -8);
        const gx = span(dataGrip, 0) + (mirror ? (hingeAtDataLeft ? 42 : -42) : hingeAtDataLeft ? -42 : 42);
        out.push(
          `<line x1="${hx}" y1="${y + 12}" x2="${hx}" y2="${y + lb.h - 12}" stroke="#00000044" stroke-width="2" vector-effect="non-scaling-stroke"/>`,
          `<rect x="${gx - 6}" y="${y + lb.h / 2 - Math.min(110, lb.h * 0.18)}" width="12" height="${Math.min(220, lb.h * 0.36)}" rx="6" fill="#2f2620"/>`,
        );
        if (face.glass) {
          out.push(
            `<line x1="${x + lb.w * 0.15}" y1="${y + lb.h * 0.85}" x2="${x + lb.w * 0.6}" y2="${y + lb.h * 0.15}" stroke="#ffffff55" stroke-width="3" vector-effect="non-scaling-stroke"/>`,
          );
        }
      }
    }
  }
  if (selected) {
    out.push(
      `<rect x="${x + 2}" y="${y + 2}" width="${Math.max(0, lb.w - 4)}" height="${Math.max(0, lb.h - 4)}" fill="none" stroke="${COL.cell}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`,
    );
  }
  out.push(`</g>`);
  return out.join('');
}

// ---------------------------------------------------------------- interaction

interface DragState {
  mode: 'move' | 'edge' | 'divider' | 'tv' | 'socket' | 'pan';
  id?: string;
  dir?: 'l' | 'r';
  path?: Path;
  after?: number;
  axis?: 'v' | 'h';
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
  /** сработавшая привязка разделителя (в данных стены), иначе null */
  snapAt: number | null;
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
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // синтетические/неактивные pointerId — не критично
    }
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
      snapAt: null,
    };
    const p = store.project;
    const id = target?.getAttribute('data-id') ?? '';
    const m = id ? findModule(p, id) : undefined;

    if (hit === 'edge' && m) {
      select({ kind: 'module', id: m.id });
      ui.wall = m.wall;
      drag = {
        ...base,
        mode: 'edge',
        id: m.id,
        dir: (target?.getAttribute('data-dir') as 'l' | 'r') ?? 'r',
        wall: m.wall,
        sign: dataSign(m.wall),
        origFrom: m.from,
        origW: m.w,
        needCp: true,
      };
    } else if (hit === 'divider' && m && target) {
      // выбор секции, которой принадлежит перегородка
      select({ kind: 'module', id: m.id }, pathParse(target.getAttribute('data-path') ?? ''));
      ui.wall = m.wall;
      drag = {
        ...base,
        mode: 'divider',
        id: m.id,
        path: pathParse(target.getAttribute('data-path') ?? ''),
        after: Number(target.getAttribute('data-after')),
        axis: (target.getAttribute('data-dir') as 'v' | 'h') ?? 'v',
        wall: m.wall,
        sign: dataSign(m.wall),
        needCp: true,
      };
    } else if (hit === 'leaf' && m && target) {
      select({ kind: 'module', id: m.id }, pathParse(target.getAttribute('data-path') ?? ''));
      ui.wall = m.wall;
      drag = {
        ...base,
        mode: 'move',
        id: m.id,
        wall: m.wall,
        sign: dataSign(m.wall),
        origFrom: m.from,
        origW: m.w,
        needCp: true,
      };
    } else if (hit === 'mod' && m) {
      select({ kind: 'module', id: m.id });
      ui.wall = m.wall;
      drag = {
        ...base,
        mode: 'move',
        id: m.id,
        wall: m.wall,
        sign: dataSign(m.wall),
        origFrom: m.from,
        origW: m.w,
        needCp: true,
      };
    } else if (hit === 'tv' && p.tv) {
      select({ kind: 'tv', id: 'tv' });
      ui.wall = p.tv.wall;
      drag = {
        ...base,
        mode: 'tv',
        wall: p.tv.wall,
        sign: dataSign(p.tv.wall),
        origCx: p.tv.centerX,
        origCy: p.tv.centerY,
        needCp: true,
      };
    } else if (hit === 'socket' && target) {
      const s = p.sockets.find((v) => v.id === id);
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
    const dx = drag.sign * (mm.x - drag.startMmX);
    const dy = -(mm.y - drag.startMmY);
    if (drag.mode === 'move' && drag.id) moveModule(drag.id, drag.origFrom + dx);
    else if (drag.mode === 'edge' && drag.id && drag.dir)
      resizeModule(
        drag.id,
        drag.dir,
        (drag.dir === 'l' ? drag.origFrom : drag.origFrom + drag.origW) + dx,
      );
    else if (drag.mode === 'divider' && drag.id && drag.path && drag.after !== undefined && drag.wall && drag.axis) {
      const dm = findModule(p, drag.id);
      const axis = drag.axis;
      const path = drag.path;
      const after = drag.after;
      const wall = drag.wall;
      const id = drag.id;
      if (dm) {
        const snapArg = {
          candidates: dividerSnapCandidates(p, dm, axis, path, after),
          tol: snapTolerance(p),
        };
        const pos = axis === 'h' ? floorY(mm) : dataOf(p, wall, wallStart(p)[wall], mm.x);
        let snapped: number | null = null;
        for (const c of snapArg.candidates) {
          if (Math.abs(c - pos) <= snapArg.tol) {
            snapped = c;
            break;
          }
        }
        drag.snapAt = snapped;
        dragDivider(id, path, after, pos, snapArg);
      }
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
    if (hit === 'leaf' && target) {
      const id = target.getAttribute('data-id') ?? '';
      const path = pathParse(target.getAttribute('data-path') ?? '');
      toggleFace(id, path);
    } else if (hit === 'wall') {
      const at = wallAtX(p, mm.x);
      if (!at) return;
      const elevGlobal = wallStart(p)[at.wall] + at.local;
      insertModuleAtPointer(at.wall, dataOf(p, at.wall, wallStart(p)[at.wall], elevGlobal));
    }
  });
}

export type { LeafBox, DividerBox };
