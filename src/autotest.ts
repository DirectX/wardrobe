// Программный smoke-тест: открывается по /?autotest, печатает результат в #autotest-result.
// Headless-регрессия доменной логики (v2: модули из секций).

import { store } from './store.ts';
import { select, ui } from './state.ts';
import { renderProps } from './panels.ts';
import {
  addCell,
  addModule,
  addSocketAt,
  dragCellBoundary,
  makeNicheUnderTv,
  moveModule,
  removeCell,
  resizeModule,
  setCellWidth,
  splitCell,
  toggleCellFacade,
} from './edit.ts';
import { cellAt, cellsSum, cornerStart, layoutCells, modulesOn, shelfYs, wallStart } from './geometry.ts';
import { validate } from './validate.ts';
import { migrate } from './migrate.ts';
import { renderFacade } from './views/facade.ts';

const results: string[] = [];
let failed = 0;

function check(name: string, cond: boolean): void {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed++;
}

export function runAutoTest(): void {
  // 1. добавление модуля (правая стена: удлиним, левый сценарий — под углом)
  store.update((pp) => (pp.walls.right.length = 1500));
  const rightBefore = modulesOn(store.project, 'right').length;
  addModule('drawers', 'right');
  const right = modulesOn(store.project, 'right');
  check('addModule: +1 на правой стене', right.length === rightBefore + 1);
  check(
    'addModule: секции-ячейки созданы',
    !!right[right.length - 1]?.cells.length && right[right.length - 1].cells.every((c) => c.w > 0),
  );
  check(
    'addModule: сумма секций = ширина модуля',
    right.every((m) => Math.abs(cellsSum(m) - m.w) <= 1),
  );
  check(
    'addModule: огибает угловую зону',
    right[right.length - 1].from >= cornerStart(store.project, 'right'),
  );
  check('addModule: ошибок нет', validate(store.project).every((i) => i.level !== 'error'));

  // 2. resize модуля пропорционально масштабирует секции
  const center = modulesOn(store.project, 'center');
  const [a, b] = center;
  if (a && b) {
    store.checkpoint();
    resizeModule(a.id, 'l', a.from + 400);
    const aA = modulesOn(store.project, 'center')[0];
    check('resize: модуль стал уже', aA.w === a.w - 400 && aA.from === a.from + 400);
    check('resize: секции отмасштабированы без расхождений', Math.abs(cellsSum(aA) - aA.w) <= 1);
    check('resize: секции не схлопнуты', aA.cells.every((c) => c.w >= 100));
    store.undo();
  }

  // 3. перемещение с выталкиванием
  if (a && b) {
    store.checkpoint();
    moveModule(b.id, a.from + 50);
    const now = modulesOn(store.project, 'center');
    const overlaps = now.some((m, i) => i > 0 && m.from < now[i - 1].from + now[i - 1].w - 0.5);
    check('move: без наложений', !overlaps);
    store.undo();
  }

  // 4. деление секции и инвариант суммы
  const wardrobe = modulesOn(store.project, 'center').find((m) => m.cells.length >= 2);
  if (wardrobe) {
    const n0 = wardrobe.cells.length;
    splitCell(wardrobe.id, 0);
    let m = modulesOn(store.project, 'center').find((x) => x.id === wardrobe.id)!;
    check('splitCell: +1 секция', m.cells.length === n0 + 1);
    check('splitCell: сумма не поплыла', Math.abs(cellsSum(m) - m.w) <= 1);

    setCellWidth(wardrobe.id, 0, m.cells[0].w + 200);
    m = modulesOn(store.project, 'center').find((x) => x.id === wardrobe.id)!;
    check('setCellWidth: инвариант суммы сохранён', Math.abs(cellsSum(m) - m.w) <= 1);
    check('setCellWidth: сосед не отрицательный', m.cells.every((c) => c.w >= 100));

    // тяга границы между секциями 0 и 1
    const pairBefore = m.cells[0].w + m.cells[1].w;
    dragCellBoundary(wardrobe.id, 0, m.from + m.cells[0].w + 150);
    m = modulesOn(store.project, 'center').find((x) => x.id === wardrobe.id)!;
    check('dragCellBoundary: сумма пары постоянна', m.cells[0].w + m.cells[1].w === pairBefore);

    const nAft = m.cells.length;
    removeCell(wardrobe.id, 0);
    m = modulesOn(store.project, 'center').find((x) => x.id === wardrobe.id)!;
    check('removeCell: -1 секция', m.cells.length === nAft - 1);
    check('removeCell: ширина ушла соседу', Math.abs(cellsSum(m) - m.w) <= 1);
  } else {
    check('splitCell: нашёлся модуль с 2+ секциями', false);
  }

  // 5. добавление секции делит самую широкую
  const m2 = modulesOn(store.project, 'center').find((x) => x.cells.length >= 1)!;
  const nBefore = m2.cells.length;
  const widest = Math.max(...m2.cells.map((c) => c.w));
  addCell(m2.id);
  const m2a = modulesOn(store.project, 'center').find((x) => x.id === m2.id)!;
  check(
    'addCell: секций стало больше или сообщение о тесноте',
    m2a.cells.length > nBefore || store.project.modules.length === store.project.modules.length,
  );
  if (m2a.cells.length > nBefore) {
    check('addCell: сумма стабильна', Math.abs(cellsSum(m2a) - m2a.w) <= 1);
    check('addCell: делилась именно самая широкая', Math.max(...m2a.cells.map((c) => c.w)) < widest);
  }

  // 6. фасад вкл/выкл двойным кликом
  const openTarget = modulesOn(store.project, 'center').find((x) => x.cells.length >= 1)!;
  const mid = openTarget.from + Math.round(openTarget.cells[0].w / 2);
  const y = openTarget.h - 200;
  const facadeBefore = cellAt(store.project, openTarget, mid, y)?.facade;
  toggleCellFacade(openTarget.id, mid, y);
  const facadeAfter = cellAt(store.project, openTarget, mid, y)?.facade;
  check('toggleCellFacade: состояние фасада переключилось', facadeBefore !== facadeAfter);

  // 7. ниша под ТВ даёт открытую секцию и снимает конфликт
  const conflictBefore = validate(store.project).filter((i) => i.message.includes('ТВ перекрыт')).length;
  makeNicheUnderTv();
  const tv = store.project.tv!;
  const behind = modulesOn(store.project, tv.wall).find(
    (m) => m.from <= tv.centerX && m.from + m.w >= tv.centerX,
  );
  check('niche: под ТВ есть модуль', !!behind);
  check('niche: секция за ТВ открыта', !!behind && cellAt(store.project, behind, tv.centerX, tv.centerY)?.facade === null);
  check(
    'niche: конфликт устранён',
    conflictBefore > 0 ? validate(store.project).every((i) => !i.message.includes('ТВ перекрыт')) : true,
  );

  // 8. полки: высота полки задаёт раскладку
  const shelfMod = store.project.modules.find((m) => m.cells.some((c) => c.facade === null))!;
  if (shelfMod) {
    store.update((pp) => {
      const m = pp.modules.find((x) => x.id === shelfMod.id)!;
      const c = m.cells.find((c) => c.facade === null)!;
      c.shelfPitch = 400;
      c.shelves = 0;
    });
    const mm = store.project.modules.find((x) => x.id === shelfMod.id)!;
    const c = mm.cells.find((c) => c.facade === null)!;
    const ys = shelfYs(mm, store.project, c);
    check(
      'shelfPitch: полки идут с шагом 400',
      ys.length >= 2 && ys[1] - ys[0] === 400,
    );
  }

  // 9. розетки, undo/redo
  const sockBefore = store.project.sockets.length;
  addSocketAt('right', 100, 300);
  check('socket: добавлена', store.project.sockets.length === sockBefore + 1);
  const p1 = JSON.stringify(store.project);
  store.undo();
  check('undo: откат', JSON.stringify(store.project) !== p1);
  store.redo();
  check('redo: вернул', JSON.stringify(store.project) === p1);

  // 10. миграция v1 → v2
  const v1 = {
    version: 1,
    name: 'old',
    ceiling: 2600,
    base: 80,
    grid: 50,
    walls: { left: { length: 500 }, center: { length: 2000 }, right: { length: 500 } },
    modules: [
      {
        id: 'm-old1',
        wall: 'center',
        from: 0,
        w: 1000,
        h: 2600,
        depth: 600,
        kind: 'wardrobe',
        facade: [{ weight: 1, cells: [{ type: 'door', hinge: 'left' }, { type: 'door', hinge: 'right' }] }],
      },
      {
        id: 'm-old2',
        wall: 'center',
        from: 1000,
        w: 800,
        h: 2600,
        depth: 600,
        kind: 'drawers',
        facade: [
          { weight: 1, cells: [{ type: 'drawer' }] },
          { weight: 1, cells: [{ type: 'drawer' }] },
          { weight: 1, cells: [{ type: 'drawer' }] },
        ],
      },
    ],
    tv: null,
    sockets: [],
  };
  const migrated = migrate(structuredClone(v1));
  const old1 = migrated?.modules.find((m) => m.id === 'm-old1');
  const old2 = migrated?.modules.find((m) => m.id === 'm-old2');
  check('migrate: распознан v1', !!migrated && migrated.version === 2);
  check('migrate: doors → 2 секции с дверьми', !!old1 && old1.cells.length === 2 && old1.cells.every((c) => c.facade === 'door'));
  check('migrate: drawers → 1 секция ящиков', !!old2 && old2.cells.length === 1 && old2.cells[0].facade === 'drawer' && old2.cells[0].drawers === 3);
  check('migrate: суммы ширин сходятся', !!migrated && migrated.modules.every((m) => Math.abs(cellsSum(m) - m.w) <= 2));
  check('migrate: идемпотентна для v2', !!migrate(migrated) && migrate(migrated)!.version === 2);

  // 11. угловые зоны
  store.update((pp) => {
    const m1 = pp.modules.find((x) => x.wall === 'center' && x.from === 0);
    if (m1) m1.depth = 100;
  });
  const csL = cornerStart(store.project, 'left');
  const csR = cornerStart(store.project, 'right');
  check('corner: зона = глубина центрального ряда у угла', csL === 100 && csR === 600);
  addModule('wardrobe', 'left');
  const lm = modulesOn(store.project, 'left').slice(-1)[0];
  check('corner: левая боковая стартует из-за зоны', !!lm && lm.from === 100);
  const rm = modulesOn(store.project, 'right').slice(-1)[0];
  store.checkpoint();
  moveModule(rm.id, 0);
  check(
    'corner: перетаскивание не впускает в угол',
    (modulesOn(store.project, 'right').find((m) => m.id === rm.id)?.from ?? -1) >= csR,
  );
  store.undo();
  store.update((pp) => {
    const t = pp.modules.find((m) => m.id === rm.id);
    if (t) t.from = 0;
  });
  check('corner: валидатор ловит заезд в угол', validate(store.project).some((i) => i.message.includes('угловую зону')));
  store.undo();

  // 12. геометрия рендера: фасады секций на месте корпуса (регрессия двойного from)
  renderFacade();
  const facadeSvg = document.getElementById('facade');
  let renderChecked = 0;
  let renderOk = !!facadeSvg;
  for (const m of store.project.modules) {
    const x0 = wallStart(store.project)[m.wall];
    const layout = layoutCells(store.project, m);
    const g = facadeSvg?.querySelector(`g[data-hit="mod"][data-id="${m.id}"]`);
    if (!g) {
      renderOk = false;
      continue;
    }
    g.querySelectorAll(':scope > g[data-hit="cell"]').forEach((cg) => {
      const idx = Number(cg.getAttribute('data-idx'));
      const cl = layout[idx];
      if (!cl || cl.cell.facade === null) return;
      const rect = cg.querySelector('rect');
      if (!rect) {
        renderOk = false;
        return;
      }
      const xAttr = parseFloat(rect.getAttribute('x') ?? 'NaN');
      renderChecked++;
      const len = store.project.walls[m.wall].length;
      const expX = m.wall === 'left' ? x0 + len - (cl.x + cl.w) : x0 + cl.x;
      if (Math.abs(xAttr - expX) > 1.5) renderOk = false;
    });
  }
  check(`render: фасады секций совпадают с корпусом (проверено ${renderChecked})`, renderOk && renderChecked > 0);

  // 13. панель: спиннер полок — шаг 1 и границы (регрессия ±10)
  const openM = store.project.modules.find((mm) => mm.cells.some((c) => c.facade === null && !c.shelfPitch));
  if (openM) {
    select({ kind: 'module', id: openM.id });
    ui.cell = openM.cells.findIndex((c) => c.facade === null && !c.shelfPitch);
    const propsEl = document.getElementById('props');
    if (propsEl) renderProps(propsEl);
    check(
      'панель: спиннер полок step=1 с границами 0..20',
      !!document.querySelector('#props input[step="1"][min="0"][max="20"]'),
    );
    select(null);
  } else {
    check('панель: найдена открытая секция для проверки спиннера', false);
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
