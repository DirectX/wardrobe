import './style.css';
import { store } from './store.ts';
import { onRender, renderAll, select, ui } from './state.ts';
import { attachFacade, fitFacade, renderFacade } from './views/facade.ts';
import { attachPlan, renderPlan } from './views/plan.ts';
import {
  initToolbar,
  renderLibrary,
  renderProps,
  renderStatus,
} from './panels.ts';
import { deleteSelected } from './edit.ts';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no #${id}`);
  return el;
};

onRender(() => renderFacade());
onRender(() => renderPlan());
onRender(() => {
  if (!ui.editing) initToolbar($('toolbar'));
  renderLibrary($('library'));
  renderProps($('props'));
  renderStatus($('status'));
});

attachFacade($('facade') as unknown as SVGSVGElement);
attachPlan($('plan') as unknown as SVGSVGElement);

store.subscribe(renderAll);

initToolbar($('toolbar'));
renderLibrary($('library'));
renderProps($('props'));
renderStatus($('status'));
requestAnimationFrame(() => {
  fitFacade();
  renderAll();
});

window.addEventListener('resize', () => renderAll());

window.addEventListener('keydown', (e) => {  const t = e.target as HTMLElement | null;
  const typing =
    t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) {
    e.preventDefault();
    store.redo();
    return;
  }
  if (typing) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelected();
  } else if (e.key === 'Escape') {
    select(null);
    renderAll();
  } else if (e.key.toLowerCase() === 'f' || e.key === 'в') {
    fitFacade();
  }
});

// программный прогон для headless-регрессии: /?autotest
if (new URLSearchParams(location.search).has('autotest')) {
  import('./autotest.ts').then((m) => m.runAutoTest());
}
