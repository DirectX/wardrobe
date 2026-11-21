import type { Project } from './types.ts';
import { defaultProject } from './defaults.ts';
import { migrate } from './migrate.ts';

const LS_KEY = 'wardrobe:project:v3';
const LEGACY_KEYS = ['wardrobe:project:v2', 'wardrobe:project:v1'];

type Listener = () => void;

function loadFromStorage(): Project | null {
  for (const key of [LS_KEY, ...LEGACY_KEYS]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const p = migrate(JSON.parse(raw) as unknown);
      if (p) return p;
    } catch {
      /* повреждённое сохранение — пробуем следующий ключ */
    }
  }
  return null;
}

class Store {
  project: Project;
  past: Project[] = [];
  future: Project[] = [];

  private listeners = new Set<Listener>();
  private saveTimer: number | undefined;

  constructor() {
    this.project = loadFromStorage() ?? defaultProject();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Изменить состояние. commit=false — без записи в историю (live-драг). */
  update(mutate: (p: Project) => void, commit = true): void {
    if (commit) this.checkpoint();
    mutate(this.project);
    this.touch();
  }

  /** Снимок в историю (вызывать перед live-драгом). */
  checkpoint(): void {
    this.past.push(structuredClone(this.project));
    if (this.past.length > 100) this.past.shift();
    this.future = [];
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(structuredClone(this.project));
    this.project = prev;
    this.touch();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(structuredClone(this.project));
    this.project = next;
    this.touch();
  }

  replace(p: Project): void {
    this.checkpoint();
    this.project = p;
    this.touch();
  }

  private touch(): void {
    if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(this.project));
      } catch {
        /* переполнение хранилища не критично */
      }
    }, 300);
    this.emit();
  }
}

export const store = new Store();
