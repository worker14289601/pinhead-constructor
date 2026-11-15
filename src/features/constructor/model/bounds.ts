import { FRAME } from '../config/garment-shapes';
import { printAreaFor, sidesFor } from '../config/print-areas';
import type { SideBounds } from './pricing';
import { measureText } from './trim';
import type { DesignLayer, Garment } from './types';

/** Условная ширина зоны в пикселях: геометрия считается в них, результат переводится в см. */
const W = 1000;

/** Габарит слоя в пикселях зоны с учётом поворота. Повторяет геометрию узлов холста. */
function layerRect(l: DesignLayer, h: number) {
  const ox = l.x * W;
  const oy = l.y * h;
  // Картинка привязана левым верхним углом, текст — центром.
  let local: [number, number, number, number];
  if (l.kind === 'image') {
    const w = l.width * W;
    local = [0, 0, w, (w * l.naturalHeight) / l.naturalWidth];
  } else {
    // Габарит по буквам — тот же, что у узла на холсте.
    const box = measureText(l.text, l, l.fontSize * W);
    local = [-box.width / 2, -box.height / 2, box.width / 2, box.height / 2];
  }
  const [lx1, ly1, lx2, ly2] = local;
  const a = (l.rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [cx, cy] of [[lx1, ly1], [lx2, ly1], [lx2, ly2], [lx1, ly2]]) {
    xs.push(ox + cx * cos - cy * sin);
    ys.push(oy + cx * sin + cy * cos);
  }
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

/** Размер слоя или нескольких слоёв вместе (готовый принт) в сантиметрах — для подписи под рамкой выделения. */
export function layerSizeCm(garment: Garment, layer: DesignLayer | DesignLayer[]): { wCm: number; hCm: number } | null {
  const list = Array.isArray(layer) ? layer : [layer];
  if (!list.length) return null;
  const pa = printAreaFor(garment, list[0].side);
  const h = (W * pa.height * FRAME.h) / (pa.width * FRAME.w);
  const r = list.map((l) => layerRect(l, h)).reduce((a, b) => ({
    x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2),
  }));
  const cmPerPx = pa.widthCm / W;
  const wCm = (r.x2 - r.x1) * cmPerPx;
  const hCm = (r.y2 - r.y1) * cmPerPx;
  return wCm > 0 && hCm > 0 ? { wCm, hCm } : null;
}

/**
 * Габарит принта в сантиметрах по каждой стороне модели — для формата и цены.
 * Считается из слоёв, а не с холста, поэтому верен и для сторон, которые сейчас не показаны,
 * и сразу после смены модели. Часть принта за границей зоны печати не учитывается (её обрежет).
 */
export function designBounds(garment: Garment, layers: DesignLayer[]): SideBounds {
  const out: SideBounds = {};
  for (const side of sidesFor(garment)) {
    const pa = printAreaFor(garment, side);
    const h = (W * pa.height * FRAME.h) / (pa.width * FRAME.w);
    let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const l of layers) {
      if (l.side !== side) continue;
      const r = layerRect(l, h);
      x1 = Math.min(x1, Math.max(0, r.x1));
      y1 = Math.min(y1, Math.max(0, r.y1));
      x2 = Math.max(x2, Math.min(W, r.x2));
      y2 = Math.max(y2, Math.min(h, r.y2));
    }
    const cmPerPx = pa.widthCm / W;
    out[side] = x2 > x1 && y2 > y1 ? { wCm: (x2 - x1) * cmPerPx, hCm: (y2 - y1) * cmPerPx } : null;
  }
  return out;
}
