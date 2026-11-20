import { store } from '../store.ts';
import { select, ui, renderAll } from '../state.ts';
import { modulesOn } from '../geometry.ts';
import { validate } from '../validate.ts';
import type { Project } from '../types.ts';

const WALL_T = 60; // толщина стены на плане, мм

const KIND_FILL: Record<string, string> = {
  wardrobe: '#6b5138',
  shelves: '#57432e',
  drawers: '#7a5a3c',
  open: '#3a2d20',
  'tv-niche': '#43506b',
};

let svg: SVGSVGElement;

export function renderPlan(): void {
  if (!svg) return;
  const p = store.project;
  const Lc = p.walls.center.length;
  const Ll = p.walls.left.length;
  const Lr = p.walls.right.length;
  const issues = validate(p);
  const badIds = new Set(issues.flatMap((i) => i.refs));
  const sel = ui.sel;

  // координаты плана: центральная стена сверху (y=0), комната ниже;
  // боковые стены уходят вниз; их from отсчитывается от угла с центральной
  const depthMax = Math.max(Ll, Lr, 900, ...p.modules.filter((m) => m.wall === 'center').map((m) => m.depth), 0);
  const box = { x: -WALL_T - 160, y: -WALL_T - 160, w: Lc + (WALL_T + 160) * 2, h: depthMax + 340 };
  const r = svg.getBoundingClientRect();
  if (r.width && r.height) {
    const k = Math.max(box.w / r.width, box.h / r.height);
    const vw = r.width * k;
    const vh = r.height * k;
    svg.setAttribute('viewBox', `${box.x + box.w / 2 - vw / 2} ${box.y + box.h / 2 - vh / 2} ${vw} ${vh}`);
  } else {
    svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  }

  const parts: string[] = [];
  parts.push(`<g font-family="ui-sans-serif, system-ui, sans-serif">`);

  // пол комнаты
  parts.push(`<rect x="0" y="0" width="${Lc}" height="${depthMax}" fill="#12151b"/>`);
  // стены
  parts.push(`<rect x="${-WALL_T}" y="${-WALL_T}" width="${Lc + 2 * WALL_T}" height="${WALL_T}" fill="#2a2f3a"/>`);
  parts.push(`<rect x="${-WALL_T}" y="${-WALL_T}" width="${WALL_T}" height="${Ll + WALL_T}" fill="#2a2f3a"/>`);
  parts.push(`<rect x="${Lc}" y="${-WALL_T}" width="${WALL_T}" height="${Lr + WALL_T}" fill="#2a2f3a"/>`);

  // открытая сторона
  parts.push(
    `<line x1="${-WALL_T}" y1="${depthMax}" x2="${Lc + WALL_T}" y2="${depthMax}" stroke="#3a404b" stroke-width="2" stroke-dasharray="60 50" vector-effect="non-scaling-stroke"/>`,
    `<text x="${Lc / 2}" y="${depthMax + 120}" font-size="80" fill="#5c6470" text-anchor="middle">проход</text>`,
  );

  // модули: центральная стена
  for (const m of modulesOn(p, 'center')) {
    parts.push(planRect(m.from, 0, m.w, m.depth, m, sel?.kind === 'module' && sel.id === m.id, badIds.has(m.id)));
  }
  // левая: x 0..depth, y from..from+w (from от угла с центральной)
  for (const m of modulesOn(p, 'left')) {
    parts.push(planRect(0, m.from, m.depth, m.w, m, sel?.kind === 'module' && sel.id === m.id, badIds.has(m.id)));
  }
  for (const m of modulesOn(p, 'right')) {
    parts.push(planRect(Lc - m.depth, m.from, m.depth, m.w, m, sel?.kind === 'module' && sel.id === m.id, badIds.has(m.id)));
  }

  // ТВ
  if (p.tv) {
    const t = p.tv;
    const isSel = sel?.kind === 'tv';
    if (t.wall === 'center') {
      parts.push(planTv(t.centerX - t.w / 2, 0, t.w, 90, isSel));
    } else if (t.wall === 'left') {
      parts.push(planTv(0, t.centerX - t.w / 2, 90, t.w, isSel));
    } else {
      parts.push(planTv(Lc - 90, t.centerX - t.w / 2, 90, t.w, isSel));
    }
  }

  // розетки
  for (const s of p.sockets) {
    const bad = badIds.has(s.id);
    const isSel = sel?.kind === 'socket' && sel.id === s.id;
    let cx = 0;
    let cy = 0;
    if (s.wall === 'center') {
      cx = s.x;
      cy = 100;
    } else if (s.wall === 'left') {
      cx = 100;
      cy = s.x;
    } else {
      cx = Lc - 100;
      cy = s.x;
    }
    parts.push(
      `<g data-hit="socket" data-id="${s.id}">
        <circle cx="${cx}" cy="${cy}" r="46" fill="${bad ? '#3a1d1d' : '#f2efe8'}" stroke="${bad ? '#ff5252' : isSel ? '#4da3ff' : '#5c6470'}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
        <title>Розетка: ${s.x} мм от угла, высота ${s.y}</title>
      </g>`,
    );
  }

  // размеры
  parts.push(`<text x="${Lc / 2}" y="${-WALL_T - 70}" font-size="90" fill="#8b94a3" text-anchor="middle">${Lc}</text>`);
  parts.push(
    `<text x="${-WALL_T - 70}" y="${Ll / 2}" font-size="80" fill="#8b94a3" text-anchor="middle" transform="rotate(-90 ${-WALL_T - 70} ${Ll / 2})">${Ll}</text>`,
  );
  parts.push(
    `<text x="${Lc + WALL_T + 70}" y="${Lr / 2}" font-size="80" fill="#8b94a3" text-anchor="middle" transform="rotate(90 ${Lc + WALL_T + 70} ${Lr / 2})">${Lr}</text>`,
  );

  parts.push(`</g>`);
  svg.innerHTML = parts.join('');
}

function planRect(
  x: number,
  y: number,
  w: number,
  h: number,
  m: Project['modules'][number],
  isSel: boolean,
  bad: boolean,
): string {
  return `<g data-hit="mod" data-id="${m.id}">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${KIND_FILL[m.kind] ?? '#555'}" stroke="${bad ? '#ff5252' : isSel ? '#4da3ff' : '#00000088'}" stroke-width="${isSel || bad ? 3 : 2}" vector-effect="non-scaling-stroke"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none"/>
    <title>${m.id} · ${m.w}×${m.depth}</title>
  </g>`;
}

function planTv(x: number, y: number, w: number, h: number, isSel: boolean): string {
  return `<g data-hit="tv" data-id="tv">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#dfe3ea" stroke="${isSel ? '#4da3ff' : '#0b0d10'}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    <title>Телевизор</title>
  </g>`;
}

export function attachPlan(el: SVGSVGElement): void {
  svg = el;
  el.addEventListener('pointerdown', (e) => {
    const target = (e.target as Element).closest('[data-hit]');
    const hit = target?.getAttribute('data-hit') ?? null;
    const id = target?.getAttribute('data-id') ?? '';
    if (hit === 'mod') {
      select({ kind: 'module', id });
      const m = store.project.modules.find((v) => v.id === id);
      if (m) ui.wall = m.wall;
      renderAll();
    } else if (hit === 'tv') {
      select({ kind: 'tv', id: 'tv' });
      renderAll();
    } else if (hit === 'socket') {
      select({ kind: 'socket', id });
      renderAll();
    }
  });
}
