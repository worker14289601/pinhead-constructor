/**
 * Тримминг — пустые поля не должны попадать в размер принта: от него зависят сантиметры,
 * формат печати и цена.
 *   • Картинка: прозрачные края, а у непрозрачной картинки на белом фоне — белые края.
 *   • Текст: габарит по самим буквам, а не по строке шрифта с запасом под выносные элементы.
 */

export interface CropRect { x: number; y: number; width: number; height: number }

/** Картинку анализируем уменьшенной: границы точны до доли процента, а большие фото не тормозят. */
const SAMPLE = 800;
const ALPHA_MIN = 8;
const WHITE_MIN = 245;
/** Если поля меньше 2% — не обрезаем, разница незаметна. */
const KEEP_IF = 0.98;

/**
 * Область рисунка без пустых полей в пикселях исходной картинки.
 * null — обрезать нечего (полей нет, картинка пустая или её нельзя прочитать).
 */
export function contentBox(img: HTMLImageElement): CropRect | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return null; // SVG без размеров
  const k = Math.min(1, SAMPLE / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * k));
  const h = Math.max(1, Math.round(nh * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  let d: Uint8ClampedArray;
  try {
    ctx.drawImage(img, 0, 0, w, h);
    d = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  const at = (x: number, y: number) => (y * w + x) * 4;
  const isWhite = (i: number) => d[i] >= WHITE_MIN && d[i + 1] >= WHITE_MIN && d[i + 2] >= WHITE_MIN;
  // Белый срезаем, только если вся картинка лежит на белом фоне: углы непрозрачные и белые.
  const whiteBg = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)].every((i) => d[i + 3] >= 250 && isWhite(i));
  const empty = (i: number) => d[i + 3] < ALPHA_MIN || (whiteBg && isWhite(i));

  let [x1, y1, x2, y2] = [w, h, -1, -1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (empty(at(x, y))) continue;
      if (x < x1) x1 = x;
      if (x > x2) x2 = x;
      if (y < y1) y1 = y;
      if (y > y2) y2 = y;
    }
  }
  if (x2 < 0) return null;

  // Запас в один пиксель выборки: на краю уменьшенной картинки цвета смешаны.
  const rx = Math.max(0, Math.floor((x1 - 1) / k));
  const ry = Math.max(0, Math.floor((y1 - 1) / k));
  const rw = Math.min(nw, Math.ceil((x2 + 2) / k)) - rx;
  const rh = Math.min(nh, Math.ceil((y2 + 2) / k)) - ry;
  if (rw >= nw * KEEP_IF && rh >= nh * KEEP_IF) return null;
  return { x: rx, y: ry, width: rw, height: rh };
}

export interface TextBox {
  width: number;
  height: number;
  /** Строки с точкой базовой линии относительно левого верхнего угла габарита. */
  lines: Array<{ text: string; x: number; y: number }>;
}

/** Межстрочный шаг в долях кегля — как у текста Konva по умолчанию. */
const LINE_HEIGHT = 1;

let measureCtx: CanvasRenderingContext2D | null | undefined;
const textCache = new Map<string, TextBox>();

export const textFont = (fontFamily: string, fontPx: number) => `normal normal ${fontPx}px ${fontFamily}`;

/** Габарит текста по буквам. Вне браузера — нулевой. */
export function measureText(text: string, fontFamily: string, fontPx: number, align: 'left' | 'center' | 'right'): TextBox {
  const key = `${fontFamily}|${fontPx}|${align}|${text}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return { width: 0, height: 0, lines: [] };
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return { width: 0, height: 0, lines: [] };
  const ctx = measureCtx;
  ctx.font = textFont(fontFamily, fontPx);

  const rows = text.split('\n').map((t) => ({ t, m: ctx.measureText(t) }));
  const maxAdv = Math.max(0, ...rows.map((r) => r.m.width));
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const placed = rows.map((r, i) => {
    const x0 = align === 'left' ? 0 : align === 'center' ? (maxAdv - r.m.width) / 2 : maxAdv - r.m.width;
    const base = i * fontPx * LINE_HEIGHT;
    if (r.t.trim()) {
      minX = Math.min(minX, x0 - r.m.actualBoundingBoxLeft);
      maxX = Math.max(maxX, x0 + r.m.actualBoundingBoxRight);
      minY = Math.min(minY, base - r.m.actualBoundingBoxAscent);
      maxY = Math.max(maxY, base + r.m.actualBoundingBoxDescent);
    }
    return { text: r.t, x: x0, y: base };
  });

  let box: TextBox;
  if (minX === Infinity) {
    // Пустая надпись: оставляем рамку, за которую её можно взять.
    box = { width: fontPx * 0.5, height: fontPx, lines: [] };
  } else {
    box = {
      width: maxX - minX,
      height: maxY - minY,
      lines: placed.map((l) => ({ text: l.text, x: l.x - minX, y: l.y - minY })),
    };
  }
  if (textCache.size > 500) textCache.clear();
  textCache.set(key, box);
  return box;
}
