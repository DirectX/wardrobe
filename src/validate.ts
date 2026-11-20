import type { Issue, Project } from './types.ts';
import { WALLS, cellAt, modulesOn, wallEnd } from './geometry.ts';

export function validate(p: Project): Issue[] {
  const out: Issue[] = [];

  for (const wall of WALLS) {
    const ms = modulesOn(p, wall);
    let prev = null as (typeof ms)[number] | null;
    for (const m of ms) {
      if (m.h > p.ceiling) {
        out.push({ level: 'error', message: `«${m.id}»: высота ${m.h} выше потолка ${p.ceiling}`, refs: [m.id] });
      }
      if (m.from < 0 || wallEnd(m) > p.walls[wall].length) {
        out.push({ level: 'error', message: `«${m.id}»: выходит за пределы стены`, refs: [m.id] });
      }
      if (prev && m.from < wallEnd(prev)) {
        out.push({ level: 'error', message: `Модули «${prev.id}» и «${m.id}» пересекаются`, refs: [prev.id, m.id] });
      }
      prev = m;
    }
  }

  if (p.tv) {
    const t = p.tv;
    const id = 'tv';
    if (t.centerX - t.w / 2 < 0 || t.centerX + t.w / 2 > p.walls[t.wall].length) {
      out.push({ level: 'error', message: 'ТВ выходит за пределы стены', refs: [id] });
    }
    const half = t.w / 2;
    const behind = modulesOn(p, t.wall).filter((m) => m.from < t.centerX + half && wallEnd(m) > t.centerX - half);
    if (!behind.length) {
      out.push({ level: 'warn', message: 'ТВ висит на стене без ниши за ним', refs: [id] });
    }
    for (const m of behind) {
      if (t.centerY - t.h / 2 < 0 || t.centerY + t.h / 2 > m.h) {
        out.push({ level: 'warn', message: 'ТВ выше модуля за ним', refs: [id, m.id] });
      }
      const c = cellAt(p, m, t.centerX, t.centerY);
      if (c && c.type !== 'open') {
        out.push({ level: 'error', message: 'ТВ перекрыт фасадом — нужна открытая ниша', refs: [id, m.id] });
      }
    }
  }

  for (const s of p.sockets) {
    const cover = modulesOn(p, s.wall).find((m) => s.x >= m.from && s.x <= wallEnd(m) && s.y <= m.h);
    if (cover) {
      const c = cellAt(p, cover, s.x, s.y);
      if (c && c.type !== 'open') {
        out.push({ level: 'warn', message: `Розетка спрятана за фасадом модуля «${cover.id}»`, refs: [s.id, cover.id] });
      }
    }
  }

  return out;
}
