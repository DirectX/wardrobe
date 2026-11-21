import { store } from './store.ts';
import { ui, renderAll } from './state.ts';
import { migrate } from './migrate.ts';

function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function saveJson(): void {
  const p = store.project;
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${(p.name || 'wardrobe').replace(/\s+/g, '_')}.wardrobe.json`);
}

export function openJson(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.addEventListener('load', () => {
      try {
        const p = migrate(JSON.parse(String(rd.result)) as unknown);
        if (!p) throw new Error('invalid');
        store.replace(p);
      } catch {
        ui.message = 'Не удалось прочитать файл проекта';
        renderAll();
      }
    });
    rd.readAsText(f);
  });
  input.click();
}

export async function exportPng(): Promise<void> {
  const svg = document.getElementById('facade') as SVGSVGElement | null;
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  if (!vb.width) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const width = 2400;
  const height = Math.max(1, Math.round((vb.height / vb.width) * width));
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const svgText = new XMLSerializer().serializeToString(clone);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('svg load failed'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#f4f5f7';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (blob) {
    const name = (store.project.name || 'wardrobe').replace(/\s+/g, '_');
    downloadBlob(blob, `${name}.png`);
  }
}
