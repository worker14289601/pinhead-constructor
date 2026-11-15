/**
 * События воронки конструктора. Отправляются в Яндекс.Метрику сайта
 * через reachGoal. Без счётчика — пишутся в консоль, чтобы проверять локально.
 */
export type FunnelEvent =
  | 'constructor_open'
  | 'garment_select'
  | 'color_select'
  | 'image_upload'
  | 'image_crop'
  | 'text_add'
  | 'template_apply'
  | 'side_switch'
  | 'size_set'
  | 'sizes_copy'
  | 'color_remove'
  | 'order_form_open'
  | 'order_send'
  | 'order_success'
  | 'order_error'
  | 'pdf_download';

/**
 * Цели, которые в счётчике сайта уже заведены под другими именами: событие → идентификатор цели.
 * Остальные события уходят под своим именем.
 */
const GOAL_NAME: Partial<Record<FunnelEvent, string>> = {
  image_upload: 'design_upload',
  order_success: 'order_submit',
  order_error: 'order_send_error',
};

declare global {
  interface Window {
    ym?: (id: number, method: string, ...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export function track(event: FunnelEvent, params?: Record<string, unknown>) {
  const id = Number(process.env.NEXT_PUBLIC_YM_COUNTER_ID);
  const goal = GOAL_NAME[event] ?? event;
  try {
    if (typeof window !== 'undefined' && id && window.ym) {
      window.ym(id, 'reachGoal', goal, params);
    } else if (process.env.NODE_ENV !== 'production') {
      console.debug('[analytics]', goal, params ?? '');
    }
  } catch {
    // аналитика не должна ломать конструктор
  }
}

/** Электронная коммерция Метрики: покупка в dataLayer (работает, если в счётчике включён ecommerce). */
export function trackPurchase(order: {
  number: string; total: number; name: string;
  /** Цвета заявки: у каждого своя цена за штуку. */
  items: Array<{ productId: string; color: string; perItem: number; qty: number }>;
}) {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({
    ecommerce: {
      currencyCode: 'RUB',
      purchase: {
        actionField: { id: order.number, revenue: order.total },
        products: order.items.map((x) => ({ id: x.productId, name: order.name, variant: x.color, price: x.perItem, quantity: x.qty })),
      },
    },
  });
}
