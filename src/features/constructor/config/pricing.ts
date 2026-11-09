import type { PrintMethod } from '../model/types';

/**
 * Прайс нанесения с главной studio.pnhd.ru (блок «Срочная печать», ноябрь 2026).
 * Цена за одну сторону одного изделия: [на белом, на цветном].
 * ВРЕМЕННО: прайс по DTF/DTG и скидки на тираж будут уточнены.
 */
export type PrintFormat = 'A6' | 'A5' | 'A4' | 'A3' | 'A3+';

export const FORMAT_MAX_CM: Record<PrintFormat, { w: number; h: number }> = {
  A6: { w: 10.5, h: 14.8 },
  A5: { w: 14.8, h: 21 },
  A4: { w: 21, h: 29.7 },
  A3: { w: 29.7, h: 42 },
  'A3+': { w: 32.9, h: 48.3 },
};

export const PRINT_PRICE: Record<PrintMethod, Record<PrintFormat, [number, number]>> = {
  dtg: { A6: [400, 500], A5: [500, 650], A4: [650, 800], A3: [800, 900], 'A3+': [900, 1100] },
  dtf: { A6: [400, 500], A5: [500, 650], A4: [650, 800], A3: [800, 900], 'A3+': [900, 1100] },
};

export const METHOD_INFO: Record<PrintMethod, { title: string; hint: string }> = {
  dtg: {
    title: 'DTG — прямая печать',
    hint: 'Мягкий принт, лучше всего на белом и светлом хлопке. Фотографии и градиенты.',
  },
  dtf: {
    title: 'DTF — плёнка',
    hint: 'Яркие насыщенные цвета на любом цвете ткани. Чёткие контуры и мелкие детали.',
  },
};
