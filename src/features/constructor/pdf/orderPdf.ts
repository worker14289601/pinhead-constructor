import { SIDE_LABEL, type OrderContacts, type PrintMethod, type Side } from '../model/types';
import type { PriceBreakdown } from '../model/pricing';

/**
 * PDF заказа, одна страница A4. Без внешних библиотек: страница рисуется на canvas,
 * сохраняется в JPEG и упаковывается в минимальный PDF (JPEG в PDF хранится как есть, фильтр DCTDecode).
 * Текст в таком файле — картинка: его нельзя выделить, зато не нужны шрифты и зависимости.
 */
export interface OrderPdfData {
  number: string;
  createdAt: Date;
  garment: string;
  color: string;
  method: PrintMethod;
  sizes: Array<[size: string, qty: number]>;
  price: PriceBreakdown;
  contacts: OrderContacts;
  /** Превью изделия с принтом по сторонам (PNG dataURL). */
  previews: Array<{ side: Side; dataUrl: string }>;
  /** Имена файлов, загруженных клиентом. */
  fileNames: string[];
}

/** A4 в пунктах PDF и ширина страницы в пикселях (~200 dpi). */
const PAGE = { w: 595.28, h: 841.89 };
const PX = 1654;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const C = { text: '#16161a', muted: '#6b6b73', line: '#e4e4e7', accent: '#ff4f00', paper: '#f4f4f2' };

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('pdf_image'));
    img.src = src;
  });
}

/** Пишет текст с переносом по словам; возвращает y следующей строки. */
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): number {
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxW) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineH;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineH;
}

async function renderPage(d: OrderPdfData): Promise<HTMLCanvasElement> {
  const W = PX;
  const H = Math.round((PX * PAGE.h) / PAGE.w);
  const M = 100;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('pdf_canvas');
  const font = (size: number, weight = 500) => `${weight} ${size}px ${FONT}`;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // Шапка
  ctx.fillStyle = C.text;
  ctx.font = font(48, 800);
  ctx.fillText('PINHEAD STUDIO', M, M + 40);
  ctx.textAlign = 'right';
  ctx.font = font(34, 700);
  ctx.fillText(`Заказ № ${d.number}`, W - M, M + 20);
  ctx.font = font(24);
  ctx.fillStyle = C.muted;
  ctx.fillText(d.createdAt.toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' }), W - M, M + 58);
  ctx.textAlign = 'left';
  ctx.fillStyle = C.line;
  ctx.fillRect(M, M + 90, W - 2 * M, 2);

  // Превью: одна-две стороны — крупно, три-четыре — в ряд.
  const top = M + 130;
  const gap = 24;
  const n = Math.max(1, d.previews.length);
  const cols = n <= 2 ? 2 : 4;
  const pw = Math.floor((W - 2 * M - gap * (cols - 1)) / cols);
  let ph = 0;
  for (let i = 0; i < d.previews.length; i++) {
    const p = d.previews[i];
    const img = await loadImage(p.dataUrl);
    ph = Math.round((pw * img.naturalHeight) / img.naturalWidth);
    const x = M + i * (pw + gap);
    ctx.fillStyle = C.paper;
    ctx.fillRect(x, top, pw, ph);
    ctx.drawImage(img, x, top, pw, ph);
    ctx.fillStyle = C.muted;
    ctx.font = font(22);
    ctx.fillText(SIDE_LABEL[p.side], x, top + ph + 34);
  }

  // Две колонки: детали заказа и контакты.
  const colGap = 70;
  const cw = (W - 2 * M - colGap) / 2;
  const y0 = top + ph + 110;
  const rows = (title: string, x: number, items: Array<[string, string]>) => {
    let y = y0;
    ctx.fillStyle = C.text;
    ctx.font = font(32, 800);
    ctx.fillText(title, x, y);
    y += 56;
    for (const [k, v] of items) {
      ctx.fillStyle = C.muted;
      ctx.font = font(21);
      ctx.fillText(k, x, y);
      ctx.fillStyle = C.text;
      ctx.font = font(25, 600);
      y = wrap(ctx, v, x, y + 32, cw, 32) + 14;
    }
    return y;
  };

  const p = d.price;
  const details: Array<[string, string]> = [
    ['Изделие', d.garment],
    ['Цвет', d.color],
    ['Нанесение', d.method.toUpperCase()],
    ['Размеры', d.sizes.map(([s, q]) => `${s} × ${q}`).join(', ')],
    ['Количество', `${p.qty} шт`],
    ['Изделие, за шт', rub(p.garment)],
    ...p.sides.map((x): [string, string] => [
      `Печать: ${SIDE_LABEL[x.side].toLowerCase()}, за шт`,
      `${rub(x.price)} · ${x.format}${x.oversize ? ' (крупнее формата)' : ''} · ≈ ${Math.round(x.wCm)} × ${Math.round(x.hCm)} см`,
    ]),
    ['Цена за шт', rub(p.perItem)],
  ];
  if (d.fileNames.length) details.push(['Файлы клиента', d.fileNames.join(', ')]);

  const c = d.contacts;
  const yDetails = rows('Детали заказа', M, details);
  const yContacts = rows('Контакты', M + cw + colGap, [
    ['Имя', c.name], ['Телефон', c.phone], ['E-mail', c.email], ['Город', c.city],
    ['Адрес', c.address || '—'], ['Комментарий', c.comment || '—'],
  ]);

  // Итог — под контактами.
  let y = yContacts + 20;
  const tx = M + cw + colGap;
  ctx.fillStyle = C.line;
  ctx.fillRect(tx, y, cw, 2);
  y += 52;
  ctx.fillStyle = C.muted;
  ctx.font = font(24);
  ctx.fillText('Примерная сумма', tx, y);
  ctx.fillStyle = C.accent;
  ctx.font = font(50, 800);
  ctx.fillText(rub(p.total), tx, y + 62);
  ctx.fillStyle = C.muted;
  ctx.font = font(20);
  y = wrap(ctx, 'Цена примерная: менеджер проверит макет и подтвердит стоимость.', tx, y + 104, cw, 28);

  // Подвал
  ctx.fillStyle = C.muted;
  ctx.font = font(20);
  ctx.fillText('Документ сформирован в конструкторе Pinhead Studio.', M, Math.max(H - M + 30, Math.max(y, yDetails)));

  return canvas;
}

/** PDF из одной JPEG-картинки на всю страницу A4. */
function jpegToPdf(jpeg: Uint8Array<ArrayBuffer>, imgW: number, imgH: number): Blob {
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: string | Uint8Array<ArrayBuffer>) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (id: number, body: string) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  const content = `q ${PAGE.w} 0 0 ${PAGE.h} 0 0 cm /Im0 Do Q`;
  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  const xref = length;
  let table = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(`${table}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

export async function buildOrderPdf(data: OrderPdfData): Promise<Blob> {
  const canvas = await renderPage(data);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('pdf_jpeg');
  return jpegToPdf(new Uint8Array(await blob.arrayBuffer()), canvas.width, canvas.height);
}
