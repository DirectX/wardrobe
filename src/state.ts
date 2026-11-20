import type { WallId } from './types.ts';

export interface Selection {
  kind: 'module' | 'tv' | 'socket';
  id: string;
}

export const ui = {
  sel: null as Selection | null,
  /** активная стена для кнопок библиотеки */
  wall: 'center' as WallId,
  message: '',
  editing: false,
};

/** Камера фасадного вида: zoom — px на мм. */
export const facadeView = { zoom: 0.2, cx: 2000, cy: 1300 };

/** План всегда авто-вписывается; храним только флаг. */
export const planView = { auto: true };

export function select(sel: Selection | null): void {
  ui.sel = sel;
}

export function sameSel(a: Selection | null, b: Selection | null): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.id === b.id;
}

// --- шина перерисовки: панели и вьюхи регистрируются, любая логика вызывает renderAll() ---
const channels = new Set<() => void>();

export function onRender(fn: () => void): void {
  channels.add(fn);
}

export function renderAll(): void {
  for (const fn of channels) fn();
}
