import { ConstructorApp } from '@/features/constructor';

/** NEXT_PUBLIC_DEMO=1 — статический стенд без серверной части: заявка не отправляется. */
const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

export default function ConstructorPage() {
  return <ConstructorApp ordersEndpoint={DEMO ? null : undefined} />;
}
