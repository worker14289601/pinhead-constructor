import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
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

/** Счётчик Метрики — только на стенде прототипа: на сайте он уже подключён. */
const YM_ID = Number(process.env.NEXT_PUBLIC_YM_COUNTER_ID) || 0;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0 }}>
        {children}
        {YM_ID > 0 && (
          <Script id="ym" strategy="afterInteractive">
            {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${YM_ID},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,ecommerce:"dataLayer"});`}
          </Script>
        )}
      </body>
    </html>
  );
}
