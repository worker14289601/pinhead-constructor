/**
 * Доменные типы конструктора. Модуль src/features/constructor переносится
 * в pnhd-studio как есть, поэтому не зависит от остального приложения.
 */

/** Типы изделий — совпадают с полем `type` в API Pinhead. */
export type GarmentType = 'tshirt' | 'hoodie' | 'longsleeve' | 'sweatshirt' | 'totebag' | 'cap';

/** Стороны нанесения: перед и спина. Рукава — позже. */
export type Side = 'front' | 'back';
export const SIDES: Side[] = ['front', 'back'];
export const SIDE_LABEL: Record<Side, string> = { front: 'Перед', back: 'Спина' };

/** Товар в том виде, в каком его отдаёт GET {API}/api/products (подмножество IProduct из pnhd-studio). */
export interface ApiProduct {
  _id: string;
  slug: string;
  name: string;
  type: GarmentType;
  price: number;
  color: string;
  stageColor?: string;
  isForPrinting: boolean;
  photos: string[];
  editor_front_view: string;
  editor_back_view: string;
  sizes: Array<{ name: string; qty: number }>;
  order?: number;
}

/** Цветовой вариант модели = один товар из API. */
export interface GarmentVariant {
  productId: string;
  colorName: string;
  hex: string;
  price: number;
  sizes: string[];
  /** Плоские мокапы для редактора; пусто — рисуем векторный силуэт. */
  mockups: Partial<Record<Side, string>>;
}

/** Модель изделия (например «Футболка OVERSIZE») со всеми цветами. */
export interface Garment {
  id: string;
  type: GarmentType;
  /** Ключ плоского мокапа (config/garment-shapes). null — мокапа нет. */
  shapeId: import('../config/garment-shapes').ShapeId | null;
  name: string;
  basePrice: number;
  variants: GarmentVariant[];
}

/** Зона печати в координатах мокапа (доли 0..1 от ширины/высоты холста изделия). */
export interface PrintArea {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Реальная ширина зоны в сантиметрах — нужна для расчёта DPI и формата (A4/A3...). */
  widthCm: number;
}

interface LayerBase {
  id: string;
  side: Side;
  /** Позиция и размер в долях зоны печати (0..1) — не зависят от размера экрана. */
  x: number;
  y: number;
  rotation: number;
}

export interface ImageLayer extends LayerBase {
  kind: 'image';
  src: string; // objectURL / dataURL загруженного файла
  fileName: string;
  /** SVG — масштабируется без потери качества, dpi не проверяем. */
  isVector: boolean;
  naturalWidth: number;
  naturalHeight: number;
  width: number; // доля ширины зоны печати
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: string;
  fontFamily: string;
  fontSize: number; // доля ширины зоны печати
  fill: string;
  align: 'left' | 'center' | 'right';
}

export type DesignLayer = ImageLayer | TextLayer;

export type SizeQuantities = Record<string, number>;

/** Метод нанесения. Клиенту даём выбор с описанием разницы. */
export type PrintMethod = 'dtf' | 'dtg';

export interface OrderContacts {
  name: string;
  phone: string;
  email?: string;
  telegram?: string;
  delivery: 'pickup' | 'cdek';
  city?: string;
  comment?: string;
}
