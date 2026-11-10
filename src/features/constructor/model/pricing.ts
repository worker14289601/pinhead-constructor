import { priceListFor, type FormatPrice, type PriceList, type PrintFormat } from '../config/pricing';
import type { PrintMethod, Side, SizeQuantities } from './types';

/** Габарит принта на стороне в сантиметрах (считается из слоёв, см. bounds.ts). */
export type SideBounds = Partial<Record<Side, { wCm: number; hCm: number } | null>>;

/** Запас на округление: принт 20,3 см считается влезающим в формат 20 см. */
const FIT_TOLERANCE_CM = 0.5;

/**
 * Самый маленький формат, в который помещается принт (можно повернуть).
 * Если не помещается ни в один — самый крупный с пометкой oversize: цену подтверждает менеджер.
 */
export function formatFor(wCm: number, hCm: number, list: PriceList): { format: FormatPrice; oversize: boolean } {
  const s = Math.min(wCm, hCm) - FIT_TOLERANCE_CM;
  const l = Math.max(wCm, hCm) - FIT_TOLERANCE_CM;
  const fit = list.formats.find((f) => s <= Math.min(f.w, f.h) && l <= Math.max(f.w, f.h));
  return fit ? { format: fit, oversize: false } : { format: list.formats[list.formats.length - 1], oversize: true };
}

/** Ступень прайса по количеству: 1–9 шт → 0, от 10 → 1, от 20 → 2… */
export function tierIndex(qty: number, tiers: number[]): number {
  let i = 0;
  while (i + 1 < tiers.length && qty >= tiers[i + 1]) i++;
  return i;
}

export interface PriceBreakdown {
  garment: number;
  /** Печать по сторонам; цена — за принт на текущей ступени тиража. */
  sides: Array<{ side: Side; format: PrintFormat; price: number; oversize: boolean; wCm: number; hCm: number }>;
  perItem: number;
  qty: number;
  total: number;
  /** От скольких штук действует текущая ступень цены (1 — базовая). */
  tierFrom: number;
  /** Следующая ступень: от скольких штук и какой станет цена за штуку. null — дешевле уже не будет. */
  next: { qty: number; perItem: number } | null;
}

export function calcPrice(args: {
  garmentPrice: number;
  isWhite: boolean;
  method: PrintMethod;
  bounds: SideBounds;
  sizes: SizeQuantities;
}): PriceBreakdown {
  const list = priceListFor(args.method);
  // Ступень — по общему количеству заявки, а не по каждому размеру.
  const qty = Object.values(args.sizes).reduce((s, n) => s + n, 0);
  const tier = tierIndex(qty, list.tiers);
  const priceAt = (f: FormatPrice, t: number) => (args.isWhite ? f.white : f.colored)[t];

  const printed = (Object.entries(args.bounds) as Array<[Side, { wCm: number; hCm: number } | null]>)
    .filter((e): e is [Side, { wCm: number; hCm: number }] => !!e[1] && e[1].wCm > 0)
    .map(([side, b]) => ({ side, b, ...formatFor(b.wCm, b.hCm, list) }));

  const sides = printed.map(({ side, b, format, oversize }) => ({
    side, format: format.name, price: priceAt(format, tier), oversize, wCm: b.wCm, hCm: b.hCm,
  }));
  const perItem = args.garmentPrice + sides.reduce((s, x) => s + x.price, 0);

  const nextQty = list.tiers[tier + 1];
  const next = printed.length && nextQty
    ? { qty: nextQty, perItem: args.garmentPrice + printed.reduce((s, x) => s + priceAt(x.format, tier + 1), 0) }
    : null;

  return { garment: args.garmentPrice, sides, perItem, qty, total: perItem * qty, tierFrom: list.tiers[tier], next };
}
