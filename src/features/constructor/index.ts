/** Публичный вход модуля. В pnhd-studio: src/app/constructor/page.tsx → <ConstructorApp />. */
export { ConstructorApp } from './ui/ConstructorApp';
export { groupProducts, fetchCatalog } from './api/catalog';
export { calcPrice } from './model/pricing';
export type * from './model/types';
