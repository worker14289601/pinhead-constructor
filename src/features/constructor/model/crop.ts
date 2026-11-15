import { FRAME } from '../config/garment-shapes';
import { printAreaFor } from '../config/print-areas';
import type { CropRect } from './trim';
import type { Garment, ImageLayer } from './types';

/** Высота зоны печати в долях её ширины — в этих единицах слой хранит y и высоту. */
export function areaAspect(garment: Garment, layer: ImageLayer): number {
  const pa = printAreaFor(garment, layer.side);
  return (pa.height * FRAME.h) / (pa.width * FRAME.w);
}

/**
 * Поля слоя после ручного кадрирования. src — размер исходного снимка, aspect — areaAspect.
 * - Место под фото (slot): окно на принте не меняется, меняется только видимая часть снимка.
 * - Обычная картинка: масштаб на изделии сохраняется — оставшаяся часть фото стоит там же, где была
 *   (с учётом поворота и отражения), слой просто становится меньше. Если кадр расширили и слой
 *   перестал помещаться в зону, он уменьшается вокруг своей середины.
 */
export function applyCrop(layer: ImageLayer, next: CropRect, src: { w: number; h: number }, aspect: number): Partial<ImageLayer> {
  const whole = next.x <= 0 && next.y <= 0 && next.width >= src.w && next.height >= src.h;
  const view = { crop: whole ? undefined : next, naturalWidth: next.width, naturalHeight: next.height, srcSize: src, cropped: true };
  if (layer.slot !== undefined) return view;

  const old = layer.crop ?? { x: 0, y: 0, width: layer.naturalWidth, height: layer.naturalHeight };
  // Ширина зоны на один пиксель исходника.
  const s = layer.width / old.width;
  // Сдвиг левого верхнего угла в осях слоя: в отражённом слое слева — правый край снимка.
  const dx = (layer.flipX ? old.x + old.width - (next.x + next.width) : next.x - old.x) * s;
  const dy = (next.y - old.y) * s;
  const a = (layer.rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  const turn = (lx: number, ly: number) => ({ x: lx * cos - ly * sin, y: lx * sin + ly * cos });

  // Координаты в долях ширины зоны (и по вертикали тоже), в y слоя переводим в конце.
  let w = next.width * s;
  let h = next.height * s;
  const o = turn(dx, dy);
  let x = layer.x + o.x;
  let y = layer.y * aspect + o.y;
  const k = Math.min(1, 1 / w, aspect / h);
  if (k < 1) {
    const c1 = turn(w / 2, h / 2);
    const c2 = turn((w * k) / 2, (h * k) / 2);
    x += c1.x - c2.x;
    y += c1.y - c2.y;
    w *= k;
    h *= k;
    // Уменьшенный слой мог остаться за краем зоны — сдвигаем его габарит (с учётом поворота) внутрь.
    const pts = [turn(0, 0), turn(w, 0), turn(w, h), turn(0, h)];
    const xs = pts.map((p) => x + p.x);
    const ys = pts.map((p) => y + p.y);
    const fit = (lo: number, hi: number, max: number) => (hi - lo > max ? (max - hi - lo) / 2 : lo < 0 ? -lo : hi > max ? max - hi : 0);
    x += fit(Math.min(...xs), Math.max(...xs), 1);
    y += fit(Math.min(...ys), Math.max(...ys), aspect);
  }
  return { ...view, width: w, x, y: y / aspect };
}
