import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Конструктор одежды — Pinhead Studio',
  description: 'Загрузите картинку или текст, разместите на футболке, худи или шоппере и оформите заявку.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
