'use client';
import { useEffect, useState } from 'react';

/**
 * Перекраска серых мокапов. Пиксель s = яркость/128:
 *   s ≤ 1 → цвет × s (складки и тени), s > 1 → цвет к белому (блики).
 * «Тень» для принта — чёрный с альфой (1 − s): рисуется поверх принта в режиме source-atop,
 * это эквивалент умножения на s, но только там, где есть принт.
 */
const baseCache = new Map<string, Promise<ImageData>>();
const tintCache = new Map<string, HTMLCanvasElement>();
const shadeCache = new Map<string, HTMLCanvasElement>();

function loadBase(url: string): Promise<ImageData> {
  let p = baseCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, c.width, c.height));
      };
      img.onerror = reject;
      img.src = url;
    });
    baseCache.set(url, p);
    // Ошибку загрузки не кэшируем — следующая попытка загрузит мокап заново.
    p.catch(() => baseCache.delete(url));
  }
  return p;
}

function toCanvas(data: Uint8ClampedArray<ArrayBuffer>, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(data, w, h), 0, 0);
  return c;
}

async function tint(url: string, hex: string) {
  const key = `${url}|${hex}`;
  const hit = tintCache.get(key);
  if (hit) return { url, garment: hit, shade: shadeCache.get(url)! };

  const base = await loadBase(url);
  const rgb = hexToRgb(hex);
  const src = base.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const s = src[i] / 128;
    for (let k = 0; k < 3; k++) {
      const c = rgb[k];
      out[i + k] = s <= 1 ? c * s : c + (255 - c) * (s - 1);
    }
    out[i + 3] = src[i + 3];
  }
  const garment = toCanvas(out, base.width, base.height);
  tintCache.set(key, garment);

  if (!shadeCache.has(url)) {
    const sh = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
      const s = Math.min(1, src[i] / 128);
      sh[i + 3] = Math.round((1 - s) * 255 * (src[i + 3] / 255));
    }
    shadeCache.set(url, toCanvas(sh, base.width, base.height));
  }
  return { url, garment, shade: shadeCache.get(url)! };
}

/**
 * Окрашенный мокап и маска складок. null — пока грузится или мокапа нет.
 * Пока грузится новый мокап, возвращается прежний; `url` в результате говорит, чей он.
 */
export function useTintedMockup(url: string | null, hex: string) {
  const [res, setRes] = useState<{ url: string; garment: HTMLCanvasElement; shade: HTMLCanvasElement } | null>(null);
  useEffect(() => {
    if (!url) return setRes(null);
    let alive = true;
    tint(url, hex).then((r) => alive && setRes(r)).catch(() => alive && setRes(null));
    return () => { alive = false; };
  }, [url, hex]);
  return res;
}

/** '#fff' | '#ffffff' → [r, g, b]. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16) || 0;
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** Светлый ли цвет — для контраста рамок и текста по умолчанию. */
export function isLight(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}
