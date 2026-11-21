import type { Issue, Project } from './types.ts';
import { WALLS, cornerZones, leafAtPoint, modulesOn, slidingAtPoint, wallEnd } from './geometry.ts';

export function validate(p: Project): Issue[] {
  const out: Issue[] = [];

  for (const wall of WALLS) {
    const ms = modulesOn(p, wall);
    const z = cornerZones(p, wall);
    let prev = null as (typeof ms)[number] | null;
    for (const m of ms) {
      const label = `${m.id}`;
      if (m.h > p.ceiling) {
        out.push({ level: 'error', message: `«${label}»: высота ${m.h} выше потолка ${p.ceiling}`, refs: [m.id] });
      }
      if (m.from < z.start - 1) {
        out.push({
          level: 'error',
          message: `«${label}»: заходит в угол (занято ${z.start} мм — глубина смежного ряда)`,
          refs: [m.id],
        });
      }
      if (wallEnd(m) > p.walls[wall].length - z.end + 1) {
        out.push({
          level: 'error',
          message: `«${label}»: заходит в угол (занято ${z.end} мм — глубина смежного ряда)`,
          refs: [m.id],
        });
      }
      if (prev && m.from < wallEnd(prev)) {
        out.push({ level: 'error', message: `Модули «${prev.id}» и «${m.id}» пересекаются`, refs: [prev.id, m.id] });
      }
      prev = m;
    }
  }

  const leafIsOpenAt = (wall: string, x: number, y: number): boolean | null => {
    for (const m of p.modules) {
      if (m.wall !== wall) continue;
      if (x < m.from || x > wallEnd(m) || y < p.base || y > m.h) continue;
      const hit = leafAtPoint(p, m, x, y);
      if (hit) return hit.leaf.face.kind === 'open';
    }
    return null;
  };

  // купе: ТВ/розетки за закрытыми створками — та же ошибка/предупреждение, что за фасадом
  const slidingCovers = (wall: string, x: number, y: number): boolean => {
    for (const m of p.modules) {
      if (m.wall !== wall) continue;
      if (x < m.from || x > wallEnd(m) || y < p.base || y > m.h) continue;
      const hit = slidingAtPoint(p, m, x, y);
      if (hit) return true;
    }
    return false;
  };

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
    const face = leafIsOpenAt(t.wall, t.centerX, t.centerY);
    if (face === false || slidingCovers(t.wall, t.centerX, t.centerY)) {
      out.push({ level: 'error', message: 'ТВ перекрыт фасадом — отсек за ТВ должен быть нишей (и без створок купе над ним)', refs: [id] });
    }
  }

  for (const s of p.sockets) {
    const face = leafIsOpenAt(s.wall, s.x, s.y);
    if (face === false || slidingCovers(s.wall, s.x, s.y)) {
      const cover = modulesOn(p, s.wall).find((m) => s.x >= m.from && s.x <= wallEnd(m) && s.y <= m.h);
      out.push({ level: 'warn', message: `Розетка спрятана за фасадом${cover ? ` модуля «${cover.id}»` : ''}`, refs: [s.id, ...(cover ? [cover.id] : [])] });
    }
  }

  return out;
}
