'use client';
import Script from 'next/script';
import { useEffect, useState } from 'react';
import { ANALYTICS_OFF_KEY } from '@/features/constructor';
import s from './cookie.module.css';

/** Посетитель уже ответил на уведомление — больше не показываем. */
const SEEN_KEY = 'pinhead_cookie_seen';

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // приватный режим: ответ действует до перезагрузки страницы
  }
};

/**
 * Счётчик Метрики и уведомление о cookie — только для стенда: на сайте счётчик и уведомление свои.
 * Счётчик работает, пока посетитель не отказался; после отказа не загружается, а события конструктора
 * не отправляются (см. analytics/events.ts). В режиме разработки счётчик не загружается вовсе.
 */
export function CookieNotice({ counterId, policyUrl }: { counterId: number; policyUrl?: string }) {
  // null — ещё не прочитали хранилище (первый кадр на сервере и в браузере одинаковый).
  const [state, setState] = useState<null | { seen: boolean; off: boolean }>(null);
  useEffect(() => {
    setState({ seen: read(SEEN_KEY) === '1', off: read(ANALYTICS_OFF_KEY) === '1' });
  }, []);
  if (!counterId || !state) return null;

  const answer = (off: boolean) => {
    write(SEEN_KEY, '1');
    if (off) {
      write(ANALYTICS_OFF_KEY, '1');
      // Штатный способ остановить уже загруженный счётчик Метрики.
      (window as unknown as Record<string, boolean>)[`disableYaCounter${counterId}`] = true;
    }
    setState({ seen: true, off });
  };

  return (
    <>
      {!state.off && process.env.NODE_ENV === 'production' && (
        <Script id="ym" strategy="afterInteractive">
          {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${counterId},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,ecommerce:"dataLayer"});`}
        </Script>
      )}
      {!state.seen && (
        <div className={s.notice} role="region" aria-label="Уведомление о cookie">
          <p className={s.text}>
            Мы используем cookie и Яндекс.Метрику, чтобы понимать, как улучшить конструктор.
            {policyUrl && <> Подробнее — в <a href={policyUrl} target="_blank" rel="noopener noreferrer">политике конфиденциальности</a>.</>}
          </p>
          <div className={s.actions}>
            <button type="button" className={s.ghost} onClick={() => answer(true)}>Отказаться</button>
            <button type="button" className={s.ok} onClick={() => answer(false)}>Хорошо</button>
          </div>
        </div>
      )}
    </>
  );
}
