import { maskStyle } from '../model/slot';
import { measureText, textFont } from '../model/trim';
import type { ImageMask } from '../model/types';

/** Предел стороны буфера, px: больше canvas на телефонах может не выделить. */
const MAX_SIDE = 4096;
let buffer: HTMLCanvasElement | null = null;

type Src = { x: number; y: number; width: number; height: number };

/**
 * Рисует фото в прямоугольнике w×h, обрезанное по маске. Работает и на холсте, и в превью, и при снимке
 * файла печати: разрешение буфера берётся из текущего масштаба контекста.
 */
export function drawMasked(c: CanvasRenderingContext2D, img: CanvasImageSource, src: Src, w: number, h: number, mask: ImageMask) {
  if (w <= 0 || h <= 0) return;
  if (mask.kind === 'strips') {
    const gap = mask.gap * h;
    const band = (h - gap * (mask.count - 1)) / mask.count;
    for (let i = 0; i < mask.count; i++) {
      c.save();
      c.beginPath();
      c.rect(0, i * (band + gap), w, band);
      c.clip();
      c.drawImage(img, src.x, src.y, src.width, src.height, 0, 0, w, h);
      c.restore();
    }
    return;
  }
  // Буквы: рисуем слово в буфер, поверх — фото только там, где есть буквы, и переносим буфер на холст.
  const t = c.getTransform();
  const k = Math.min(Math.hypot(t.a, t.b) || 1, MAX_SIDE / Math.max(w, h));
  const [bw, bh] = [Math.max(1, Math.ceil(w * k)), Math.max(1, Math.ceil(h * k))];
  buffer ??= document.createElement('canvas');
  buffer.width = bw;
  buffer.height = bh;
  const b = buffer.getContext('2d');
  if (!b) return;
  const style = maskStyle(mask);
  const box = measureText(mask.text, style, 100);
  if (!box.items.length) return;
  b.save();
  b.scale(bw / box.width, bh / box.height);
  b.font = textFont(style, 100);
  b.textAlign = 'left';
  b.textBaseline = 'alphabetic';
  b.fillStyle = '#000';
  for (const it of box.items) b.fillText(it.text, it.x, it.y);
  b.restore();
  b.globalCompositeOperation = 'source-in';
  b.drawImage(img, src.x, src.y, src.width, src.height, 0, 0, bw, bh);
  b.globalCompositeOperation = 'source-over';
  c.drawImage(buffer, 0, 0, bw, bh, 0, 0, w, h);
}
