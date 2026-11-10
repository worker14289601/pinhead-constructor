import { FORMAT_MAX_CM, PRINT_PRICE, type PrintFormat } from '../config/pricing';
import type { PrintMethod, Side, SizeQuantities } from './types';

/** Габарит принта на стороне в сантиметрах (считает холст по реальным узлам). */
export type SideBounds = Partial<Record<Side, { wCm: number; hCm: number } | null>>;

export function formatFor(wCm: number, hCm: number): PrintFormat {
  const [s, l] = [Math.min(wCm, hCm), Math.max(wCm, hCm)];
  for (const f of Object.keys(FORMAT_MAX_CM) as PrintFormat[]) {
    const m = FORMAT_MAX_CM[f];
    if (s <= m.w && l <= m.h) return f;
  }
  return 'A3+';
}

export interface PriceBreakdown {
  garment: number;
  /** oversize — принт больше самого крупного формата: цену такой печати подтверждает менеджер. */
  sides: Array<{ side: Side; format: PrintFormat; price: number; oversize: boolean }>;
  perItem: number;
  qty: number;
  total: number;
}

export function calcPrice(args: {
  garmentPrice: number;
  isWhite: boolean;
  method: PrintMethod;
  bounds: SideBounds;
  sizes: SizeQuantities;
}): PriceBreakdown {
  const sides = (Object.entries(args.bounds) as Array<[Side, { wCm: number; hCm: number } | null]>)
    .filter(([, b]) => b && b.wCm > 0)
    .map(([side, b]) => {
      const format = formatFor(b!.wCm, b!.hCm);
      const price = PRINT_PRICE[args.method][format][args.isWhite ? 0 : 1];
      const max = FORMAT_MAX_CM[format];
      const oversize = Math.min(b!.wCm, b!.hCm) > max.w || Math.max(b!.wCm, b!.hCm) > max.h;
      return { side, format, price, oversize };
    });
  const perItem = args.garmentPrice + sides.reduce((s, x) => s + x.price, 0);
  const qty = Object.values(args.sizes).reduce((s, n) => s + n, 0);
  return { garment: args.garmentPrice, sides, perItem, qty, total: perItem * qty };
}
