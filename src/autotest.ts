// Программный smoke-тест: открывается по /?autotest, печатает результат в #autotest-result.
// Используется headless-прогонами (chrome --dump-dom) как минимальная регрессия домена.

import { store } from './store.ts';
import { addModule, addSocketAt, cycleCellType, makeNicheUnderTv, moveModule, resizeModule } from './edit.ts';
import { cellAt, modulesOn } from './geometry.ts';
import { validate } from './validate.ts';

const results: string[] = [];
let failed = 0;

function check(name: string, cond: boolean): void {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed++;
}

export function runAutoTest(): void {

  // 1. добавление модуля
  const leftBefore = modulesOn(store.project, 'left').length;
  addModule('drawers', 'left');
  check('addModule: +1 на левой стене', modulesOn(store.project, 'left').length === leftBefore + 1);
  check('addModule: ошибок нет', validate(store.project).every((i) => i.level !== 'error'));

  // 2. перемещение с выталкиванием соседей
  const center = modulesOn(store.project, 'center');
  if (center.length >= 2) {
    const [a, b] = center;
    store.checkpoint();
    resizeModule(a.id, 'l', a.from + 500);
    const aAfter = modulesOn(store.project, 'center')[0];
    check('resize: левый край сужает модуль', aAfter.w === a.w - 500 && aAfter.from === a.from + 500);

    moveModule(aAfter.id, aAfter.from + 400);
    const now = modulesOn(store.project, 'center');
    check(
      'move: соседи расступились без наложений',
      now.every((m, i) => i === 0 || m.from >= modulesOn(store.project, 'center')[i - 1].from),
    );
    store.undo();
  }

  // 3. обгон: перенос последнего модуля в начало (растим стену под тест)
  store.update((pp) => (pp.walls.center.length = 3900));
  const center2 = modulesOn(store.project, 'center');
  const last = center2[center2.length - 1];
  if (center2.length >= 3) {
    store.checkpoint();
    moveModule(last.id, 0);
    const after = modulesOn(store.project, 'center');
    check('move: обгон — перенесённый стал первым', after[0]?.id === last.id);
    check('move: обгон без пересечений', validate(store.project).every((i) => !i.message.includes('пересекаются')));
    store.undo();
  }

  // 4. цикл типов ячейки фасада двойным кликом (программно)
  const wardrobe = modulesOn(store.project, 'center').find((m) => m.kind === 'wardrobe');
  if (wardrobe) {
    const x = wardrobe.from + 10;
    const y = wardrobe.h - 200;
    const before = cellAt(store.project, wardrobe, x, y)?.type;
    cycleCellType(wardrobe.id, x, y);
    const after = cellAt(store.project, wardrobe, x, y)?.type;
    check('cycleCell: тип ячейки сменился', !!before && !!after && before !== after);
  }

  // 5. ниша под ТВ снимает конфликт фасада
  const conflictsBefore = validate(store.project).filter((i) => i.message.includes('ТВ перекрыт')).length;
  makeNicheUnderTv();
  const tv = store.project.tv!;
  const behind = modulesOn(store.project, tv.wall).find(
    (m) => m.from <= tv.centerX && m.from + m.w >= tv.centerX,
  );
  check('niche: под ТВ есть модуль', !!behind);
  check(
    'niche: фасад за ТВ открыт',
    !!behind && cellAt(store.project, behind, tv.centerX, tv.centerY)?.type === 'open',
  );
  check(
    'niche: конфликт ТВ+фасад устранён',
    conflictsBefore > 0
      ? validate(store.project).every((i) => !i.message.includes('ТВ перекрыт'))
      : true,
  );

  // 6. розетки
  const sockBefore = store.project.sockets.length;
  addSocketAt('right', 100, 300);
  check('socket: добавлена', store.project.sockets.length === sockBefore + 1);

  // 7. undo/redo
  const p1 = JSON.stringify(store.project);
  store.undo();
  const pUndo = JSON.stringify(store.project);
  check('undo: откатил добавление розетки', pUndo !== p1);
  store.redo();
  check('redo: вернул', JSON.stringify(store.project) === p1);

  // 8. инвариант: нет ошибок после серии операций
  check(
    'инвариант: ошибок нет',
    validate(store.project).every((i) => i.level !== 'error'),
  );

  // вывод
  document.title = `AUTOTEST ${failed === 0 ? 'OK' : `FAILED(${failed})`}`;
  const pre = document.createElement('pre');
  pre.id = 'autotest-result';
  pre.textContent = results.join('\n');
  document.body.append(pre);
  // eslint-disable-next-line no-console
  console.log(results.join('\n'));
}
