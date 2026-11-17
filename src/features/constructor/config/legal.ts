/**
 * Ссылка на политику обработки персональных данных — показывается в согласии в форме заявки.
 * Пусто — согласие без ссылки. Задаётся при сборке переменной NEXT_PUBLIC_POLICY_URL.
 */
export const POLICY_URL = process.env.NEXT_PUBLIC_POLICY_URL ?? '';
