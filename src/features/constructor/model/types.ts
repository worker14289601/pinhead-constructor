/**
 * Доменные типы конструктора. Модуль src/features/constructor переносится
 * в pnhd-studio как есть, поэтому не зависит от остального приложения.
 */

/** Типы изделий — совпадают с полем `type` в API Pinhead. */
export type GarmentType = 'tshirt' | 'hoodie' | 'longsleeve' | 'sweatshirt' | 'totebag' | 'cap';

/**
 * Стороны нанесения. Рукава есть только у изделий с мокапом и рисуются на виде спереди.
 * Левый/правый — с точки зрения того, кто носит: на виде спереди левый рукав справа.
 */
export type Side = 'front' | 'back' | 'sleeve_left' | 'sleeve_right';
export const SIDES: Side[] = ['front', 'back', 'sleeve_left', 'sleeve_right'];
export const SIDE_LABEL: Record<Side, string> = {
  front: 'Перед', back: 'Спина', sleeve_left: 'Левый рукав', sleeve_right: 'Правый рукав',
};
/** Короткие подписи для вкладок над холстом — четыре полных не влезают в ширину телефона. */
export const SIDE_TAB: Record<Side, string> = { front: 'Перед', back: 'Спина', sleeve_left: 'Рукав Л', sleeve_right: 'Рукав П' };
export const isSleeve = (s: Side) => s === 'sleeve_left' || s === 'sleeve_right';

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
  /** Отражение по горизонтали: рисуется внутри слоя, поворот и размер от него не зависят. */
  flipX?: boolean;
}

export interface ImageLayer extends LayerBase {
  kind: 'image';
  src: string; // objectURL / dataURL загруженного файла
  fileName: string;
  /** SVG — масштабируется без потери качества, dpi не проверяем. */
  isVector: boolean;
  /** Размер рисунка в пикселях — после обрезки пустых полей, если она была. */
  naturalWidth: number;
  naturalHeight: number;
  /** Видимая часть исходной картинки без пустых полей (пиксели исходника). Нет — картинка целиком. */
  crop?: import('./trim').CropRect;
  width: number; // доля ширины зоны печати
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: string;
  fontFamily: string;
  fontSize: number; // доля ширины зоны печати
  fill: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
  /** Межстрочный шаг в долях кегля. */
  lineHeight: number;
  /** Обводка: толщина наружу в долях кегля; 0 — без обводки. */
  strokeWidth: number;
  strokeColor: string;
  /** Изгиб дугой −100…+100: 0 — прямой, плюс — горбом вверх, минус — улыбкой. */
  arc: number;
}

export type DesignLayer = ImageLayer | TextLayer;

export type SizeQuantities = Record<string, number>;

/** Метод нанесения. Клиенту даём выбор с описанием разницы. */
export type PrintMethod = 'dtf' | 'dtg';

export interface OrderContacts {
  name: string;
  phone: string;
  email: string;
  city: string;
  address?: string;
  comment?: string;
  /** Согласие на обработку персональных данных — без него заявка не отправляется. */
  consent: boolean;
}
