// Программный smoke-тест: /?autotest. Регрессия доменной логики v3 (короб + дерево нарезки).

import { store } from './store.ts';
import { select, ui } from './state.ts';
import { pathEq } from './types.ts';
import {
  addModule,
  addSocketAt,
  dragDivider,
  makeNicheUnderTv,
  moveModule,
  removeNode,
  setFace,
  setFaceGroup,
  setSharedWall,
  splitLeaf,
  toggleFace,
} from './edit.ts';
import {
  CARCASS_T,
  cornerZones,
  countLeaves,
  dividerSnapCandidates,
  interiorBox,
  layoutModule,
  modulesOn,
  normalizeTree,
  shelfYsIn,
  snapTolerance,
  wallEnd,
  wallStart,
} from './geometry.ts';
import { validate } from './validate.ts';
import { migrate } from './migrate.ts';
import { buildBom } from './bom.ts';
import { leaf } from './defaults.ts';
import { buildReportHtml, moduleDimRefs } from './print.ts';
import { renderFacade } from './views/facade.ts';
import { renderLibrary, renderProps } from './panels.ts';
import type { LeafFace, Path, Project } from './types.ts';

const results: string[] = [];
let failed = 0;

function check(name: string, cond: boolean): void {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed++;
}

function mod(id: string) {
  return store.project.modules.find((m) => m.id === id)!;
}
function faces(root: Project['modules'][number]['root']): LeafFace[] {
  const out: LeafFace[] = [];
  const walk = (n: Project['modules'][number]['root']) => {
    if (n.type === 'leaf') out.push(n.face);
    else n.children.forEach((c) => walk(c.node));
  };
  walk(root);
  return out;
}

export function runAutoTest(): void {
  // 1. контейнер на стене: один открытый отсек, угол огибается
  store.update((pp) => (pp.walls.right.length = 1500));
  const rightBefore = modulesOn(store.project, 'right').length;
  addModule('right');
  const right = modulesOn(store.project, 'right');
  const box1 = right[right.length - 1];
  check('addModule: контейнер добавлен', right.length === rightBefore + 1);
  check('addModule: один лист-ниша по умолчанию', countLeaves(box1.root) === 1 && faces(box1.root)[0].kind === 'open');
  check(
    'addModule: огибает угловую зону',
    box1.from >= cornerZones(store.project, 'right').start,
  );
  check('addModule: ошибок нет', validate(store.project).every((i) => i.level !== 'error'));

  // 2. раскладка: листья точно заполняют нутро, разделитель по толщине
  {
    const { leaves, dividers } = layoutModule(store.project, box1);
    const box = store.project;
    void box;
    check('layout: 1 лист', leaves.length === 1);
    const lb = leaves[0];
    check(
      'layout: лист = нутро короба',
      Math.abs(lb.x - (box1.from + CARCASS_T)) < 1 && Math.abs(lb.w - (box1.w - 2 * CARCASS_T)) < 1,
    );
    check('layout: разделителей нет', dividers.length === 0);
  }

  // 3. split v → два листа + 1 разделитель; инвариант площади
  splitLeaf(box1.id, [], 'v');
  {
    const m = mod(box1.id);
    const { leaves, dividers } = layoutModule(store.project, m);
    check('splitV: 2 листа', leaves.length === 2);
    check('splitV: 1 разделитель 18 мм', dividers.length === 1 && dividers[0].w === CARCASS_T);
    const innerW = m.w - 2 * CARCASS_T;
    check(
      'splitV: дети + перегородка = ширина нутра',
      Math.abs(leaves.reduce((s, l) => s + l.w, 0) + dividers.length * CARCASS_T - innerW) < 1,
    );
  }

  // 4. вложенный split h внутри правого листа
  splitLeaf(box1.id, [1], 'h');
  {
    const m = mod(box1.id);
    const { leaves, dividers } = layoutModule(store.project, m);
    check('splitH(внутри): 3 листа', leaves.length === 3);
    check('splitH: путей разделителей 2', dividers.length === 2);
    const hDivider = dividers.find((d) => d.dir === 'h');
    check('splitH: горизонтальный разделитель найден', !!hDivider);
  }

  // 5. faces: ящики и ниша с шагом
  {
    const m = mod(box1.id);
    setFace(box1.id, [0], { kind: 'drawers', drawers: 4, fill: 'дуб лён' });
    setFace(box1.id, [1, 0], { kind: 'open', shelves: 3 });
    setFace(box1.id, [1, 1], { kind: 'door', hinge: 'right' });
    const f = faces(mod(box1.id).root);
    check('faces: типы проставлены', f.some((x) => x.kind === 'drawers') && f.some((x) => x.kind === 'door'));
    const open = f.find((x) => x.kind === 'open');
    check('faces: ниша c полками', open?.kind === 'open' && open.shelves === 3);
    const { leaves } = layoutModule(store.project, mod(box1.id));
    const openBox = leaves.find((l) => l.path.join('.') === '1.0')!;
    const ys = shelfYsIn(openBox.y, openBox.h, 3, null);
    check('shelfYsIn: 3 полки внутри листа', ys.length === 3 && ys.every((y) => y > openBox.y && y < openBox.y + openBox.h));
    const ysP = shelfYsIn(openBox.y, openBox.h, 0, 300);
    check(
      'shelfYsIn: шаг 300',
      ysP.length >= 2 && ysP[1] - ysP[0] === 300,
    );
  }

  // 6. drag разделителя v: сумма пары постоянна, соседние перегородки не едут
  {
    const m = mod(box1.id);
    const rootSplit = m.root as { type: 'split'; children: { size: number }[] };
    const pairBefore = rootSplit.children[0].size + rootSplit.children[1].size;
    const before = layoutModule(store.project, m);
    const d = before.dividers.find((x) => x.dir === 'v' && x.path.length === 0)!;
    const pos = d.x + d.w / 2 + 100; // сдвигаем вправо на 100
    dragDivider(box1.id, [], 0, pos);
    const after = layoutModule(store.project, mod(box1.id));
    const d2 = after.dividers.find((x) => x.dir === 'v' && x.path.length === 0)!;
    const rootSplit2 = mod(box1.id).root as { type: 'split'; children: { size: number }[] };
    const pairAfter = rootSplit2.children[0].size + rootSplit2.children[1].size;
    check('dragDivider: сумма пары постоянна', Math.abs(pairAfter - pairBefore) < 1.5);
    check('dragDivider: сдвинулся', Math.abs(d2.x - d.x - 100) < 2);
    // в угол пары — не впускает ниже минимума
    dragDivider(box1.id, [], 0, d2.x + d2.w / 2 - 10_000);
    const leftLeaf = layoutModule(store.project, mod(box1.id)).leaves.find((l) => l.path.join('.') === '0')!;
    check('dragDivider: минимальный лист соблюдён', leftLeaf.w >= 79);
  }

  // 7. removeLeaf схлопывает сплит
  {
    const m = mod(box1.id);
    const n = countLeaves(m.root);
    removeNode(box1.id, [1, 0]);
    check('removeNode: листов -1', countLeaves(mod(box1.id).root) === n - 1);
    removeNode(box1.id, [1]);
    check('removeNode: сплит схлопнулся в лист', mod(box1.id).root.type === 'leaf');
    check('removeNode: корень не удаляется', (() => {
      removeNode(box1.id, []);
      return mod(box1.id).root.type === 'leaf';
    })());
  }

  // 8. toggleFace
  {
    setFace(box1.id, [], { kind: 'door', hinge: 'left' });
    toggleFace(box1.id, []);
    check('toggleFace: door → open', mod(box1.id).root.type === 'leaf' && (mod(box1.id).root as { face: LeafFace }).face.kind === 'open');
    toggleFace(box1.id, []);
    check('toggleFace: open → door', mod(box1.id).root.type === 'leaf' && (mod(box1.id).root as { face: LeafFace }).face.kind === 'door');
  }

  // 9. ТВ: ниша ок, фасад — ошибка; ниша под ТВ — авто
  {
    const tv = store.project.tv!;
    const tvMod = modulesOn(store.project, 'center').find(
      (m) => m.from <= tv.centerX && m.from + m.w >= tv.centerX,
    )!;
    const hitLeaf = layoutModule(store.project, tvMod).leaves.find(
      (l) =>
        tv.centerX >= l.x && tv.centerX <= l.x + l.w &&
        tv.centerY >= l.y && tv.centerY <= l.y + l.h,
    )!;
    check('tv: лист за ТВ найден', !!hitLeaf && hitLeaf.leaf.face.kind === 'open');
    setFace(tvMod.id, hitLeaf.path, { kind: 'door', hinge: 'left' });
    check('tv: фасад за ТВ — ошибка', validate(store.project).some((i) => i.message.includes('ТВ перекрыт')));
    makeNicheUnderTv();
    const niche = modulesOn(store.project, tv.wall).find((m) => m.from <= tv.centerX && m.from + m.w >= tv.centerX)!;
    check('tv: ниша под ТВ — открыто', faces(niche.root).every((f) => f.kind === 'open') || (() => {
      const hit = layoutModule(store.project, niche).leaves.find((l) => tv.centerX >= l.x && tv.centerX <= l.x + l.w && tv.centerY >= l.y && tv.centerY <= l.y + l.h);
      return hit?.leaf.face.kind === 'open';
    })());
    check('tv: конфликт устранён', validate(store.project).every((i) => !i.message.includes('ТВ перекрыт')));
  }

  // 10. симметричные углы: боковой контейнер в угол резервирует зону ЦЕНТРАЛЬНОЙ стены
  {
    const Lc = store.project.walls.center.length;
    const tv = store.project.tv!;
    // убираем нишу под ТВ (создана в тесте 9), чтобы свободно двигать правый ряд
    const nicheId = modulesOn(store.project, 'center').find(
      (m) => m.from <= tv.centerX && m.from + m.w >= tv.centerX,
    )?.id;
    store.update((pp) => {
      pp.modules = pp.modules.filter((m) => m.id !== nicheId);
    });
    const m3 = modulesOn(store.project, 'center').sort((a, b) => b.from - a.from)[0];
    store.update((pp) => {
      const t = pp.modules.find((m) => m.id === m3.id);
      if (t) t.from = 1900; // отодвигаем от правого угла, без наложений
    });
    check('corner: правый угол центральной свободен', cornerZones(store.project, 'right').start === 0);

    addModule('right');
    const side = modulesOn(store.project, 'right').sort((a, b) => a.from - b.from)[0];
    check('corner: боковой контейнер встал в угол', side.from === 0);
    const zc = cornerZones(store.project, 'center');
    check('corner: зона на центральной = глубина бокового', zc.end === side.depth);

    store.checkpoint();
    moveModule(m3.id, Lc); // тянем в правый угол — должен упереться в зону
    const m3c = mod(m3.id);
    check(
      'corner: ряд упёрся в угловую зону',
      Math.abs(m3c.from + m3c.w - (Lc - side.depth)) < 1,
    );

    // форсируем нарушение — валидатор ловит
    store.update((pp) => {
      const t = pp.modules.find((m) => m.id === m3.id);
      if (t) t.from = Lc - t.w;
    });
    check('corner: валидатор ловит наезд на зону угла', validate(store.project).some((i) => i.message.includes('заходит в угол')));
    store.undo(); // откат форсирования
    store.undo(); // откат moveModule
  }

  // 11. розетки + undo/redo
  {
    const n = store.project.sockets.length;
    addSocketAt('left', 100, 300);
    check('socket: добавлена', store.project.sockets.length === n + 1);
    const p1 = JSON.stringify(store.project);
    store.undo();
    check('undo: откат', JSON.stringify(store.project) !== p1);
    store.redo();
    check('redo: вернул', JSON.stringify(store.project) === p1);
  }

  // 12. миграция v2 → v3
  {
    const v2 = {
      version: 2,
      name: 'old',
      ceiling: 2600,
      base: 80,
      grid: 50,
      walls: { left: { length: 500 }, center: { length: 2000 }, right: { length: 500 } },
      modules: [
        {
          id: 'm-a',
          wall: 'center',
          from: 0,
          w: 1000,
          h: 2600,
          depth: 600,
          cells: [
            { w: 500, facade: 'door', hinge: 'left', shelves: 4, shelfPitch: null, drawers: 4 },
            { w: 500, facade: null, shelves: 5, shelfPitch: null, drawers: 4 },
          ],
        },
        {
          id: 'm-b',
          wall: 'center',
          from: 1000,
          w: 800,
          h: 2600,
          depth: 600,
          cells: [{ w: 800, facade: 'drawer', hinge: 'left', shelves: 0, shelfPitch: null, drawers: 5 }],
        },
      ],
      tv: null,
      sockets: [],
    };
    const p3 = migrate(structuredClone(v2));
    check('migrate: v2 распознан', !!p3 && p3.version === 4);
    const a = p3?.modules.find((m) => m.id === 'm-a');
    const b = p3?.modules.find((m) => m.id === 'm-b');
    check('migrate: 2 секции → split v с дверцей и нишей', !!a && a.root.type === 'split' && (() => {
      const f = faces(a.root);
      return f.length === 2 && f[0].kind === 'door' && f[1].kind === 'open';
    })());
    check('migrate: ящики → лист drawers', !!b && b.root.type === 'leaf' && (b.root as { face: LeafFace }).face.kind === 'drawers');
    check('migrate: идемпотентна', !!p3 && migrate(structuredClone(p3))?.version === 4);
  }

  // 13. геометрия рендера: лист лежит внутри корпуса (с зеркалом левой стены)
  {
    // удлиняем левую стену, чтобы после угловой зоны осталось место под контейнер
    store.update((pp) => {
      pp.walls.left.length = 1800;
    });
    const zLeft = cornerZones(store.project, 'left').start;
    check('render: на левой стене есть место после угла', 1800 - zLeft >= 200);
    addModule('left');
    const lm = modulesOn(store.project, 'left').slice(-1)[0];
    if (!lm) {
      check('render: на левой стене есть контейнер', false);
    } else {
    setFace(lm.id, [], { kind: 'door', hinge: 'left' });
    renderFacade();
    const facadeSvg = document.getElementById('facade');
    let checked = 0;
    let ok = !!facadeSvg;
    for (const m of store.project.modules) {
      const x0 = wallStart(store.project)[m.wall];
      const len = store.project.walls[m.wall].length;
      const mirror = m.wall === 'left';
      const { leaves } = layoutModule(store.project, m);
      const g = facadeSvg?.querySelector(`g[data-hit="mod"][data-id="${m.id}"]`);
      if (!g) {
        ok = false;
        continue;
      }
      for (const lb of leaves) {
        if (lb.leaf.face.kind === 'open') continue;
        const path = lb.path.join('.');
        const rect = g.querySelector(`g[data-hit="leaf"][data-path="${path}"] rect`);
        if (!rect) continue;
        const xAttr = parseFloat(rect.getAttribute('x') ?? 'NaN');
        const expX = mirror ? x0 + len - (lb.x + lb.w) : x0 + lb.x;
        checked++;
        if (Math.abs(xAttr - expX) > 1.5) ok = false;
      }
    }
    check(`render: листы на месте корпуса (проверено ${checked})`, ok && checked > 0);
    // каждый leaf-группа должна содержать кликабельную подложку (regression: пустая ниша не ловила клик)
    const leafGroups = facadeSvg?.querySelectorAll('g[data-hit="leaf"]') ?? [];
    let hitOk = leafGroups.length > 0;
    leafGroups.forEach((g) => {
      const painted = [...g.querySelectorAll('rect, line, path')].some((el) => {
        const pe = el.getAttribute('pointer-events');
        const fill = el.getAttribute('fill');
        return pe === 'all' || (fill !== null && fill !== 'none' && fill !== 'transparent');
      });
      if (!painted) hitOk = false;
    });
    check(`render: все ${leafGroups.length} отсеков кликабельны`, hitOk);
    }
  }

  // 14. панель: спиннер полок step=1 (регрессия ±10)
  {
    const openM = store.project.modules.find((m) => {
      const { leaves } = layoutModule(store.project, m);
      return leaves.some((l) => l.leaf.face.kind === 'open' && !l.leaf.face.shelfPitch);
    });
    const openLb = openM && layoutModule(store.project, openM).leaves.find((l) => l.leaf.face.kind === 'open' && !l.leaf.face.shelfPitch);
    if (openM && openLb) {
      select({ kind: 'module', id: openM.id }, openLb.path as Path);
      const propsEl = document.getElementById('props');
      if (propsEl) renderProps(propsEl);
      check(
        'панель: спиннер полок step=1 0..20',
        !!document.querySelector('#props input[step="1"][min="0"][max="20"]'),
      );
      select(null);
    } else {
      check('панель: найдена ниша без шага', false);
    }
  }

  // 14b. дерево структуры: клик по секции выбирает split, групповое лицо применяется
  {
    const c = store.project.modules.find((m) => modulesOn(store.project, 'center').includes(m));
    void c;
    const m3 = modulesOn(store.project, 'center').find((m) => countLeaves(m.root) >= 2);
    if (m3) {
      select({ kind: 'module', id: m3.id }, [0]);
      const propsEl = document.getElementById('props');
      if (propsEl) renderProps(propsEl);
      const treeRows = document.querySelectorAll('#props .tree-row');
      check('дерево: строки узлов отрисованы', treeRows.length >= 2);
      const secNode = document.querySelector('#props .tree-row.sel');
      check('дерево: выбранный узел подсвечен', !!secNode && !!secNode.textContent?.includes('Секция'));
      // групповое лицо через setFaceGroup
      setFaceGroup(m3.id, [], { kind: 'panel', fill: 'графит' });
      check('setFaceGroup: все листья стали панелями', faces(mod(m3.id).root).every((f) => f.kind === 'panel'));
      // удаление всей секции целиком (не листа)
      const nBefore = countLeaves(mod(m3.id).root);
      removeNode(m3.id, [0]);
      check('removeNode: секция целиком удалена', countLeaves(mod(m3.id).root) < nBefore);
      select(null);
    } else {
      check('дерево: найден модуль с 2+ листьями', false);
    }
  }

  // 15. привязка разделителей к существующим + контекстная панель
  {
    const Lc = store.project.walls.center.length;
    store.update((pp) => {
      pp.walls.center.length = 3000;
      pp.modules = [];
    });
    addModule('center');
    const bm = modulesOn(store.project, 'center')[0];
    // v-сплит, затем h-сплиты в обеих половинах -> две горизонтальные перегородки
    splitLeaf(bm.id, [], 'v');
    splitLeaf(bm.id, [0], 'h');
    splitLeaf(bm.id, [1], 'h');
    const p = store.project;
    const m = mod(bm.id);

    const candsH = dividerSnapCandidates(p, 'center', 'h', { moduleId: bm.id, path: [0], after: 0 });
    check('snap: кандидаты h найдены (вторая полка)', candsH.length === 1);
    const tol = snapTolerance(p);
    check(`snap: допуск разумный (${tol})`, tol >= 10 && tol <= 40);
    // зум-зависимый допуск: на мелком масштабе магнит ловится мышью (~8 px)
    const tolZoomed = snapTolerance(p, 0.128);
    check(
      `snap: допуск при зуме 0.128 ≈ 8px (${tolZoomed.toFixed(0)} мм)`,
      Math.abs(tolZoomed * 0.128 - 8) < 1.5,
    );

    // тянем первую h-перегородку к позиции второй (не точно — в пределах допуска)
    const d1 = layoutModule(p, m).dividers.find((d) => d.dir === 'h' && d.path.length === 1 && d.path[0] === 0)!;
    const targetY = candsH[0] + tol * 0.6; // в пределах допуска, но не точно
    dragDivider(bm.id, [0], 0, targetY, { candidates: candsH, tol });
    const m2 = mod(bm.id);
    const d1b = layoutModule(p, m2).dividers.find((d) => d.dir === 'h' && d.path.length === 1 && d.path[0] === 0)!;
    const d2b = layoutModule(p, m2).dividers.find((d) => d.dir === 'h' && d.path.length === 1 && d.path[0] === 1)!;
    const y1 = d1b.y + d1b.h / 2;
    const y2 = d2b.y + d2b.h / 2;
    check(`snap: перегородка примагнитилась (${Math.round(y1)} ≈ ${Math.round(y2)})`, Math.abs(y1 - y2) < 0.6);
    void d1;

    // вне допуска — не магнитится
    const before = y1;
    dragDivider(bm.id, [0], 0, candsH[0] + tol * 3, { candidates: [candsH[0]], tol });
    const d1c = layoutModule(p, mod(bm.id)).dividers.find((d) => d.dir === 'h' && d.path.length === 1 && d.path[0] === 0)!;
    const y1c = d1c.y + d1c.h / 2;
    check('snap: вне допуска не магнитится', Math.abs(y1c - candsH[0]) > tol * 2 && Math.abs(y1c - before) > 1);

    // контекстные инструменты нарезки — слева, свойства лица — справа
    select({ kind: 'module', id: bm.id }, [0, 0]);
    const libEl = document.getElementById('library');
    if (libEl) renderLibrary(libEl);
    const propsEl = document.getElementById('props');
    if (propsEl) renderProps(propsEl);
    const ctx = document.querySelector('#library .ctx-toolbar');
    const hasSplit = [...(ctx?.querySelectorAll('button') ?? [])].some((b) => b.textContent?.includes('Вертикально'));
    const hasFaceLeft = [...(ctx?.querySelectorAll('button') ?? [])].some((b) => b.textContent?.includes('Ниша'));
    const hasFaceProps = [...(document.querySelectorAll('#props button, #props select'))].some(
      (b) => b.textContent?.includes('Ниша') || (b as HTMLSelectElement).value === 'open',
    );
    check('панель: нарезка слева', !!ctx && hasSplit && !hasFaceLeft);

    // 15b. кандидаты со ВСЕЙ стены: перегородка соседнего модуля + полки ниши
    {
      store.update((pp) => {
        pp.walls.center.length = 3000;
        pp.modules = [];
      });
      addModule('center');
      const mA = modulesOn(store.project, 'center')[0];
      splitLeaf(mA.id, [], 'h'); // одна h-перегородка в модуле A
      // модуль B вплотную, с нишей на 2 полки (позиции не совпадают с A)
      addModule('center');
      const mB = modulesOn(store.project, 'center').filter((x) => x.id !== mA.id)[0];
      setFace(mB.id, [], { kind: 'open', shelves: 2 });
      const candsWall = dividerSnapCandidates(store.project, 'center', 'h', {
        moduleId: mA.id,
        path: [],
        after: 0,
      });
      // перетаскиваемая перегородка A (path [], after 0) должна быть ИСКЛЮЧЕНА
      const draggedA = layoutModule(store.project, mod(mA.id)).dividers.find(
        (d) => d.dir === 'h' && d.path.length === 0 && d.after === 0,
      )!;
      const shelvesB = layoutModule(store.project, mod(mB.id)).leaves
        .filter((l) => l.leaf.face.kind === 'open')
        .flatMap((l) => shelfYsIn(l.y, l.h, (l.leaf.face as { shelves: number }).shelves, null));
      check(
        'snap: кандидаты — полки ниши соседнего модуля B',
        shelvesB.length >= 1 &&
          shelvesB.every((sy) => candsWall.some((c) => Math.abs(c - sy) < 0.5)),
      );
      check(
        'snap: перетаскиваемая перегородка A исключена из кандидатов',
        !candsWall.some((c) => Math.abs(c - (draggedA.y + draggedA.h / 2)) < 0.5),
      );
      // тянем перегородку A к полке ниши B — магнитится через всю стену
      const target = shelvesB[0] ?? 1500;
      dragDivider(mA.id, [], 0, target + 5, {
        candidates: candsWall,
        tol: snapTolerance(store.project, 0.128),
      });
      const dA = layoutModule(store.project, mod(mA.id)).dividers.find((d) => d.dir === 'h')!;
      check(
        'snap: перегородка A притянута к полке B',
        Math.abs(dA.y + dA.h / 2 - target) < 0.6,
      );
    }
    check('панель: лицо отсека в свойствах справа', hasFaceProps);
    select(null);
    store.update((pp) => (pp.walls.center.length = Lc));
  }

  // 16. РЕАЛЬНЫЙ клик по ячейке: что перехватывает и что выбирается
  {
    store.update((pp) => {
      pp.walls.center.length = 3000;
      pp.modules = [];
      pp.tv = null;
      pp.sockets = [];
    });
    addModule('center');
    const bm = modulesOn(store.project, 'center')[0];
    check('click: после addModule выбрана корневая ячейка', pathEq(ui.path, []));
    splitLeaf(bm.id, [], 'v');
    splitLeaf(bm.id, [1], 'h');
    select({ kind: 'module', id: bm.id }, [1, 0]);
    renderFacade();

    const svgEl = document.getElementById('facade') as unknown as SVGSVGElement;
    const probe = (pathStr: string): string => {
      const g = svgEl.querySelector(`g[data-hit="leaf"][data-path="${pathStr}"]`);
      const r = g?.querySelector('rect') as SVGGraphicsElement | null;
      if (!r) return 'нет-rect';
      const bb = r.getBoundingClientRect();
      const el = document.elementFromPoint(bb.x + bb.width / 2, bb.y + bb.height / 2);
      const top = el?.closest('[data-hit]');
      return `${top?.getAttribute('data-hit') ?? 'null'}:${top?.getAttribute('data-path') ?? top?.getAttribute('data-dir') ?? ''}`;
    };
    const probes = ['0', '1.0', '1.1'].map((ps) => `${ps}→${probe(ps)}`);
    check(
      `click: elementFromPoint попадает в leaf (${probes.join(', ')})`,
      ['0', '1.0', '1.1'].every((ps) => probe(ps) === `leaf:${ps}`),
    );

    // синтетический pointerdown в центре ячейки 1.0
    {
      const g = svgEl.querySelector(`g[data-hit="leaf"][data-path="1.0"]`);
      const r = g?.querySelector('rect') as SVGGraphicsElement;
      const bb = r.getBoundingClientRect();
      select(null);
      const evInit: PointerEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: bb.x + bb.width / 2,
        clientY: bb.y + bb.height / 2,
        button: 0,
        pointerId: 7,
        isPrimary: true,
      };
      const target = document.elementFromPoint(evInit.clientX!, evInit.clientY!) ?? svgEl;
      const targetInfo = `${target.tagName}[${target.closest('[data-hit]')?.getAttribute('data-hit')}:${target.closest('[data-hit]')?.getAttribute('data-path')}]`;
      target.dispatchEvent(new PointerEvent('pointerdown', evInit));
      target.dispatchEvent(new PointerEvent('pointerup', evInit));
      check(
        `click: pointerdown по ячейке выбирает её (target=${targetInfo}, sel=${ui.sel?.kind}, path=${ui.path?.join('.') ?? 'null'})`,
        ui.sel?.kind === 'module' && pathEq(ui.path, [1, 0]),
      );
    }

    // сплит из тулбара должен применяться к ВЫБРАННОЙ ячейке, а не к контейнеру
    {
      select({ kind: 'module', id: bm.id }, [0]);
      const before = countLeaves(mod(bm.id).root);
      splitLeaf(bm.id, [0], 'h');
      const m = mod(bm.id);
      const rightUntouched = (() => {
        const node = (m.root as { children: { node: { type: string } }[] }).children[1].node;
        return node.type === 'split' && (node as unknown as { children: unknown[] }).children.length === 2;
      })();
      check('split: режется выбранная ячейка, а не контейнер', countLeaves(m.root) === before + 1 && rightUntouched);
      check('split: выбор перешёл на новую ячейку', pathEq(ui.path, [0, 1]));
    }
  }

  // 17. тяга одной перегородки НЕ двигает соседние (абсолютные мм).
  // Сценарий пользователя: ОДИН плоский сплит из 3+ детей (группа полок).
  {
    store.update((pp) => {
      pp.walls.center.length = 3000;
      pp.modules = [];
      pp.tv = null;
    });
    addModule('center');
    const bm = modulesOn(store.project, 'center')[0];
    // горизонтальная нарезка: 0 -> [0,1] -> [0,1,2] — плоский сплит из 3 детей, 2 полки
    splitLeaf(bm.id, [], 'h');
    splitLeaf(bm.id, [1], 'h');
    // корень должен схлопнуться в один h-сплит из 3 детей? нет: [0] и [1]=split.
    // Для плоского сплита соберём дерево напрямую:
    store.update((pp) => {
      const m = pp.modules.find((x) => x.id === bm.id)!;
      m.root = {
        type: 'split',
        dir: 'h',
        t: 18,
        children: [
          { size: 600, node: leaf({ kind: 'open', shelves: 0 }) },
          { size: 600, node: leaf({ kind: 'open', shelves: 0 }) },
          { size: 600, node: leaf({ kind: 'open', shelves: 0 }) },
        ],
      };
      normalizeTree(pp, m); // размеры в мм должны соответствовать нутру
    });
    let m = mod(bm.id);
    const divs = () =>
      layoutModule(store.project, mod(bm.id)).dividers
        .filter((d) => d.dir === 'h')
        .sort((a, b) => a.y - b.y);
    let ds = divs();
    check('abs: плоский сплит имеет 2 перегородки', ds.length === 2);
    const y1Before = ds[1].y;
    // тянем НИЖНЮЮ перегородку вниз — верхняя обязана стоять на месте
    dragDivider(bm.id, [], 0, ds[0].y + ds[0].h / 2 - 150);
    ds = divs();
    check('abs: тяга нижней полки не двигает верхнюю', Math.abs(ds[1].y - y1Before) < 0.51);
    m = mod(bm.id);
    const root = m.root as { children: { size: number }[] };
    const sumAfter = root.children.reduce((s, c) => s + c.size, 0);
    check('abs: сумма размеров детей = нутро (без дрейфа)', Math.abs(sumAfter - (m.h - store.project.base - 36 - 2 * 18)) < 1.5);
    // тянем ВЕРХНЮЮ перегородку — нижняя стоит
    const y0Before = ds[0].y;
    dragDivider(bm.id, [], 1, ds[1].y + ds[1].h / 2 + 120);
    ds = divs();
    check('abs: тяга верхней полки не двигает нижнюю', Math.abs(ds[0].y - y0Before) < 0.51);
    // вертикальный сплит из 3 детей — то же по x
    store.update((pp) => {
      const mm = pp.modules.find((x) => x.id === bm.id)!;
      mm.root = {
        type: 'split',
        dir: 'v',
        t: 18,
        children: [
          { size: 150, node: leaf({ kind: 'open', shelves: 0 }) },
          { size: 150, node: leaf({ kind: 'open', shelves: 0 }) },
          { size: 150, node: leaf({ kind: 'open', shelves: 0 }) },
        ],
      };
      normalizeTree(pp, mm);
    });
    const vdivs = () =>
      layoutModule(store.project, mod(bm.id)).dividers
        .filter((d) => d.dir === 'v')
        .sort((a, b) => a.x - b.x);
    let vs = vdivs();
    const vx1Before = vs[1].x;
    dragDivider(bm.id, [], 0, vs[0].x + vs[0].w / 2 - 40);
    vs = vdivs();
    check('abs: вертикальная тяга не двигает соседнюю', Math.abs(vs[1].x - vx1Before) < 0.51);
  }

  // 17b. ВЛОЖЕННАЯ нарезка: тяга внутренней перегородки не пересчитывает
  //     остальные проёмы того же ряда (регрессия пропорционального scale)
  {
    store.update((pp) => {
      pp.walls.center.length = 3000;
      pp.modules = [];
      pp.tv = null;
    });
    addModule('center');
    const bm = modulesOn(store.project, 'center')[0];
    // корень: 2 колонки; левая колонка: 3 полки (вложенный h-сплит)
    store.update((pp) => {
      const m = pp.modules.find((x) => x.id === bm.id)!;
      const ib = interiorBox(pp, m);
      const colW = (ib.w - 18) / 2;
      m.root = {
        type: 'split',
        dir: 'v',
        t: 18,
        children: [
          {
            size: colW,
            node: {
              type: 'split',
              dir: 'h',
              t: 18,
              children: [
                { size: 600, node: leaf({ kind: 'open', shelves: 0 }) },
                { size: 600, node: leaf({ kind: 'open', shelves: 0 }) },
                { size: ib.h - 1200 - 36, node: leaf({ kind: 'open', shelves: 0 }) },
              ],
            },
          },
          { size: colW, node: leaf({ kind: 'open', shelves: 0 }) },
        ],
      };
    });

    const innerH = () =>
      layoutModule(store.project, mod(bm.id)).dividers
        .filter((d) => d.dir === 'h' && d.path.length === 1 && d.path[0] === 0)
        .sort((a, b) => a.y - b.y);
    const rightLeaf = () =>
      layoutModule(store.project, mod(bm.id)).leaves.find((l) => l.path.join('.') === '1')!;

    // тянем НИЖНЮЮ полку левой колонки — верхняя не едет, третий проём
    // начинается там же (его нижняя граница — дно короба — тоже неподвижна)
    let ds = innerH();
    const top0 = ds[1].y;
    const third0 = layoutModule(store.project, mod(bm.id)).leaves
      .filter((l) => l.path.length === 2 && l.path[0] === 0)
      .sort((a, b) => a.y - b.y)[2];
    const thirdStart0 = third0.y + third0.h; // верх третьего проёма = низ второго
    const right0 = rightLeaf();
    dragDivider(bm.id, [0], 0, ds[0].y + ds[0].h / 2 - 120);
    ds = innerH();
    check('nested: верхняя полка ряда не пересчитана', Math.abs(ds[1].y - top0) < 0.51);
    const right1 = rightLeaf();
    check(
      'nested: правая колонка не пострадала',
      Math.abs(right1.x - right0.x) < 0.51 && Math.abs(right1.h - right0.h) < 0.51,
    );
    // первый проём вырос на 120, второй сжался на 120, третий не изменился
    const third1 = layoutModule(store.project, mod(bm.id)).leaves
      .filter((l) => l.path.length === 2 && l.path[0] === 0)
      .sort((a, b) => a.y - b.y)[2];
    check(
      'nested: третий проём сохранил высоту и позицию',
      Math.abs(third1.h - third0.h) < 0.51 && Math.abs(third1.y + third1.h - thirdStart0) < 0.51,
    );

    // тяга ВНЕШНЕЙ перегородки: внутренний ряд левой колонки не масштабируется
    const innerBefore = innerH().map((d) => d.y);
    const sizesBefore = ((mod(bm.id).root as { children: { node: { children?: { size: number }[] } }[] })
      .children[0].node.children ?? []).map((c) => c.size);
    const outer = layoutModule(store.project, mod(bm.id)).dividers.find((d) => d.dir === 'v')!;
    dragDivider(bm.id, [], 0, outer.x + outer.w / 2 + 200);
    const sizesAfter = ((mod(bm.id).root as { children: { node: { children?: { size: number }[] } }[] })
      .children[0].node.children ?? []).map((c) => c.size);
    check(
      'nested: внешняя тяга не меняет внутренние размеры',
      JSON.stringify(sizesBefore) === JSON.stringify(sizesAfter),
    );
    const innerAfter = innerH().map((d) => d.y);
    check(
      'nested: позиции внутренних полок не пересчитаны',
      JSON.stringify(innerBefore.map(Math.round)) === JSON.stringify(innerAfter.map(Math.round)),
    );
  }

  // 18. общие стенки: авто-включение вплотную, interior, ручное отключение, авто-снятие
  {
    store.update((pp) => {
      pp.walls.center.length = 3000;
      pp.modules = [];
    });
    addModule('center');
    const a = modulesOn(store.project, 'center')[0];
    addModule('center'); // встаёт вплотную к a автоматически
    const b = modulesOn(store.project, 'center').filter((x) => x.id !== a.id)[0];
    check('shared: стык вплотную включил общие стенки', mod(a.id).rightShared && mod(b.id).leftShared);
    const ibA = interiorBox(store.project, mod(a.id));
    check('shared: interior = w - 18 - 9 (правая общая)', Math.abs(ibA.w - (mod(a.id).w - 18 - 9)) < 0.51);
    setSharedWall(a.id, 'r', false);
    const ibA2 = interiorBox(store.project, mod(a.id));
    check('shared: ручное отключение → своя стенка 18', Math.abs(ibA2.w - (mod(a.id).w - 18 - 18)) < 0.51);
    // разъехались — авто-отключение общих стенок
    moveModule(b.id, b.from + 300);
    check('shared: разъехались — общие стенки снялись', !mod(a.id).rightShared && !mod(b.id).leftShared);
    // съехались обратно — авто-включение
    moveModule(b.id, a.from + mod(a.id).w);
    check('shared: снова вплотную — общие стенки вернулись', mod(a.id).rightShared && mod(b.id).leftShared);
  }

  // 19. BOM: горизонтальные перегородки на полную ширину, приоритет в сортировке
  {
    store.update((pp) => {
      pp.walls.center.length = 3000;
      pp.modules = [];
    });
    addModule('center');
    const bm = modulesOn(store.project, 'center')[0];
    splitLeaf(bm.id, [], 'h');           // две секции горизонтально
    splitLeaf(bm.id, [1], 'v');          // нижняя — две вертикально
    setFace(bm.id, [0], { kind: 'door', hinge: 'left' });
    const boms = buildBom(store.project);
    const parts = boms[0].parts;
    const m = mod(bm.id);
    const innerW = m.w - 18 - 18; // одиночный модуль — стенки свои
    const hDiv = parts.find((x) => x.cat === 'h-divider');
    check('bom: горизонтальная перегородка найдена', !!hDiv);
    check(
      `bom: h-перегородка на полную ширину (${hDiv?.a} ≈ ${innerW})`,
      !!hDiv && Math.abs(hDiv.a - innerW) < 1,
    );
    const vDiv = parts.find((x) => x.cat === 'v-divider');
    check('bom: вертикальная перегородка есть', !!vDiv);
    const firstCat = parts[0].cat;
    check('bom: горизонтальные идут первыми (приоритет)', firstCat === 'h-divider');
    const facade = parts.find((x) => x.cat === 'facade');
    check('bom: фасад дверцы учтён', !!facade && facade.qty >= 1);
    check('bom: корпус — 4 панели + цоколь', parts.filter((x) => x.cat === 'carcass').length === 4);
  }

  // 20. печатный отчёт: размеры от граней плит, не от середины
  {
    store.update((pp) => {
      pp.walls.center.length = 3000;
      pp.modules = [];
      pp.tv = null;
    });
    addModule('center');
    const ma = modulesOn(store.project, 'center')[0];
    addModule('center'); // вплотную → общие стенки
    const mb = modulesOn(store.project, 'center').filter((x) => x.id !== ma.id)[0];

    // одиночный модуль: размеры = полный габарит, общей плиты нет
    store.update((pp) => {
      pp.modules = pp.modules.filter((x) => x.id === ma.id);
    });
    const solo = mod(ma.id);
    const refsSolo = moduleDimRefs(store.project, solo);
    check(
      'print refs: одиночный модуль от своей грани до своей',
      refsSolo.l === solo.from && refsSolo.r === solo.from + solo.w && refsSolo.sharedPanel === null,
    );

    // стык: левый модуль — до ГРАНИ общей плиты (from + w - 9), плита отдельно
    const refsL = moduleDimRefs(store.project, solo);
    store.update((pp) => pp.modules.push(mb));
    moveModule(mb.id, wallEnd(solo));
    const m2 = mod(ma.id);
    const refsShared = moduleDimRefs(store.project, m2);
    check(
      'print refs: левый модуль стыка доводится до грани плиты (−9), не до середины',
      refsShared.r === m2.from + m2.w - 9 && refsShared.sharedPanel === m2.from + m2.w,
    );
    const refsRight = moduleDimRefs(store.project, mod(mb.id));
    check(
      'print refs: правый модуль начинается от грани плиты (+9)',
      refsRight.l === mod(mb.id).from + 9,
    );
    void refsL;

    // нарезка, чтобы в спецификации была горизонтальная перегородка
    splitLeaf(ma.id, [], 'h');
    try {
      const html = buildReportHtml(store.project);
      check('print: отчёт содержит фасад, план и спецификацию',
        html.includes('<svg') && html.includes('Спецификация раскроя') && html.includes('Перегородка горизонтальная'));
      check('print: общая плита dimensioned отдельно', html.includes('18 (общая)'));
      check('print: нет NaN/undefined', !html.includes('NaN') && !html.includes('undefined'));
    } catch (e) {
      check(`print: отчёт построен (${String(e)})`, false);
    }
  }

  // инвариант финальный
  check('инвариант: ошибок нет', validate(store.project).every((i) => i.level !== 'error'));

  document.title = `AUTOTEST ${failed === 0 ? 'OK' : `FAILED(${failed})`}`;
  const pre = document.createElement('pre');
  pre.id = 'autotest-result';
  pre.textContent = results.join('\n');
  document.body.append(pre);
  console.log(results.join('\n'));
}
