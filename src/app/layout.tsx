import type { Metadata, Viewport } from 'next';
import { CookieNotice } from './CookieNotice';
import './fonts.css';

/**
 * Заменители фирменных шрифтов сайта (Neue Machina, Druk Text Wide) — только для стенда, см. fonts.css.
 * На сайте фирменные шрифты уже подключены, и конструктор берёт их по имени.
 */

export const metadata: Metadata = {
  title: 'Конструктор одежды — Pinhead Studio',
  description: 'Загрузите картинку или текст, разместите на футболке, худи или шоппере и оформите заявку.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1 };

/** Счётчик Метрики и уведомление о cookie — только на стенде прототипа: на сайте они свои. */
const YM_ID = Number(process.env.NEXT_PUBLIC_YM_COUNTER_ID) || 0;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0 }}>
        {children}
        <CookieNotice counterId={YM_ID} policyUrl={process.env.NEXT_PUBLIC_POLICY_URL || undefined} />
      </body>
    </html>
  );
}
