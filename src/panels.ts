import { store } from './store.ts';
import { select, ui, renderAll } from './state.ts';
import {
  addCell,
  addModule,
  deleteSelected,
  duplicateModule,
  makeNicheUnderTv,
  removeCell,
  setCellWidth,
  setModuleKind,
  splitCell,
} from './edit.ts';
import {
  FACADE_FILLS,
  FACADE_LABEL,
  KIND_LABEL,
  WALL_LABEL,
  defaultProject,
} from './defaults.ts';
import { WALLS, cellsSum, shelfCount } from './geometry.ts';
import { validate } from './validate.ts';
import { fitFacade } from './views/facade.ts';
import { openJson, exportPng, saveJson } from './io.ts';
import type { Cell, FacadeKind, ModuleKind, Project, SocketSpec, TvSpec, WallId, WardModule } from './types.ts';

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

/** Числовое поле, допускающее пустое значение (пусто = null). */
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
  );
}

// ------------------------------------------------------------------ library

export function renderLibrary(root: HTMLElement): void {
  root.innerHTML = '';
  const kinds = Object.keys(KIND_LABEL) as ModuleKind[];
  const seg = h('div', { class: 'seg' });
  for (const w of WALLS) {
    const b = btn(WALL_SHORT[w], () => {
      ui.wall = w;
      renderAll();
    }, WALL_LABEL[w]);
    if (ui.wall === w) b.classList.add('active');
    seg.append(b);
  }
  root.append(h('h3', {}, 'Модули'), h('div', { class: 'hint' }, 'Добавить на стену:'), seg);
  for (const k of kinds) {
    root.append(btn(KIND_LABEL[k], () => addModule(k, ui.wall), `На стену: ${WALL_LABEL[ui.wall]}`));
  }
  root.append(
    h(
      'div',
      { class: 'hint pad-top' },
      'Клик по секции — выбрать; жёлтые ручки — делить ширину между секциями; двойной клик по секции — вкл/выкл фасад; двойной клик по стене — шкаф в этом месте.',
    ),
  );
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
        `Стен: 3 · Модулей: ${p.modules.length} · Розеток: ${p.sockets.length}`,
        h('br'),
        h('br'),
        'Кликните модуль, ТВ или розетку. Перетаскивание — перемещение, синие ручки — ширина модуля, жёлтые — границы секций.',
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
        btn('Ниша под ТВ', () => makeNicheUnderTv(), 'Освободить место и сделать открытую секцию'),
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
  root.append(h('h4', {}, KIND_LABEL[m.kind]));

  const patch = (fn: (mm: WardModule) => void) =>
    store.update((pp) => {
      const t = pp.modules.find((x) => x.id === m.id);
      if (t) fn(t);
    });
  const setCell = (idx: number, fn: (cell: Cell) => void) =>
    store.update((pp) => {
      const t = pp.modules.find((x) => x.id === m.id);
      const c = t?.cells[idx];
      if (c) fn(c);
    });

  root.append(
    fieldSelect(
      'Стена',
      m.wall,
      WALLS.map((w): [string, string] => [w, WALL_LABEL[w]]),
      (v) =>
        patch((t) => {
          t.wall = v as WallId;
          t.from = Math.min(t.from, p.walls[v as WallId].length - t.w);
        }),
    ),
    fieldSelect(
      'Тип',
      m.kind,
      (Object.keys(KIND_LABEL) as ModuleKind[]).map((k): [string, string] => [k, KIND_LABEL[k]]),
      (v) => setModuleKind(m.id, v as ModuleKind),
    ),
    fieldNum('Отступ, мм', m.from, (v) => patch((t) => (t.from = Math.max(0, v)))),
    fieldNum('Ширина, мм', m.w, (v) => {
      const w = Math.max(200, v);
      patch((t) => {
        t.w = w;
        for (const c of t.cells) c.w = Math.round(w / t.cells.length);
        const drift = w - cellsSum(t);
        t.cells[t.cells.length - 1].w += drift;
      });
    }),
    fieldNum('Высота, мм', m.h, (v) => patch((t) => (t.h = Math.max(200, Math.min(p.ceiling, v))))),
    fieldNum('Глубина, мм', m.depth, (v) => patch((t) => (t.depth = Math.max(150, v)))),
    h(
      'div',
      { class: 'row' },
      btn('↑ Под потолок', () => patch((t) => (t.h = p.ceiling))),
      btn('⧉ Дублировать', () => duplicateModule(m.id)),
      btn('✕ Удалить', () => deleteSelected()),
    ),
  );

  root.append(h('h4', {}, `Секции (${m.cells.length})`));
  m.cells.forEach((cell, idx) => {
    const box = h('div', { class: 'facade-row' + (ui.cell === idx ? ' sel' : '') });
    box.addEventListener('click', () => {
      ui.cell = idx;
      renderAll();
    });
    const open = cell.facade === null;
    box.append(
      h(
        'span',
        { class: 'row-label' },
        `Секция ${idx + 1} · ${open ? 'открытая' : FACADE_LABEL[cell.facade as FacadeKind]}${
          open ? `, полок: ${shelfCount(m, p, cell)}` : ''
        }`,
      ),
      fieldNum('ширина', cell.w, (v) => setCellWidth(m.id, idx, v)),
      fieldSelect(
        'фасад',
        cell.facade ?? 'none',
        [
          ['none', 'нет'],
          ...(Object.keys(FACADE_LABEL) as FacadeKind[]).map(
            (k): [string, string] => [k, FACADE_LABEL[k]],
          ),
        ],
        (v) => setCell(idx, (c) => (c.facade = v === 'none' ? null : (v as FacadeKind))),
      ),
    );
    if (cell.facade === 'door') {
      box.append(
        fieldSelect(
          'петля',
          cell.hinge,
          [
            ['left', 'Лев.'],
            ['right', 'Прав.'],
          ],
          (v) => setCell(idx, (c) => (c.hinge = v as 'left' | 'right')),
        ),
      );
    }
    if (cell.facade === 'drawer') {
      box.append(
        fieldNum('ящиков', cell.drawers, (v) =>
          setCell(idx, (c) => (c.drawers = Math.max(1, Math.min(12, Math.round(v))))),
        ),
      );
    }
    if (cell.facade === null) {
      if (cell.shelfPitch) {
        box.append(
          fieldNumOpt(
            'полка, мм',
            cell.shelfPitch,
            '—',
            (v) => setCell(idx, (c) => (c.shelfPitch = v && v > 0 ? v : null)),
            { class: 'tiny' },
          ),
        );
      } else {
        box.append(
          fieldNum('полок', shelfCount(m, p, cell), (v) =>
            setCell(idx, (c) => {
              c.shelves = Math.max(0, Math.min(20, Math.round(v)));
              c.shelfPitch = null;
            }),
          ),
        );
        box.append(
          fieldNumOpt(
            'полка, мм',
            null,
            'по высоте',
            (v) => setCell(idx, (c) => (c.shelfPitch = v && v > 0 ? v : null)),
            { class: 'tiny' },
          ),
        );
      }
    }
    box.append(
      fieldSelect(
        'цвет',
        cell.fill ?? '',
        [['', '—'], ...Object.keys(FACADE_FILLS).map((k): [string, string] => [k, k])],
        (v) => setCell(idx, (c) => (c.fill = v || undefined)),
      ),
      btn('⇄', () => splitCell(m.id, idx), 'Разделить пополам'),
      btn('✕', () => removeCell(m.id, idx), 'Удалить секцию (ширина соседу)'),
    );
    root.append(box);
  });
  root.append(
    h(
      'div',
      { class: 'row' },
      btn('+ секция', () => addCell(m.id), 'Добавить, разделив самую широкую'),
      h(
        'span',
        { class: cellsSum(m) === m.w ? 'hint' : 'issue error' },
        `Σ ${cellsSum(m)} / ${m.w} мм`,
      ),
    ),
  );
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
        '✓ замечаний нет · клик по секции — выбрать, жёлтые ручки — ширины секций, двойной клик по секции — фасад вкл/выкл',
      ),
    );
    return;
  }
  const counts = { error: 0, warn: 0 };
  for (const i of issues) counts[i.level]++;
  root.append(
    h('span', { class: 'counts' }, `⚠ ошибок: ${counts.error}, предупреждений: ${counts.warn}`),
  );
  for (const i of issues) {
    const id = i.refs[0];
    const kind = refToSelection(id);
    const span = h(
      'span',
      { class: `issue ${i.level}` },
      `${i.level === 'error' ? '⛔' : '⚠'} ${i.message}`,
    );
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
