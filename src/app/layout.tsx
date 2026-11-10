import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Manrope, Unbounded } from 'next/font/google';

/**
 * Заменители фирменных шрифтов сайта (Neue Machina, Druk Text Wide) — только для стенда.
 * На сайте фирменные шрифты уже подключены, и конструктор берёт их по имени.
 */
const bodyFont = Manrope({ subsets: ['latin', 'cyrillic'], weight: ['400', '700', '800'], variable: '--pnhd-font-body-fallback' });
const headFont = Unbounded({ subsets: ['latin', 'cyrillic'], weight: ['700'], variable: '--pnhd-font-head-fallback' });

export const metadata: Metadata = {
  title: 'Конструктор одежды — Pinhead Studio',
  description: 'Загрузите картинку или текст, разместите на футболке, худи или шоппере и оформите заявку.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1 };

/** Счётчик Метрики — только на стенде прототипа: на сайте он уже подключён. */
const YM_ID = Number(process.env.NEXT_PUBLIC_YM_COUNTER_ID) || 0;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${bodyFont.variable} ${headFont.variable}`}>
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
