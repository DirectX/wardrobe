// Спецификация раскроя: детали контейнеров с размерами и материалами.
//
// Приоритет распила внутри короба: ГОРИЗОНТАЛЬНЫЕ перегородки и полки идут
// первыми — они кроятся на полную внутреннюю ширину отсека; вертикальные
// элементы (боковины вложенных секций) встают между ними.

import type { BoxNode, Path, Project, WallId, WardModule } from './types.ts';
import { CARCASS_T, modulesOn, slidingBoxes, wallT } from './geometry.ts';

export interface Part {
  /** наименование детали */
  name: string;
  /** длина (вдоль стены для горизонтальных, вверх для вертикальных), мм */
  a: number;
  /** ширина детали, мм */
  b: number;
  t: number;
  qty: number;
  /** откуда: id модуля + путь узла */
  moduleId: string;
  path: Path;
  /** категория для группировки */
  cat:
    | 'carcass'
    | 'h-divider'
    | 'v-divider'
    | 'shelf'
    | 'facade'
    | 'plinth'
    | 'drawer-box'
    | 'sliding-door'
    | 'sliding-track'
    | 'sliding-profile';
}

export interface ModuleBom {
  m: WardModule;
  parts: Part[];
}

/** Толщина материала по умолчанию. */
export const PANEL_T = 16;

/**
 * Зазоры выдвижного ящика на шариковых (телескопических) направляющих:
 *  - по ширине: 12.7 мм на сторону (25.4 мм суммарно) — стандарт под короб;
 *  - по высоте: ≥10 мм сверху, ≥15 мм снизу;
 *  - по глубине: ≥15 мм от задней стенки.
 */
export const DRAWER_SIDE_GAP = 12.7; // на одну сторону, мм
export const DRAWER_TOP_GAP = 10;
export const DRAWER_BOT_GAP = 15;
export const DRAWER_BACK_GAP = 15;
const HARDBOARD_T = 3.2; // ДВП дно
/** Стандартные длины шариковых направляющих, мм. */
const RUNNER_LENGTHS = [250, 300, 350, 400, 450, 500, 550, 600];

export function buildBom(p: Project): ModuleBom[] {
  const out: ModuleBom[] = [];
  for (const wall of ['left', 'center', 'right'] as WallId[]) {
    for (const m of modulesOn(p, wall)) {
      out.push({ m, parts: moduleParts(p, m) });
    }
  }
  return out;
}

function moduleParts(p: Project, m: WardModule): Part[] {
  const parts: Part[] = [];
  const tL = wallT(m, 'l');
  const tR = wallT(m, 'r');
  const T = CARCASS_T;
  const innerW = m.w - tL - tR;
  const bodyH = m.h - p.base; // от верха цоколя до верха

  const push = (
    name: string,
    a: number,
    b: number,
    t: number,
    cat: Part['cat'],
    path: Path,
  ) => {
    const aR = Math.max(1, Math.round(a));
    const bR = Math.max(1, Math.round(b));
    const found = parts.find(
      (x) => x.name === name && x.a === aR && x.b === bR && x.t === t && x.cat === cat,
    );
    if (found) found.qty += 1;
    else parts.push({ name, a: aR, b: bR, t, qty: 1, moduleId: m.id, path, cat });
  };

  // --- корпус
  push('Стенка левая', bodyH, m.depth, tL, 'carcass', []);
  push('Стенка правая', bodyH, m.depth, tR, 'carcass', []);
  push('Крышка', innerW, m.depth, T, 'carcass', []);
  push('Дно', innerW, m.depth, T, 'carcass', []);
  if (p.base > 0) push('Цоколь', innerW, 80, PANEL_T, 'plinth', []);

  // --- дерево: горизонтальные перегородки — на полную ширину своего проёма
  const walk = (node: BoxNode, path: Path, wMm: number, hMm: number) => {
    if (node.type === 'leaf') {
      addLeafParts(node, path, wMm, hMm);
      return;
    }
    const t = Math.max(0, node.t);
    const n = node.children.length;
    const axis = node.dir === 'v' ? wMm : hMm;
    const sum = node.children.reduce((s, c) => s + Math.max(0, c.size), 0) || 1;
    const avail = Math.max(0, axis - t * (n - 1));
    node.children.forEach((c, i) => {
      const size = (Math.max(0, c.size) / sum) * avail;
      const childPath = [...path, i];
      if (node.dir === 'v') walk(c.node, childPath, size, hMm);
      else walk(c.node, childPath, wMm, size);
    });
    // перегородки этого сплита: горизонтальный сплит → горизонтальные панели на всю ширину wMm
    for (let i = 0; i < n - 1; i++) {
      if (node.dir === 'h') {
        push('Перегородка горизонтальная', wMm, m.depth - 20, t, 'h-divider', path);
      } else {
        // вертикальный сплит → вертикальные панели между горизонтальными (короче на их толщину)
        push('Перегородка вертикальная', hMm, m.depth - 20, t, 'v-divider', path);
      }
    }
  };

  const addLeafParts = (node: BoxNode & { type: 'leaf' }, path: Path, wMm: number, hMm: number) => {
    const face = node.face;
    if (face.kind === 'open') {
      const topGap = 16;
      const availH = Math.max(0, hMm - 2 * topGap);
      const n =
        face.shelfPitch && face.shelfPitch > 0
          ? Math.floor(availH / face.shelfPitch)
          : Math.max(0, Math.round(face.shelves));
      for (let i = 0; i < n; i++) push('Полка', wMm, m.depth - 20, PANEL_T, 'shelf', path);
    } else if (face.kind === 'door') {
      push(
        face.glass ? 'Фасад стеклянный' : 'Фасад дверцы',
        hMm,
        wMm,
        face.glass ? 4 : PANEL_T,
        'facade',
        path,
      );
    } else if (face.kind === 'drawers') {
      // Выдвижной ящик на шариковых направляющих, стандартная конструкция:
      // фасад + короб (2 царги, передняя/задняя стенка короба) + дно из ДВП.
      const n = Math.max(1, face.drawers);
      const dh = hMm / n; // высота отсека на один ящик
      const boxW = Math.max(50, wMm - 2 * DRAWER_SIDE_GAP); // −12.7 мм на сторону
      const boxH = Math.max(40, dh - DRAWER_TOP_GAP - DRAWER_BOT_GAP); // −10 сверху, −15 снизу
      const boxD = Math.max(100, m.depth - PANEL_T - DRAWER_BACK_GAP); // фасад 16 + зазор 15 от задней стенки
      // направляющие: ближайшая стандартная длина ≤ boxD
      let runner = RUNNER_LENGTHS[0];
      for (const L of RUNNER_LENGTHS) if (L <= boxD) runner = L;
      for (let i = 0; i < n; i++) {
        push('Фасад ящика', Math.round(dh - 4), Math.round(wMm - 4), PANEL_T, 'facade', path);
        // короб: 2 царги (бока) и 2 стенки (перед+зад); push агрегирует одинаковые
        push('Царга ящика (бок)', Math.round(boxD), Math.round(boxH), PANEL_T, 'drawer-box', path);
        push('Царга ящика (бок)', Math.round(boxD), Math.round(boxH), PANEL_T, 'drawer-box', path);
        push('Стенка короба ящика (перед/зад)', Math.round(boxH), Math.round(boxW - 2 * PANEL_T), PANEL_T, 'drawer-box', path);
        push('Стенка короба ящика (перед/зад)', Math.round(boxH), Math.round(boxW - 2 * PANEL_T), PANEL_T, 'drawer-box', path);
        push('Дно ящика (ДВП)', Math.round(boxW - 2 * PANEL_T + 16), Math.round(boxD + 8), HARDBOARD_T, 'drawer-box', path);
        push(`Направляющая шариковая ${runner} мм (пара)`, runner, 45, 1.2, 'drawer-box', path);
      }
    } else if (face.kind === 'panel') {
      push('Панель глухая', hMm, wMm, PANEL_T, 'facade', path);
    }
  };

  // купейные системы: створки и направляющие по боксам секций
  for (const sb of slidingBoxes(p, m)) {
    const ov = Math.min(sb.overlap, sb.w / (sb.doors * 3));
    const dw = (sb.w + ov * (sb.doors - 1)) / sb.doors;
    for (let i = 0; i < sb.doors; i++) {
      push(sb.glass ? 'Створка купе (стекло)' : 'Створка купе', sb.h, dw, sb.glass ? 4 : PANEL_T, 'sliding-door', sb.path);
      push('Профиль створки', sb.h, 26, 1.2, 'sliding-profile', sb.path);
    }
    push('Направляющая купе', Math.round(sb.w), 82, 1.5, 'sliding-track', sb.path);
    push('Направляющая купе', Math.round(sb.w), 82, 1.5, 'sliding-track', sb.path);
  }

  const ib = layoutInterior(p, m);
  walk(m.root, [], ib.w, ib.h);

  // сортировка: сначала горизонтальные (полная ширина), затем вертикальные, потом прочее
  const order: Record<Part['cat'], number> = {
    'h-divider': 0,
    shelf: 1,
    'v-divider': 2,
    carcass: 3,
    facade: 4,
    'sliding-door': 5,
    'sliding-track': 6,
    'sliding-profile': 7,
    'drawer-box': 8,
    plinth: 9,
  };
  parts.sort((a, b) => order[a.cat] - order[b.cat] || b.a - a.a);
  return parts;
}

function layoutInterior(p: Project, m: WardModule) {
  const tL = wallT(m, 'l');
  const tR = wallT(m, 'r');
  return {
    w: Math.max(1, m.w - tL - tR),
    h: Math.max(1, m.h - p.base - 2 * CARCASS_T),
  };
}

/** Суммарная площадь плитного материала, м² (для справки). */
export function totalArea(boms: ModuleBom[]): number {
  let s = 0;
  for (const b of boms)
    for (const part of b.parts) s += ((part.a * part.b) / 1e6) * part.qty;
  return s;
}




/** Спецификация в CSV (разделитель «;» — удобно для русского Excel). */
export function bomToCsv(boms: ModuleBom[]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: string[] = [
    ['Модуль', 'Стена', 'Отступ, мм', 'Ш, мм', 'В, мм', 'Глубина, мм', 'Узел', 'Категория', 'Деталь', 'Длина, мм', 'Ширина, мм', 'Толщина, мм', 'Кол-во', 'Площадь, м²'].map(esc).join(';'),
  ];
  for (const b of boms) {
    for (const part of b.parts) {
      rows.push(
        [
          b.m.id,
          b.m.wall,
          b.m.from,
          b.m.w,
          b.m.h,
          b.m.depth,
          part.path.join('.') || '—',
          part.cat,
          part.name,
          part.a,
          part.b,
          part.t,
          part.qty,
          ((part.a * part.b * part.qty) / 1e6).toFixed(3),
        ].map(esc).join(';'),
      );
    }
  }
  return rows.join('\n');
}
