/**
 * События воронки конструктора. Отправляются в Яндекс.Метрику сайта
 * через reachGoal. Без счётчика — пишутся в консоль, чтобы проверять локально.
 */
export type FunnelEvent =
  | 'constructor_open'
  | 'garment_select'
  | 'color_select'
  | 'image_upload'
  | 'text_add'
  | 'side_switch'
  | 'size_set'
  | 'order_form_open'
  | 'order_submit'
  | 'order_success'
  | 'order_error';

declare global {
  interface Window { ym?: (id: number, method: string, ...args: unknown[]) => void }
}

export function track(event: FunnelEvent, params?: Record<string, unknown>) {
  const id = Number(process.env.NEXT_PUBLIC_YM_COUNTER_ID);
  if (typeof window !== 'undefined' && id && window.ym) {
    window.ym(id, 'reachGoal', event, params);
  } else if (process.env.NODE_ENV !== 'production') {
    console.debug('[analytics]', event, params ?? '');
  }
}
