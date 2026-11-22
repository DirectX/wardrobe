// Печатный PDF-отчёт: открывается новое окно с векторным чертежом фасада
// (все размеры, толщины стенок), планом сверху и спецификацией раскроя.
// Пользователь сохраняет в PDF через диалог печати браузера («Сохранить как PDF»).

import { store } from './store.ts';
import {
  CARCASS_T,
  cornerZones,
  findOverlapRegions,
  layoutModule,
  modulesOn,
  nodeBoxes,
  shelfYsIn,
  slidingBoxes,
  wallEnd,
  wallStart,
  wallT,
  WALLS,
} from './geometry.ts';
import { FACADE_FILLS, FACE_LABEL, WALL_LABEL } from './defaults.ts';
import { buildBom, totalArea } from './bom.ts';
import type { BoxNode, Path, Project, WallId, WardModule } from './types.ts';

const PAGE_W = 1123; // A4 landscape @96dpi ≈ 297×210 мм
const MARGIN = 36;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function openPrintReport(): void {
  const p = store.project;
  const html = buildReportHtml(p);
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  // дать SVG отрисоваться перед вызовом печати
  w.addEventListener('load', () => setTimeout(() => w.print(), 250));
  setTimeout(() => {
    try {
      if (!w.closed) w.print();
    } catch {
      /* окно могло быть закрыто */
    }
  }, 600);
}

// ------------------------------------------------------------------ чертёж

interface DrawCtx {
  s: string[];
  p: Project;
  scale: number; // px на мм
  ox: number; // начало координат фасада
  oy: number; // y пола на листе
}

/**
 * Левая стена на фасаде зеркалится (угол с центральной — у правого края плиты),
 * как в приложении: данные `from` отсчитываются от угла.
 */
export function isMirrorWall(wall: WallId): boolean {
  return wall === 'left';
}

/** Точка данных вдоль стены (мм от её начала) → экранная координата отчёта. */
export function elevDataX(
  p: Project,
  wall: WallId,
  dataX: number,
  ox: number,
  starts: Record<WallId, number>,
  scale: number,
): number {
  const L = p.walls[wall].length;
  return ox + (starts[wall] + (isMirrorWall(wall) ? L - dataX : dataX)) * scale;
}

function drawFacade(ctx: DrawCtx): void {
  const { p, s, scale, ox, oy } = ctx;
  const starts = wallStart(p);
  const X = (wall: WallId, dataX: number) => elevDataX(p, wall, dataX, ox, starts, scale);
  const Y = (yMm: number) => oy - yMm * scale;

  // пол
  const total = (p.walls.left.length + p.walls.center.length + p.walls.right.length + 360) * scale;
  s.push(`<line x1="${ox - 10}" y1="${Y(0)}" x2="${ox - 10 + total}" y2="${Y(0)}" stroke="#111" stroke-width="1.6"/>`);

  for (const wall of WALLS) {
    const L = p.walls[wall].length;
    // линия стены (тонкая); заголовок — по центру плиты (у зеркальной стены
    // data-ноль на правом краю, подпись там collided бы с соседней стеной)
    const titleX = ox + (starts[wall] + L / 2) * scale;
    s.push(
      `<line x1="${X(wall, 0)}" y1="${Y(p.ceiling)}" x2="${X(wall, 0)}" y2="${Y(0)}" stroke="#bbb" stroke-width="1"/>`,
      `<text x="${titleX}" y="${Y(p.ceiling) - 8}" font-size="10" fill="#444" text-anchor="middle">${esc(WALL_LABEL[wall])} — ${L} мм</text>`,
    );
    // угловые зоны (у зеркальной стены start-зона — у правого края плиты)
    const z = cornerZones(p, wall);
    if (z.start > 0) dimH(ctx, X(wall, 0), Y(0) + 44, X(wall, z.start), Y(0) + 44, `угол ${z.start}`);
    if (z.end > 0) dimH(ctx, X(wall, L - z.end), Y(0) + 44, X(wall, L), Y(0) + 44, `угол ${z.end}`);

    for (const m of modulesOn(p, wall)) drawModule(ctx, wall, m);
  }

  // ТВ (у зеркальной стены левый кромочный край — это data-правый)
  if (p.tv) {
    const t = p.tv;
    const x = isMirrorWall(t.wall)
      ? X(t.wall, t.centerX + t.w / 2)
      : X(t.wall, t.centerX - t.w / 2);
    const y = Y(t.centerY + t.h / 2);
    s.push(
      `<rect x="${x}" y="${y}" width="${t.w * scale}" height="${t.h * scale}" fill="#333" stroke="#111"/>`,
      `<text x="${x + (t.w * scale) / 2}" y="${y + (t.h * scale) / 2 + 3}" font-size="9" fill="#fff" text-anchor="middle">ТВ ${t.w}×${t.h}</text>`,
    );
  }
  // розетки
  for (const so of p.sockets) {
    const x = X(so.wall, so.x);
    const y = Y(so.y);
    s.push(
      `<circle cx="${x}" cy="${y}" r="3.4" fill="#fff" stroke="#111"/>`,
      `<text x="${x + 5}" y="${y + 3}" font-size="7.5" fill="#333">${so.x}/${so.y}</text>`,
    );
  }

  // оверлей перекрывающихся фрагментов фасада (r.x — глобальная координата фасада)
  for (const r of findOverlapRegions(p)) {
    const rx = ox + r.x * scale;
    const ry = Y(r.y + r.h);
    const rw = r.w * scale;
    const rh = r.h * scale;
    const clipId = `ov-${Math.round(r.x)}-${Math.round(r.y)}`;
    let hatch = '';
    const diag = Math.max(rw, rh) + 8;
    for (let q = -diag; q < rw + diag; q += 5) {
      hatch += `<line x1="${rx + q}" y1="${ry - 2}" x2="${rx + q + diag}" y2="${ry + rh + 2}" stroke="#c0392b" stroke-width="0.8" opacity="0.5"/>`;
    }
    s.push(
      `<clipPath id="${clipId}"><rect x="${rx}" y="${ry}" width="${rw}" height="${rh}"/></clipPath>`,
      `<g clip-path="url(#${clipId})">${hatch}</g>`,
      `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="none" stroke="#c0392b" stroke-width="1.2" stroke-dasharray="4 2"/>`,
      `<text x="${rx + rw / 2}" y="${ry - 3}" font-size="7.5" fill="#c0392b" text-anchor="middle">перекрытие ${Math.round(r.w)}×${Math.round(r.h)}</text>`,
    );
  }
}

function drawModule(ctx: DrawCtx, wall: WallId, m: WardModule): void {
  const { p, s, scale } = ctx;
  const starts = wallStart(p);
  const mirror = isMirrorWall(wall);
  const X = (dataX: number) => elevDataX(p, wall, dataX, ctx.ox, starts, scale);
  const Y = (yMm: number) => ctx.oy - yMm * scale;
  // левая экранная кромка проёма [d1, d1+wd] (для зеркальной стены — от data-правого края)
  const span = (d1: number, wd: number) => (mirror ? X(d1 + wd) : X(d1));
  const tL = wallT(m, 'l');
  const tR = wallT(m, 'r');
  const X0 = span(m.from, m.w);

  // внешний контур
  s.push(
    `<rect x="${X0}" y="${Y(m.h)}" width="${m.w * scale}" height="${m.h * scale}" fill="none" stroke="#111" stroke-width="1.4"/>`,
  );
  // стенки (показываем фактическую толщину; общая — половина).
  // span() учитывает зеркало: data-левая стенка у зеркальной стены — справа на экране
  s.push(`<rect x="${span(m.from, tL)}" y="${Y(m.h)}" width="${tL * scale}" height="${m.h * scale}" fill="#ddd" stroke="#666" stroke-width="0.5"/>`);
  s.push(`<rect x="${span(m.from + m.w - tR, tR)}" y="${Y(m.h)}" width="${tR * scale}" height="${m.h * scale}" fill="#ddd" stroke="#666" stroke-width="0.5"/>`);
  s.push(`<rect x="${X0}" y="${Y(m.h)}" width="${m.w * scale}" height="${CARCASS_T * scale}" fill="#ddd" stroke="#666" stroke-width="0.5"/>`);
  if (p.base > 0)
    s.push(`<rect x="${span(m.from + tL, m.w - tL - tR)}" y="${Y(p.base)}" width="${(m.w - tL - tR) * scale}" height="${p.base * scale}" fill="#eee" stroke="#666" stroke-width="0.5"/>`);

  // дерево
  const { leaves, dividers } = layoutModule(p, m);
  for (const lb of leaves) {
    const x = span(lb.x, lb.w);
    const y = Y(lb.y + lb.h);
    const w = lb.w * scale;
    const h = lb.h * scale;
    const face = lb.leaf.face;
    if (face.kind === 'open') {
      for (const sy of shelfYsIn(lb.y, lb.h, face.shelves, face.shelfPitch)) {
        s.push(`<line x1="${x + 1}" y1="${Y(sy)}" x2="${x + w - 1}" y2="${Y(sy)}" stroke="#9a7a52" stroke-width="1.4"/>`);
      }
    } else {
      const fill =
        face.fill && FACADE_FILLS[face.fill]
          ? FACADE_FILLS[face.fill]
          : face.kind === 'drawers'
            ? '#e4d3b3'
            : '#d8c39a';
      s.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" fill-opacity="0.55" stroke="#5a4630" stroke-width="0.9"/>`);
      if (face.kind === 'door') {
        // диагональ кромки петли: на зеркальной стене направление разворачивается
        const hingeLeftOnScreen = (face.hinge === 'left') !== mirror;
        if (hingeLeftOnScreen)
          s.push(`<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="#5a4630" stroke-width="0.5" stroke-dasharray="3 2"/>`);
        else s.push(`<line x1="${x + w}" y1="${y}" x2="${x}" y2="${y + h}" stroke="#5a4630" stroke-width="0.5" stroke-dasharray="3 2"/>`);
      }
      if (face.kind === 'drawers') {
        const n = face.drawers;
        for (let i = 1; i < n; i++)
          s.push(`<line x1="${x}" y1="${y + (h * i) / n}" x2="${x + w}" y2="${y + (h * i) / n}" stroke="#5a4630" stroke-width="0.7"/>`);
      }
      s.push(
        `<text x="${x + w / 2}" y="${y + h / 2 + 3}" font-size="7" fill="#4a3a26" text-anchor="middle">${esc(FACE_LABEL[face.kind])}</text>`,
      );
    }
  }
  for (const d of dividers) {
    s.push(
      `<rect x="${span(d.x, d.w)}" y="${Y(d.y + d.h)}" width="${d.w * scale}" height="${d.h * scale}" fill="#ccc" stroke="#666" stroke-width="0.5"/>`,
    );
  }
  // купейные створки поверх отсеков
  for (const sb of slidingBoxes(p, m)) {
    const ov = Math.min(sb.overlap, sb.w / (sb.doors * 3));
    const dw = (sb.w + ov * (sb.doors - 1)) / sb.doors;
    const sx = span(sb.x, sb.w);
    const sy = Y(sb.y + sb.h);
    for (let i = 0; i < sb.doors; i++) {
      const dxi = mirror ? sx + (sb.w - dw - i * (dw - ov)) * scale : sx + i * (dw - ov) * scale;
      s.push(
        `<rect x="${dxi}" y="${sy}" width="${dw * scale}" height="${sb.h * scale}" fill="#b9c3cf" fill-opacity="0.35" stroke="#4a5563" stroke-width="0.8"/>`,
        `<line x1="${dxi}" y1="${sy}" x2="${dxi}" y2="${sy + sb.h * scale}" stroke="#4a5563" stroke-width="1.4"/>`,
      );
    }
    s.push(
      `<text x="${sx + (sb.w * scale) / 2}" y="${sy - 3}" font-size="7" fill="#4a5563" text-anchor="middle">купе ×${sb.doors} (нахлёст ${Math.round(ov)})</text>`,
    );
  }

  // размеры модуля — между ГРАНЯМИ ПЛИТ. Если боковая плита общая с соседним
  // модулем, размер модуля доводится до её ближней грани, а сама общая плита
  // (18 мм на стык) dimensioned отдельной линией — никаких отсчётов от середины плиты.
  const refs = moduleDimRefs(p, m);
  dimH(ctx, X(refs.l), Y(0) + 14, X(refs.r), Y(0) + 14, `${Math.round(refs.r - refs.l)}`);
  if (refs.sharedPanel !== null) {
    dimH(
      ctx,
      X(refs.sharedPanel - CARCASS_T / 2),
      Y(0) + 26,
      X(refs.sharedPanel + CARCASS_T / 2),
      Y(0) + 26,
      `${CARCASS_T} (общая)`,
    );
  }
  const hOffset = mirror ? -12 : 12;
  dimV(ctx, X(refs.r) + hOffset, Y(0), X(refs.r) + hOffset, Y(m.h), `${m.h}`);

  // размеры отсеков — строго по фактической раскладке (границы плит)
  dimChildren(ctx, m.root, [], nodeBoxes(p, m), X, Y);
}

/**
 * Опорные грани для размеров модуля: от внешней грани своей плиты до ближней
 * грани общей плиты стыка. sharedPanel — центр общей плиты (для отдельного
 * размера 18 мм), либо null если справа своя плита/нет соседа.
 */
export function moduleDimRefs(
  p: Project,
  m: WardModule,
): { l: number; r: number; sharedPanel: number | null } {
  const ms = modulesOn(p, m.wall);
  const hasPrev = ms.some((x) => x.id !== m.id && Math.abs(wallEnd(x) - m.from) < 1);
  const hasNext = ms.some((x) => x.id !== m.id && Math.abs(wallEnd(m) - x.from) < 1);
  const tL = wallT(m, 'l');
  const tR = wallT(m, 'r');
  return {
    l: m.leftShared && hasPrev ? m.from + tL : m.from,
    r: m.rightShared && hasNext ? m.from + m.w - tR : m.from + m.w,
    sharedPanel: m.rightShared && hasNext ? wallEnd(m) : null,
  };
}

/**
 * Размеры детей сплита — по фактическим боксам раскладки (nodeBoxes), т.е.
 * от грани плиты до грани плиты. Никакого пропорционального пересчёта:
 * размерные линии совпадают с нарисованными плитами 1:1.
 */
function dimChildren(
  ctx: DrawCtx,
  node: BoxNode,
  path: Path,
  boxes: Map<string, { x: number; y: number; w: number; h: number }>,
  X: (d: number) => number,
  Y: (d: number) => number,
): void {
  if (node.type !== 'split') return;
  const depth = path.length;
  node.children.forEach((_, i) => {
    const cb = boxes.get([...path, i].join('.'));
    if (!cb) return;
    if (node.dir === 'v') {
      // ширина проёма — под его нижней гранью, ярусы по глубине вложенности
      const y = Y(cb.y) + 10 + depth * 9;
      dimH(ctx, X(cb.x), y, X(cb.x + cb.w), y, `${Math.round(cb.w)}`);
    } else {
      // высота проёма — слева от него
      const x = X(cb.x) - 10 - depth * 9;
      dimV(ctx, x, Y(cb.y), x, Y(cb.y + cb.h), `${Math.round(cb.h)}`);
    }
  });
  node.children.forEach((c, i) => dimChildren(ctx, c.node, [...path, i], boxes, X, Y));
}

function dimH(ctx: DrawCtx, x1: number, y: number, x2: number, _y2: number, label: string): void {
  const { s } = ctx;
  s.push(
    `<g stroke="#c0392b" stroke-width="0.7" fill="none">`,
    `<line x1="${x1}" y1="${y - 2.5}" x2="${x1}" y2="${y + 2.5}"/>`,
    `<line x1="${x2}" y1="${y - 2.5}" x2="${x2}" y2="${y + 2.5}"/>`,
    `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>`,
    `</g>`,
    `<text x="${(x1 + x2) / 2}" y="${y - 2.5}" font-size="7.5" fill="#c0392b" text-anchor="middle">${label}</text>`,
  );
}

function dimV(ctx: DrawCtx, x: number, y1: number, _x2: number, y2: number, label: string): void {
  const { s } = ctx;
  s.push(
    `<g stroke="#c0392b" stroke-width="0.7" fill="none">`,
    `<line x1="${x - 2.5}" y1="${y1}" x2="${x + 2.5}" y2="${y1}"/>`,
    `<line x1="${x - 2.5}" y1="${y2}" x2="${x + 2.5}" y2="${y2}"/>`,
    `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/>`,
    `</g>`,
    `<text x="${x + 3}" y="${(y1 + y2) / 2}" font-size="7.5" fill="#c0392b">${label}</text>`,
  );
}

// ------------------------------------------------------------------ план

function drawPlan(ctx: DrawCtx): void {
  const { p, s } = ctx;
  const scale = ctx.scale;
  const ox = ctx.ox;
  const oy = ctx.oy;
  const Lc = p.walls.center.length;
  const depthMax = Math.max(
    p.walls.left.length,
    p.walls.right.length,
    700,
    ...p.modules.map((m) => m.depth),
  );
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => oy + y * scale;

  // стены
  const T = 60;
  s.push(
    `<rect x="${X(-T)}" y="${Y(-T)}" width="${(Lc + 2 * T) * scale}" height="${T * scale}" fill="#eee" stroke="#333"/>`,
    `<rect x="${X(-T)}" y="${Y(-T)}" width="${T * scale}" height="${(p.walls.left.length + T) * scale}" fill="#eee" stroke="#333"/>`,
    `<rect x="${X(Lc)}" y="${Y(-T)}" width="${T * scale}" height="${(p.walls.right.length + T) * scale}" fill="#eee" stroke="#333"/>`,
  );
  for (const m of p.modules) {
    let x = 0;
    let y = 0;
    let w = 0;
    let hh = 0;
    if (m.wall === 'center') {
      x = m.from;
      y = 0;
      w = m.w;
      hh = m.depth;
    } else if (m.wall === 'left') {
      x = 0;
      y = m.from;
      w = m.depth;
      hh = m.w;
    } else {
      x = Lc - m.depth;
      y = m.from;
      w = m.depth;
      hh = m.w;
    }
    s.push(
      `<rect x="${X(x)}" y="${Y(y)}" width="${w * scale}" height="${hh * scale}" fill="#c9a877" fill-opacity="0.5" stroke="#333" stroke-width="0.9"/>`,
      `<text x="${X(x + w / 2)}" y="${Y(y + hh / 2) + 2.5}" font-size="7" text-anchor="middle" fill="#333">${Math.round(w)}×${Math.round(hh)}</text>`,
    );
  }
  {
    const yTop = Y(-T) - 8;
    dimH(ctx, X(0), yTop, X(Lc), yTop, `${Lc}`);
  }
  void depthMax;
}

// ------------------------------------------------------------------ HTML отчёта

export function buildReportHtml(p: Project): string {
  const s: string[] = [];
  const cw = PAGE_W - MARGIN * 2;

  // --- фасад
  const totalW = p.walls.left.length + p.walls.center.length + p.walls.right.length + 360;
  const fScale = Math.min(cw / totalW, 380 / p.ceiling);
  const fOx = MARGIN + ((cw - totalW * fScale) / 2) + 180 * fScale;
  const fOy = 440;
  const fCtx: DrawCtx = { s, p, scale: fScale, ox: fOx, oy: fOy };
  s.push(`<svg width="${PAGE_W}" height="520" viewBox="0 0 ${PAGE_W} 520" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif">`);
  drawFacade(fCtx);
  s.push(`</svg>`);
  const facadeSvg = s.join('');
  s.length = 0;

  // --- план
  const Lc = p.walls.center.length;
  const depthPlan = Math.max(p.walls.left.length, p.walls.right.length, 700);
  const pScale = Math.min(cw / (Lc + 260), 320 / (depthPlan + 260));
  const pCtx: DrawCtx = {
    s,
    p,
    scale: pScale,
    ox: 90 * pScale, // запас слева под стену (T=60) и подпись
    oy: 90 * pScale, // запас сверху под размерную линию
  };
  const planW = Math.round((Lc + 180) * pScale);
  const planH = Math.round((depthPlan + 180) * pScale);
  s.push(`<svg width="${planW}" height="${planH}" viewBox="0 0 ${planW} ${planH}" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif">`);
  drawPlan(pCtx);
  s.push(`</svg>`);
  const planSvg = s.join('');
  s.length = 0;

  // --- спецификация
  const boms = buildBom(p);
  const rows: string[] = [];
  for (const b of boms) {
    const wallLabel = WALL_LABEL[b.m.wall];
    rows.push(
      `<tr class="mod"><td colspan="7"><b>Модуль ${esc(b.m.id)}</b> · ${esc(wallLabel)} · ${b.m.w}×${b.m.h}×${b.m.depth} мм · отступ ${b.m.from} мм · стенки: ${b.m.leftShared ? 'лев. общая' : 'лев. своя'}, ${b.m.rightShared ? 'прав. общая' : 'прав. своя'}</td></tr>`,
    );
    for (const part of b.parts) {
      rows.push(
        `<tr><td>${esc(part.name)}</td><td class="n">${part.a}</td><td class="n">${part.b}</td><td class="n">${part.t}</td><td class="n">${part.qty}</td><td class="n">${((part.a * part.b * part.qty) / 1e6).toFixed(3)}</td><td>${esc(part.path.join('.') || '—')}</td></tr>`,
      );
    }
  }
  const area = totalArea(boms).toFixed(2);

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${esc(p.name)} — проект и спецификация</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.45 Helvetica, Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 14px 0 6px; border-bottom: 1px solid #999; padding-bottom: 2px; }
  .meta { color: #444; margin-bottom: 8px; }
  .page { page-break-after: always; padding: ${MARGIN / 2}px; }
  .page:last-child { page-break-after: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #888; padding: 3px 6px; text-align: left; }
  th { background: #eee; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  tr.mod td { background: #f4f4f4; }
  .note { color: #555; font-size: 10px; margin-top: 8px; }
  svg { display: block; }
</style>
</head>
<body>
  <div class="page">
    <h1>${esc(p.name)} — шкаф-купе, фасад</h1>
    <div class="meta">Потолок ${p.ceiling} мм · цоколь ${p.base} мм · сетка ${p.grid} мм ·
      стены: Л ${p.walls.left.length} / Ц ${p.walls.center.length} / П ${p.walls.right.length} мм ·
      корпус 18 мм (общая стенка — 9+9 мм) · полки ${16} мм · дата ${new Date().toLocaleDateString('ru-RU')}</div>
    ${facadeSvg}
    <div class="note">Красные размеры — мм; все отсчёты — между гранями плит. Общая плита стыка двух модулей показана отдельным размером (18 мм), размеры модулей доводятся до её грани. Диагональ на дверце указывает сторону петли. Подписи розеток: X/высота.</div>
  </div>
  <div class="page">
    <h2>План сверху (глубины модулей)</h2>
    <div style="text-align:center">${planSvg}</div>
    <div class="note">
      Горизонтальные перегородки и полки кроятся на полную внутреннюю ширину своего проёма
      (приоритет распила); вертикальные — устанавливаются между ними. Глубины модулей указаны на плане.
    </div>
    <h2>Спецификация раскроя</h2>
    <table>
      <thead><tr><th>Деталь</th><th class="n">Длина, мм</th><th class="n">Ширина, мм</th><th class="n">Толщ., мм</th><th class="n">Кол-во</th><th class="n">Площадь, м²</th><th>Узел</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <div class="note">Итого плитного материала ≈ ${area} м². «Узел» — путь секции в дереве нарезки модуля.
    Откройте диалог печати браузера и выберите «Сохранить как PDF» (ориентация — альбомная, поля — минимальные).</div>
  </div>
</body>
</html>`;
}
