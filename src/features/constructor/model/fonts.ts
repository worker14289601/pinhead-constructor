import { fontCssUrl, fontDef } from '../config/fonts';
import { clearTextCache } from './trim';

/**
 * Загрузка шрифтов для холста. Konva рисует на canvas, а canvas не ждёт шрифт: пока он не загружен,
 * текст рисуется запасным, и габарит (цена, формат) считается по нему. Поэтому шрифт грузим через FontFace API,
 * после загрузки сбрасываем кэш измерений и просим интерфейс перерисоваться (см. onFontLoaded).
 */
const sheets = new Map<string, Promise<void>>();
const ready = new Set<string>();
const listeners = new Set<() => void>();

/** Подписка на «загрузился шрифт» — чтобы перерисовать слои и пересчитать габарит. */
export function onFontLoaded(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** CSS-описание шрифта для canvas и document.fonts. */
export const fontSpec = (family: string, bold: boolean, italic: boolean, px = 32) =>
  `${italic ? 'italic' : 'normal'} ${bold ? 700 : 400} ${px}px "${family}"`;

/** Скачивает CSS семейства и регистрирует его начертания как FontFace (подгружаются по unicode-range). */
function registerFamily(family: string): Promise<void> {
  const def = fontDef(family);
  if (!def) return Promise.resolve();
  let p = sheets.get(family);
  if (!p) {
    p = fetch(fontCssUrl(def))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`fonts_${r.status}`))))
      .then((css) => {
        for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
          const get = (prop: string) => new RegExp(`${prop}:\\s*([^;]+);`).exec(m[1])?.[1].trim();
          const url = /url\(([^)]+)\)/.exec(m[1])?.[1];
          if (!url) continue;
          const face = new FontFace(family, `url(${url})`, {
            style: get('font-style') ?? 'normal',
            weight: get('font-weight') ?? '400',
            unicodeRange: get('unicode-range'),
          });
          document.fonts.add(face);
        }
        ready.add(family);
      })
      .catch((e) => { sheets.delete(family); throw e; });
    sheets.set(family, p);
  }
  return p;
}

/** Дожидается шрифта для заданного текста. Системные шрифты (не из списка) готовы сразу. */
export async function ensureFont(family: string, bold: boolean, italic: boolean, text: string): Promise<void> {
  if (!fontDef(family) || typeof document === 'undefined') return;
  const was = ready.has(family) && document.fonts.check(fontSpec(family, bold, italic), text || 'Аа');
  if (was) return;
  await registerFamily(family);
  await document.fonts.load(fontSpec(family, bold, italic), text || 'Аа');
  clearTextCache();
  listeners.forEach((fn) => fn());
}

/** Загружен ли шрифт под этот текст (для проверки перед снимком холста). */
export function fontReady(family: string, bold: boolean, italic: boolean, text: string): boolean {
  if (!fontDef(family) || typeof document === 'undefined') return true;
  return ready.has(family) && document.fonts.check(fontSpec(family, bold, italic), text || 'Аа');
}
