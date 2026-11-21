import { store } from './store.ts';
import { select, ui, renderAll } from './state.ts';
import {
  addModule,
  deleteSelected,
  duplicateModule,
  makeNicheUnderTv,
  removeLeaf,
  setDividerT,
  setFace,
  splitLeaf,
  toggleFace,
} from './edit.ts';
import { FACADE_FILLS, FACE_LABEL, WALL_LABEL, defaultProject } from './defaults.ts';
import { WALLS, cornerZones, countLeaves, layoutModule } from './geometry.ts';
import { pathEq } from './types.ts';
import { validate } from './validate.ts';
import { fitFacade } from './views/facade.ts';
import { openJson, exportPng, saveJson } from './io.ts';
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
    btn('+ Пустой отсек', () => addModule(ui.wall), 'Контейнер на активной стене'),
    h(
      'div',
      { class: 'hint pad-top' },
      'Двойной клик по стене — контейнер в этом месте. Клик по отсеку — выбрать и открыть инструменты нарезки.',
    ),
  );

  // контекстная панель инструментов выбранного отсека
  const sel = ui.sel;
  const p = store.project;
  if (sel?.kind === 'module') {
    const m = p.modules.find((x) => x.id === sel.id);
    const path = ui.path;
    if (m && path) {
      const lb = layoutModule(p, m).leaves.find((l) => pathEq(l.path, path));
      if (lb) {
        const face = lb.leaf.face;
        root.append(
          h('div', { class: 'ctx-toolbar' },
            h('h3', {}, `Инструменты · ${Math.round(lb.w)}×${Math.round(lb.h)}`),
            h('div', { class: 'hint' }, 'Нарезка отсека:'),
            h('div', { class: 'row' },
              btn('⊢ Вертикально', () => splitLeaf(m.id, path, 'v'), 'Разделить вертикальной перегородкой пополам'),
              btn('⊤ Горизонтально', () => splitLeaf(m.id, path, 'h'), 'Разделить горизонтальной перегородкой (полка) пополам'),
            ),
            h('div', { class: 'hint' }, 'Лицо отсека:'),
            h('div', { class: 'row' },
              ...(['open', 'door', 'drawers', 'panel'] as const).map((k) => {
                const b = btn(FACE_LABEL[k], () => {
                  if (face.kind === k) return;
                  setFace(
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
                }, `Сделать отсек: ${FACE_LABEL[k]}`);
                if (face.kind === k) b.classList.add('active');
                return b;
              }),
            ),
            h('div', { class: 'row' },
              btn('⇄ Ниша/дверца', () => toggleFace(m.id, path), 'Быстрое переключение (как двойной клик)'),
              btn('✕ Убрать отсек', () => removeLeaf(m.id, path), 'Слить с соседом'),
            ),
            face.kind === 'open'
              ? h('div', { class: 'row' },
                  btn('− полка', () => setFace(m.id, path, { kind: 'open', shelves: Math.max(0, face.shelves - 1), shelfPitch: face.shelfPitch }), 'Убрать полку'),
                  btn('+ полка', () => setFace(m.id, path, { kind: 'open', shelves: Math.min(20, face.shelves + 1), shelfPitch: face.shelfPitch }), 'Добавить полку'),
                )
              : h('div'),
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
        'Поставьте «Пустой отсек» на стену, затем кликайте отсеки и режьте их: перегородки, ниши, ящики, дверцы.',
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
    fieldNum('Ширина, мм', m.w, (v) => patch((t) => (t.w = Math.max(200, v)))),
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
  if (z.start > 0 || z.end > 0) {
    root.append(
      h(
        'div',
        { class: 'hint' },
        `Углы стены заняты: ${z.start} слева, ${z.end} справа (глубина смежного ряда).`,
      ),
    );
  }

  root.append(h('h4', {}, `Нарезка · отсеков: ${countLeaves(m.root)}`));
  const path = ui.path;
  const leaf = path ? findLeafBox(p, m, path) : null;
  if (!leaf) {
    root.append(h('div', { class: 'hint' }, 'Кликните отсек на чертеже, чтобы нарезать его.'));
    return;
  }

  const setPath = (np: Path | null) => {
    select({ kind: 'module', id: m.id }, np);
    renderAll();
  };
  const box = h('div', { class: 'facade-row sel' });
  box.append(h('span', { class: 'row-label' }, `Отсек ${path!.join('·') || '—'} · ${Math.round(leaf.w)}×${Math.round(leaf.h)} мм`));

  const face = leaf.leaf.face;
  const patchFace = (next: LeafFace) => setFace(m.id, path!, next);

  box.append(
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
        renderAll();
      },
    ),
  );
  if (face.kind === 'open') {
    const f = face as LeafOpen;
    if (f.shelfPitch) {
      box.append(
        fieldNumOpt(
          'шаг полки',
          f.shelfPitch ?? null,
          '',
          (v) => {
            patchFace({ kind: 'open', shelves: f.shelves, shelfPitch: v && v > 0 ? v : null });
            renderAll();
          },
          { class: 'tiny' },
        ),
      );
    } else {
      box.append(
        fieldNum(
          'полок',
          f.shelves,
          (v) => {
            patchFace({ kind: 'open', shelves: Math.max(0, Math.min(20, Math.round(v))), shelfPitch: null });
            renderAll();
          },
          { step: '1', min: 0, max: 20 },
        ),
        fieldNumOpt(
          'шаг полки',
          null,
          'мм',
          (v) => {
            patchFace({ kind: 'open', shelves: f.shelves, shelfPitch: v && v > 0 ? v : null });
            renderAll();
          },
          { class: 'tiny' },
        ),
      );
    }
  }
  if (face.kind === 'door') {
    box.append(
      fieldSelect(
        'петля',
        face.hinge,
        [
          ['left', 'Лев.'],
          ['right', 'Прав.'],
        ],
        (v) => {
          patchFace({ ...face, hinge: v as 'left' | 'right' });
          renderAll();
        },
      ),
      fieldSelect(
        'цвет',
        face.fill ?? '',
        [['', '—'], ...Object.keys(FACADE_FILLS).map((k): [string, string] => [k, k])],
        (v) => {
          patchFace({ ...face, fill: v || undefined });
          renderAll();
        },
      ),
      fieldSelect(
        'стекло',
        face.glass ? '1' : '0',
        [
          ['0', 'нет'],
          ['1', 'да'],
        ],
        (v) => {
          patchFace({ ...face, glass: v === '1' || undefined });
          renderAll();
        },
      ),
    );
  }
  if (face.kind === 'drawers') {
    const f = face as LeafDrawers;
    box.append(
      fieldNum(
        'ящиков',
        f.drawers,
        (v) => {
          patchFace({ kind: 'drawers', drawers: Math.max(1, Math.min(12, Math.round(v))), fill: f.fill });
          renderAll();
        },
        { step: '1', min: 1, max: 12 },
      ),
      fieldSelect(
        'цвет',
        f.fill ?? '',
        [['', '—'], ...Object.keys(FACADE_FILLS).map((k): [string, string] => [k, k])],
        (v) => {
          patchFace({ ...f, fill: v || undefined });
          renderAll();
        },
      ),
    );
  }
  if (face.kind === 'panel') {
    box.append(
      fieldSelect(
        'цвет',
        face.fill ?? '',
        [['', '—'], ...Object.keys(FACADE_FILLS).map((k): [string, string] => [k, k])],
        (v) => {
          patchFace({ ...face, fill: v || undefined });
          renderAll();
        },
      ),
    );
  }
  root.append(box);

  root.append(
    h(
      'div',
      { class: 'row' },
      btn('⊢ ⟂ Разделить', () => splitLeaf(m.id, path!, 'v'), 'Вертикальная перегородка пополам'),
      btn('⊤ Разделить', () => splitLeaf(m.id, path!, 'h'), 'Горизонтальная перегородка пополам'),
      btn('✕ Убрать отсек', () => removeLeaf(m.id, path!), 'Слиться с соседом'),
    ),
  );
  if (path && path.length > 0) {
    root.append(
      fieldNum(
        'перегородка, мм',
        parentT(m, path),
        (v) => setDividerT(m.id, path, v),
        { step: '2', min: 0, max: 60 },
      ),
    );
    if (path.length > 1) {
      root.append(
        h(
          'div',
          { class: 'row' },
          btn('↑ наверх', () => setPath(path.slice(0, -1))),
        ),
      );
    }
  }
}

function findLeafBox(p: Project, m: WardModule, path: Path) {
  return layoutModule(p, m).leaves.find(
    (lb) => lb.path.length === path.length && lb.path.every((v, i) => v === path[i]),
  );
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
