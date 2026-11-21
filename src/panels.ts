import { store } from './store.ts';
import { select, ui, renderAll } from './state.ts';
import {
  addModule,
  deleteSelected,
  duplicateModule,
  makeNicheUnderTv,
  removeNode,
  setDividerT,
  setFace,
  setFaceGroup,
  setModuleBox,
  setSharedWall,
  setSplitDir,
  setSplitT,
  splitLeaf,
  toggleFace,
} from './edit.ts';
import { FACADE_FILLS, FACE_LABEL, WALL_LABEL, defaultProject } from './defaults.ts';
import { WALLS, cornerZones, countLeaves, layoutModule, nodeBoxes } from './geometry.ts';
import { getNode, pathEq } from './types.ts';
import { validate } from './validate.ts';
import { fitFacade } from './views/facade.ts';
import { openJson, exportPng, saveJson } from './io.ts';
import { openPrintReport } from './print.ts';
import type {
  BoxNode,
  LeafDrawers,
  LeafFace,
  LeafOpen,
  Path,
  Project,
  SocketSpec,
  TvSpec,
  WallId,
  WardModule,
} from './types.ts';

// ------------------------------------------------------------------ helpers

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | undefined> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === 'class') el.className = String(v);
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids) el.append(kid);
  return el;
}

function btn(label: string, onclick: () => void, title?: string): HTMLButtonElement {
  const b = h('button', { title: title ?? label }, label);
  b.addEventListener('click', onclick);
  return b;
}

function guardInput(el: HTMLElement): void {
  el.addEventListener('focusin', () => (ui.editing = true));
  el.addEventListener('focusout', () => (ui.editing = false));
}

function fieldNum(
  label: string,
  value: number,
  onCommit: (v: number) => void,
  extra: Record<string, string | number | undefined> = {},
): HTMLElement {
  const input = h('input', { type: 'number', value: String(value), step: '10', ...extra });
  guardInput(input);
  input.addEventListener('change', () => {
    const v = Number(input.valueAsNumber);
    if (Number.isFinite(v)) onCommit(v);
  });
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function fieldNumOpt(
  label: string,
  value: number | null,
  placeholder: string,
  onCommit: (v: number | null) => void,
  extra: Record<string, string | number | undefined> = {},
): HTMLElement {
  const input = h('input', {
    type: 'number',
    value: value === null ? '' : String(value),
    step: '10',
    placeholder,
    ...extra,
  });
  guardInput(input);
  input.addEventListener('change', () => {
    if (input.value === '') onCommit(null);
    else {
      const v = Number(input.valueAsNumber);
      if (Number.isFinite(v)) onCommit(v);
    }
  });
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function fieldSelect(
  label: string,
  value: string,
  options: [string, string][],
  onCommit: (v: string) => void,
): HTMLElement {
  const sel = h('select');
  for (const [v, text] of options) {
    const o = h('option', { value: v }, text);
    if (v === value) o.selected = true;
    if (FACADE_FILLS[v]) o.style.background = FACADE_FILLS[v];
    sel.append(o);
  }
  guardInput(sel);
  sel.addEventListener('change', () => onCommit(sel.value));
  return h('label', { class: 'field' }, h('span', {}, label), sel);
}

const WALL_SHORT: Record<WallId, string> = { left: 'Л', center: 'Ц', right: 'П' };

// ------------------------------------------------------------------ toolbar

export function initToolbar(root: HTMLElement): void {
  root.innerHTML = '';
  const p = store.project;

  const name = h('input', { class: 'name', type: 'text', value: p.name });
  guardInput(name);
  name.addEventListener('change', () => store.update((pp) => (pp.name = name.value || 'Без имени')));

  const lenFields = WALLS.map((w) =>
    fieldNum(
      WALL_SHORT[w],
      p.walls[w].length,
      (v) => {
        store.update((pp) => (pp.walls[w].length = Math.min(12000, Math.max(300, v))));
        fitFacade();
      },
      { min: 300, max: 12000, title: `Длина: ${WALL_LABEL[w]}` },
    ),
  );

  const ceilingF = fieldNum(
    'Потолок',
    p.ceiling,
    (v) => {
      store.update((pp) => (pp.ceiling = Math.min(5000, Math.max(2000, v))));
      fitFacade();
    },
    { min: 2000, max: 5000, title: 'Высота потолка' },
  );
  const baseF = fieldNum('Цколь', p.base, (v) => store.update((pp) => (pp.base = Math.max(0, v))), {
    min: 0,
    max: 300,
    title: 'Высота плинтуса (цоколя)',
  });
  const gridF = fieldSelect(
    'Сетка',
    String(p.grid),
    [
      ['25', '25'],
      ['50', '50'],
      ['100', '100'],
    ],
    (v) => store.update((pp) => (pp.grid = Number(v))),
  );

  root.append(
    h('span', { class: 'logo' }, '🗄 Wardrobe'),
    name,
    h('span', { class: 'sep' }),
    ...lenFields,
    ceilingF,
    baseF,
    gridF,
    h('span', { class: 'sep' }),
    btn('Новый', () => {
      if (confirm('Начать новый проект? Текущий будет в истории (Ctrl+Z).')) {
        const empty = defaultProject();
        empty.modules = [];
        empty.tv = null;
        empty.sockets = [];
        empty.name = 'Новый проект';
        store.replace(empty);
        fitFacade();
      }
    }),
    btn('↶', () => store.undo(), 'Отменить (Ctrl+Z)'),
    btn('↷', () => store.redo(), 'Повторить (Ctrl+Shift+Z)'),
    btn('⤢', () => fitFacade(), 'Вписать в экран (F)'),
    h('span', { class: 'sep' }),
    btn(store.project.tv ? '− ТВ' : '+ ТВ', () => {
      if (store.project.tv) {
        store.update((pp) => (pp.tv = null));
      } else {
        store.update(
          (pp) =>
            (pp.tv = {
              wall: 'center',
              centerX: Math.round(pp.walls.center.length / 2),
              centerY: 1150,
              w: 1240,
              h: 720,
            }),
        );
        select({ kind: 'tv', id: 'tv' });
        renderAll();
      }
    }, 'Добавить/убрать телевизор'),
    btn('+ Розетка', () => {
      const p2 = store.project;
      store.update((pp) =>
        pp.sockets.push({
          id: `s-${Math.random().toString(36).slice(2, 8)}`,
          wall: ui.wall,
          x: Math.round(p2.walls[ui.wall].length / 2),
          y: 300,
        }),
      );
    }, 'Розетка на активной стене'),
    h('span', { class: 'sep grow' }),
    btn('💾 JSON', () => saveJson(), 'Скачать проект'),
    btn('📂 Открыть', () => openJson(), 'Загрузить проект из JSON'),
    btn('🖼 PNG', () => void exportPng(), 'Сохранить фасад картинкой'),
    btn('🖨 PDF', () => openPrintReport(), 'Печатный отчёт: чертёж с размерами + спецификация → Сохранить как PDF'),
  );
}

// ------------------------------------------------------------------ library

export function renderLibrary(root: HTMLElement): void {
  root.innerHTML = '';
  const seg = h('div', { class: 'seg' });
  for (const w of WALLS) {
    const b = btn(WALL_SHORT[w], () => {
      ui.wall = w;
      renderAll();
    }, WALL_LABEL[w]);
    if (ui.wall === w) b.classList.add('active');
    seg.append(b);
  }
  root.append(
    h('h3', {}, 'Стенка'),
    h('div', { class: 'hint' }, 'Поставить на стену:'),
    seg,
    btn('+ Новый модуль', () => addModule(ui.wall), 'Новый модуль (контейнер) на активной стене'),
    h(
      'div',
      { class: 'hint pad-top' },
      'Двойной клик по стене — контейнер в этом месте. Клик по отсеку или строке дерева справа — выбрать узел.',
    ),
  );

  // контекстные инструменты нарезки выбранного узла
  const sel = ui.sel;
  const p = store.project;
  if (sel?.kind === 'module') {
    const m = p.modules.find((x) => x.id === sel.id);
    const path = ui.path;
    if (m && path) {
      const node = getNode(m.root, path);
      const boxes = nodeBoxes(p, m);
      const bb = boxes.get(path.join('.'));
      if (node && bb) {
        const isLeaf = node.type === 'leaf';
        root.append(
          h('div', { class: 'ctx-toolbar' },
            h('h3', {}, `Нарезка · ${Math.round(bb.w)}×${Math.round(bb.h)} мм`),
            h('div', { class: 'hint' }, isLeaf ? 'Разделить выбранный отсек:' : 'Выбрана секция — режьте её отсеки:'),
            h('div', { class: 'row' },
              (() => {
                const b = btn('⊢ Вертикально', () => splitLeaf(m.id, path, 'v'), 'Разделить вертикальной перегородкой пополам');
                if (!isLeaf) b.disabled = true;
                return b;
              })(),
              (() => {
                const b = btn('⊤ Горизонтально', () => splitLeaf(m.id, path, 'h'), 'Разделить горизонтальной перегородкой (полка) пополам');
                if (!isLeaf) b.disabled = true;
                return b;
              })(),
            ),
            h('div', { class: 'row' },
              btn('✕ Убрать узел', () => removeNode(m.id, path), 'Удалить отсек/секцию — размер уходит соседу'),
            ),
            h('div', { class: 'hint' }, 'Свойства лица (ниша/дверца/ящики) — в правой панели.'),
          ),
        );
      }
    }
  }
}

// ------------------------------------------------------------------ props

export function renderProps(root: HTMLElement): void {
  if (ui.editing) return;
  root.innerHTML = '';
  root.append(h('h3', {}, 'Свойства'));
  const p = store.project;
  const sel = ui.sel;

  if (!sel) {
    root.append(
      h(
        'div',
        { class: 'hint' },
        `Стен: 3 · Контейнеров: ${p.modules.length} · Розеток: ${p.sockets.length}`,
        h('br'),
        h('br'),
        'Поставьте «Новый модуль» на стену, затем кликайте отсеки и режьте их: перегородки, ниши, ящики, дверцы.',
      ),
    );
    return;
  }

  if (sel.kind === 'module') {
    renderModuleProps(root, p, sel.id);
    return;
  }

  if (sel.kind === 'tv' && p.tv) {
    const t = p.tv;
    root.append(h('h4', {}, 'Телевизор'));
    const patch = (fn: (tt: TvSpec) => void) =>
      store.update((pp) => {
        if (pp.tv) fn(pp.tv);
      });
    root.append(
      fieldSelect(
        'Стена',
        t.wall,
        WALLS.map((w): [string, string] => [w, WALL_LABEL[w]]),
        (v) => patch((tt) => (tt.wall = v as WallId)),
      ),
      fieldNum('Центр X, мм', t.centerX, (v) => patch((tt) => (tt.centerX = v))),
      fieldNum('Центр Y, мм', t.centerY, (v) => patch((tt) => (tt.centerY = v))),
      fieldNum('Ширина, мм', t.w, (v) => patch((tt) => (tt.w = Math.max(300, v)))),
      fieldNum('Высота, мм', t.h, (v) => patch((tt) => (tt.h = Math.max(200, v)))),
      h(
        'div',
        { class: 'row' },
        btn('Ниша под ТВ', () => makeNicheUnderTv(), 'Вырезать контейнер с открытым отсеком'),
        btn('✕ Убрать ТВ', () => deleteSelected()),
      ),
    );
    return;
  }

  if (sel.kind === 'socket') {
    const s = p.sockets.find((x) => x.id === sel.id);
    if (!s) return;
    root.append(h('h4', {}, 'Розетка'));
    const patch = (fn: (ss: SocketSpec) => void) =>
      store.update((pp) => {
        const t = pp.sockets.find((x) => x.id === s.id);
        if (t) fn(t);
      });
    root.append(
      fieldSelect(
        'Стена',
        s.wall,
        WALLS.map((w): [string, string] => [w, WALL_LABEL[w]]),
        (v) => patch((ss) => (ss.wall = v as WallId)),
      ),
      fieldNum('От угла, мм', s.x, (v) => patch((ss) => (ss.x = Math.max(0, v)))),
      fieldNum('Высота, мм', s.y, (v) => patch((ss) => (ss.y = Math.max(0, v)))),
      btn('✕ Удалить', () => deleteSelected()),
    );
  }
}

function renderModuleProps(root: HTMLElement, p: Project, id: string): void {
  const m = p.modules.find((x) => x.id === id);
  if (!m) return;
  root.append(h('h4', {}, 'Контейнер'));

  const patch = (fn: (mm: WardModule) => void) =>
    store.update((pp) => {
      const t = pp.modules.find((x) => x.id === m.id);
      if (t) fn(t);
    });

  const z = cornerZones(p, m.wall);
  root.append(
    fieldSelect(
      'Стена',
      m.wall,
      WALLS.map((w): [string, string] => [w, WALL_LABEL[w]]),
      (v) =>
        patch((t) => {
          t.wall = v as WallId;
          t.from = Math.max(cornerZones(p, v as WallId).start, Math.min(t.from, p.walls[v as WallId].length - t.w - cornerZones(p, v as WallId).end));
        }),
    ),
    fieldNum('Отступ, мм', m.from, (v) => patch((t) => (t.from = Math.max(z.start, v)))),
    fieldNum('Ширина, мм', m.w, (v) => setModuleBox(m.id, { w: Math.max(200, v) })),
    fieldNum('Высота, мм', m.h, (v) => setModuleBox(m.id, { h: Math.max(200, Math.min(p.ceiling, v)) })),
    fieldNum('Глубина, мм', m.depth, (v) => setModuleBox(m.id, { depth: Math.max(150, v) })),
    h(
      'div',
      { class: 'row' },
      btn('↑ Под потолок', () => setModuleBox(m.id, { h: p.ceiling })),
      btn('⧉ Дублировать', () => duplicateModule(m.id)),
      btn('✕ Удалить', () => deleteSelected()),
    ),
  );

  // общие стенки
  const chk = (label: string, checked: boolean, onchange: (v: boolean) => void) => {
    const id = `chk-${label}-${m.id}`;
    const input = h('input', { type: 'checkbox', id, checked: checked ? 'checked' : undefined });
    if (checked) input.checked = true;
    guardInput(input);
    input.addEventListener('change', () => onchange(input.checked));
    return h('label', { class: 'chk', for: id }, input, h('span', {}, label));
  };
  root.append(
    h(
      'div',
      { class: 'row' },
      chk('лев. стенка общая', m.leftShared, (v) => setSharedWall(m.id, 'l', v)),
      chk('прав. стенка общая', m.rightShared, (v) => setSharedWall(m.id, 'r', v)),
    ),
    h('div', { class: 'hint' }, 'Общая = одна панель 18 мм на стыке соседей (9 мм на каждый модуль). Включается автоматически при установке вплотную.'),
  );
  if (z.start > 0 || z.end > 0) {
    root.append(
      h('div', { class: 'hint' }, `Углы стены заняты: ${z.start} слева, ${z.end} справа (глубина смежного ряда).`),
    );
  }

  // ------------------------------------------------- дерево структуры
  root.append(h('h4', {}, `Структура · отсеков: ${countLeaves(m.root)}`));
  const boxes = nodeBoxes(p, m);
  const tree = h('div', { class: 'tree' });
  const selPath = ui.path;
  const renderNode = (node: BoxNode, path: Path, depth: number) => {
    const bb = boxes.get(path.join('.'));
    const sizeStr = bb ? ` · ${Math.round(bb.w)}×${Math.round(bb.h)}` : '';
    const label =
      node.type === 'split'
        ? `${node.dir === 'v' ? '⊢ Секция' : '⊤ Секция'} ${path.join('.') || '·'} (${node.children.length}${sizeStr})`
        : `— ${FACE_LABEL[node.face.kind]}${sizeStr}`;
    const row = h('div', { class: 'tree-row', style: `padding-left:${depth * 12}px` }, label);
    if (selPath && pathEq(selPath, path)) row.classList.add('sel');
    row.addEventListener('click', () => {
      select({ kind: 'module', id: m.id }, path);
      renderAll();
    });
    tree.append(row);
    if (node.type === 'split') {
      node.children.forEach((c, i) => renderNode(c.node, [...path, i], depth + 1));
    }
  };
  renderNode(m.root, [], 0);
  root.append(tree);

  // ------------------------------------------------- свойства выбранного узла
  const path = ui.path;
  const node = path ? getNode(m.root, path) : null;
  if (!path || !node) {
    root.append(h('div', { class: 'hint' }, 'Выберите узел в дереве или на чертеже.'));
    return;
  }

  if (node.type === 'split') {
    renderSplitProps(root, p, m, path, node);
    return;
  }
  renderLeafProps(root, p, m, path, node);
}

function renderSplitProps(
  root: HTMLElement,
  p: Project,
  m: WardModule,
  path: Path,
  node: BoxNode & { type: 'split' },
): void {
  root.append(h('h4', {}, `Секция ${path.join('.') || '·'}`));
  const boxes = nodeBoxes(p, m);
  const bb = boxes.get(path.join('.'));
  root.append(
    h('div', { class: 'hint' }, `${node.dir === 'v' ? 'Вертикальная' : 'Горизонтальная'} нарезка · ${node.children.length} дет. · ${bb ? `${Math.round(bb.w)}×${Math.round(bb.h)} мм` : ''}`),
    fieldNum(
      'перегородка, мм',
      node.t,
      (v) => setSplitT(m.id, path, v),
      { step: '2', min: 0, max: 60, title: 'Толщина всех перегородок секции' },
    ),
    h(
      'div',
      { class: 'row' },
      btn('⇄ Повернуть нарезку', () => setSplitDir(m.id, path), 'Вертикальная ↔ горизонтальная'),
      path.length > 0 ? btn('↑ Наверх', () => {
        select({ kind: 'module', id: m.id }, path.slice(0, -1));
        renderAll();
      }, 'Выбрать родительский узел') : h('span'),
    ),
  );

  // массовые операции над всеми листьями секции
  root.append(h('div', { class: 'hint' }, 'Лицо всех отсеков секции:'));
  root.append(
    h(
      'div',
      { class: 'row' },
      ...(['open', 'door', 'drawers', 'panel'] as const).map((k) =>
        btn(FACE_LABEL[k], () => {
          setFaceGroup(
            m.id,
            path,
            k === 'open'
              ? { kind: 'open', shelves: 2 }
              : k === 'door'
                ? { kind: 'door', hinge: 'left', fill: 'дуб лён' }
                : k === 'drawers'
                  ? { kind: 'drawers', drawers: 3, fill: 'дуб лён' }
                  : { kind: 'panel', fill: 'дуб лён' },
          );
          renderAll();
        }, `Сделать ${FACE_LABEL[k].toLowerCase()} во всех отсеках секции`),
      ),
    ),
  );
}

function renderLeafProps(
  root: HTMLElement,
  p: Project,
  m: WardModule,
  path: Path,
  node: BoxNode & { type: 'leaf' },
): void {
  const lb = layoutModule(p, m).leaves.find((l) => pathEq(l.path, path));
  root.append(h('h4', {}, `Отсек ${path.join('.') || '·'}`));
  if (lb) root.append(h('div', { class: 'hint' }, `${Math.round(lb.w)}×${Math.round(lb.h)} мм`));

  const patchFace = (next: LeafFace) => {
    setFace(m.id, path, next);
    renderAll();
  };
  const face = node.face;

  root.append(
    fieldSelect(
      'отсек',
      face.kind,
      (Object.keys(FACE_LABEL) as LeafFace['kind'][]).map(
        (k): [string, string] => [k, FACE_LABEL[k]],
      ),
      (v) => {
        const kind = v as LeafFace['kind'];
        if (kind === face.kind) return;
        patchFace(
          kind === 'open'
            ? { kind: 'open', shelves: 2, shelfPitch: null }
            : kind === 'door'
              ? { kind: 'door', hinge: 'left', fill: 'дуб лён' }
              : kind === 'drawers'
                ? { kind: 'drawers', drawers: 3, fill: 'дуб лён' }
                : { kind: 'panel', fill: 'дуб лён' },
        );
      },
    ),
  );

  if (face.kind === 'open') {
    const f = face;
    if (f.shelfPitch) {
      root.append(
        fieldNumOpt(
          'шаг полки',
          f.shelfPitch ?? null,
          '',
          (v) => patchFace({ kind: 'open', shelves: f.shelves, shelfPitch: v && v > 0 ? v : null }),
          { class: 'tiny' },
        ),
        btn('по числу полок', () => patchFace({ kind: 'open', shelves: Math.max(2, f.shelves), shelfPitch: null })),
      );
    } else {
      root.append(
        fieldNum(
          'полок',
          f.shelves,
          (v) => patchFace({ kind: 'open', shelves: Math.max(0, Math.min(20, Math.round(v))), shelfPitch: null }),
          { step: '1', min: 0, max: 20 },
        ),
        fieldNumOpt(
          'шаг полки',
          null,
          'мм',
          (v) => patchFace({ kind: 'open', shelves: f.shelves, shelfPitch: v && v > 0 ? v : null }),
          { class: 'tiny', title: 'Равномерные полки фиксированной высоты' },
        ),
        h(
          'div',
          { class: 'row' },
          btn('− полка', () => patchFace({ kind: 'open', shelves: Math.max(0, f.shelves - 1), shelfPitch: f.shelfPitch })),
          btn('+ полка', () => patchFace({ kind: 'open', shelves: Math.min(20, f.shelves + 1), shelfPitch: f.shelfPitch })),
        ),
      );
    }
  }
  if (face.kind === 'door') {
    root.append(
      fieldSelect(
        'петля',
        face.hinge,
        [
          ['left', 'Лев.'],
          ['right', 'Прав.'],
        ],
        (v) => patchFace({ ...face, hinge: v as 'left' | 'right' }),
      ),
      fieldSelect(
        'цвет',
        face.fill ?? '',
        [['', '—'], ...Object.keys(FACADE_FILLS).map((k): [string, string] => [k, k])],
        (v) => patchFace({ ...face, fill: v || undefined }),
      ),
      fieldSelect(
        'стекло',
        face.glass ? '1' : '0',
        [
          ['0', 'нет'],
          ['1', 'да'],
        ],
        (v) => patchFace({ ...face, glass: v === '1' || undefined }),
      ),
    );
  }
  if (face.kind === 'drawers') {
    root.append(
      fieldNum(
        'ящиков',
        face.drawers,
        (v) => patchFace({ kind: 'drawers', drawers: Math.max(1, Math.min(12, Math.round(v))), fill: face.fill }),
        { step: '1', min: 1, max: 12 },
      ),
      fieldSelect(
        'цвет',
        face.fill ?? '',
        [['', '—'], ...Object.keys(FACADE_FILLS).map((k): [string, string] => [k, k])],
        (v) => patchFace({ ...face, fill: v || undefined }),
      ),
    );
  }
  if (face.kind === 'panel') {
    root.append(
      fieldSelect(
        'цвет',
        face.fill ?? '',
        [['', '—'], ...Object.keys(FACADE_FILLS).map((k): [string, string] => [k, k])],
        (v) => patchFace({ ...face, fill: v || undefined }),
      ),
    );
  }
  root.append(
    h(
      'div',
      { class: 'row' },
      btn('⇄ Ниша/дверца', () => toggleFace(m.id, path), 'Быстрое переключение (как двойной клик)'),
      path.length > 0
        ? btn('↑ Наверх', () => {
            select({ kind: 'module', id: m.id }, path.slice(0, -1));
            renderAll();
          }, 'Выбрать родительскую секцию')
        : h('span'),
    ),
  );
  if (path.length > 0) {
    root.append(
      fieldNum(
        'перегородка рядом, мм',
        parentT(m, path),
        (v) => setDividerT(m.id, path, v),
        { step: '2', min: 0, max: 60, title: 'Толщина перегородок родительской секции' },
      ),
    );
  }
}

function parentT(m: WardModule, path: Path): number {
  let cur: BoxNode = m.root;
  for (let i = 0; i < path.length - 1; i++) {
    if (cur.type !== 'split') return 18;
    cur = cur.children[path[i]].node;
  }
  return cur.type === 'split' ? cur.t : 18;
}

// ------------------------------------------------------------------ status

function refToSelection(ref: string): 'module' | 'tv' | 'socket' | null {
  if (ref === 'tv') return 'tv';
  if (ref.startsWith('s-')) return 'socket';
  if (ref.startsWith('m-')) return 'module';
  return null;
}

export function renderStatus(root: HTMLElement): void {
  root.innerHTML = '';
  const p = store.project;
  const issues = validate(p);

  if (ui.message) {
    root.append(h('span', { class: 'msg' }, ui.message));
    ui.message = '';
    return;
  }
  if (!issues.length) {
    root.append(
      h(
        'span',
        { class: 'ok' },
        '✓ замечаний нет · клик по отсеку — выбрать · жёлтые грифы — перегородки · двойной клик по отсеку — ниша/дверца',
      ),
    );
    return;
  }
  const counts = { error: 0, warn: 0 };
  for (const i of issues) counts[i.level]++;
  root.append(h('span', { class: 'counts' }, `⚠ ошибок: ${counts.error}, предупреждений: ${counts.warn}`));
  for (const i of issues) {
    const id = i.refs[0];
    const kind = refToSelection(id);
    const span = h('span', { class: `issue ${i.level}` }, `${i.level === 'error' ? '⛔' : '⚠'} ${i.message}`);
    if (kind) {
      span.classList.add('clickable');
      span.addEventListener('click', () => {
        select({ kind, id });
        renderAll();
      });
    }
    root.append(span);
  }
}
