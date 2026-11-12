import { DEFAULT_FONT } from '../config/fonts';
import type { DesignLayer, PrintMethod, Side, SizeQuantities } from './types';

/**
 * Черновик дизайна в localStorage: изделие, цвет, слои всех сторон, размеры. Картинки — как dataURL,
 * а если не хватило места (квота ~5 МБ) — сохраняем без картинок и говорим об этом.
 */
const KEY = 'pnhd-constructor-draft:1';

export interface Draft {
  garmentId: string | null;
  variantId: string | null;
  side: Side;
  method: PrintMethod;
  sizes: SizeQuantities;
  layers: DesignLayer[];
  savedAt: number;
  /** Картинки в черновик не поместились — их придётся загрузить заново. */
  imagesDropped: boolean;
}

export type DraftState = Omit<Draft, 'savedAt' | 'imagesDropped'>;
export type SaveResult = 'saved' | 'no-images' | 'failed' | 'cleared';

const dataUrls = new Map<string, string>();

/** blob:-адрес картинки → dataURL (кэшируем: перечитывать большой файл при каждой правке незачем). */
async function toDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src;
  const hit = dataUrls.get(src);
  if (hit) return hit;
  const blob = await (await fetch(src)).blob();
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  dataUrls.set(src, url);
  return url;
}

const isEmpty = (s: DraftState) => !s.layers.length && !Object.values(s.sizes).some((n) => n > 0);

function write(d: Draft): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export async function saveDraft(s: DraftState): Promise<SaveResult> {
  try {
    if (isEmpty(s)) {
      localStorage.removeItem(KEY);
      return 'cleared';
    }
    const layers = await Promise.all(s.layers.map(async (l) => (l.kind === 'image' ? { ...l, src: await toDataUrl(l.src) } : l)));
    if (write({ ...s, layers, savedAt: Date.now(), imagesDropped: false })) return 'saved';
    // Квота: пробуем без картинок, остальное (текст, размеры, изделие) сохраняем.
    const hadImages = layers.some((l) => l.kind === 'image');
    const rest = layers.filter((l) => l.kind !== 'image');
    if (write({ ...s, layers: rest, savedAt: Date.now(), imagesDropped: hadImages })) return hadImages ? 'no-images' : 'saved';
    return 'failed';
  } catch {
    return 'failed';
  }
}

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d || !Array.isArray(d.layers)) return null;
    // Поля текста, которых не было в старых черновиках, добираем значениями по умолчанию.
    d.layers = d.layers.map((l) => (l.kind === 'text'
      ? Object.assign({ fontFamily: DEFAULT_FONT, bold: false, italic: false, lineHeight: 1.1, strokeWidth: 0, strokeColor: '#ffffff', arc: 0 }, l)
      : l));
    return d;
  } catch {
    return null;
  }
}

export function clearDraft() {
  try { localStorage.removeItem(KEY); } catch { /* хранилище недоступно */ }
}

/** В черновике есть что продолжать. */
export const hasContent = (d: Draft) => !!d.layers.length || Object.values(d.sizes ?? {}).some((n) => n > 0) || d.imagesDropped;
