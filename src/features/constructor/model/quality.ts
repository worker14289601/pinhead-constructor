import type { ImageLayer } from './types';

/** Ниже — предупреждаем, что печать может выйти нечёткой. */
export const MIN_DPI = 150;
export const MAX_FILE_MB = 15;
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** Эффективное разрешение картинки на отпечатке. SVG — векторная, всегда ок. */
export function imageDpi(layer: ImageLayer, areaWidthCm: number, isVector = false): number {
  if (isVector) return Infinity;
  const printWidthInch = (layer.width * areaWidthCm) / 2.54;
  return printWidthInch > 0 ? Math.round(layer.naturalWidth / printWidthInch) : 0;
}

export function validateFile(f: File): string | null {
  if (!ACCEPTED_TYPES.includes(f.type)) return 'Подойдут PNG, JPG, WEBP или SVG.';
  if (f.size > MAX_FILE_MB * 1024 * 1024) return `Файл больше ${MAX_FILE_MB} МБ — уменьшите его или пришлите менеджеру.`;
  return null;
}
