import { photoPlaceholder } from '../config/template-art';
import { measureText } from './trim';
import type { ImageLayer, ImageMask } from './types';

/** Обрезка снимка iw×ih по центру под окно с пропорциями aspect (высота в долях ширины). */
export function coverCrop(iw: number, ih: number, aspect: number) {
  const cw = Math.min(iw, ih / aspect);
  const ch = cw * aspect;
  return { x: Math.round((iw - cw) / 2), y: Math.round((ih - ch) / 2), width: Math.round(cw), height: Math.round(ch) };
}

/** Начертание слова-маски для измерения и отрисовки. */
export const maskStyle = (m: Extract<ImageMask, { kind: 'text' }>) =>
  ({ fontFamily: m.fontFamily, bold: m.bold, italic: false, align: 'center' as const, lineHeight: 1, strokeWidth: 0, arc: 0 });

/** Пропорции окна под слово: высота букв в долях ширины слова. */
export function maskAspect(m: Extract<ImageMask, { kind: 'text' }>): number {
  const box = measureText(m.text, maskStyle(m), 100);
  return box.width > 0 ? box.height / box.width : 1;
}

/**
 * Поля слоя после смены пропорций окна (например, поменяли слово-маску): заглушка перерисовывается,
 * а вставленный снимок заново обрезается по центру.
 */
export function refitSlot(layer: ImageLayer, aspect: number): Partial<ImageLayer> {
  if (layer.placeholder || !layer.srcSize) return { slot: aspect, ...photoPlaceholder(aspect, !!layer.mask) };
  const crop = coverCrop(layer.srcSize.w, layer.srcSize.h, aspect);
  return { slot: aspect, crop, naturalWidth: crop.width, naturalHeight: crop.height };
}
