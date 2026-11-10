import type { GarmentType, PrintArea, Side } from '../model/types';

/**
 * Плоские мокапы изделий: серые фото (яркость 128 = основной цвет ткани), которые
 * перекрашиваются в цвет варианта с сохранением складок. Лежат в /public/mockups.
 * Координаты зон — в системе кадра 400×460 (так размечены фото), ширина зоны — в см.
 */
export const FRAME = { w: 400, h: 460 };

export type ShapeId = 'tshirt_regular' | 'tshirt_oversize' | 'longsleeve' | 'sweatshirt' | 'hoodie' | 'ziphoodie';

export interface GarmentShape {
  images: Record<Side, string>;
  areas: Record<Side, PrintArea>;
}

/** Прямоугольник в единицах кадра → доли. */
const area = (x: number, y: number, w: number, h: number, widthCm: number): PrintArea => ({
  x: x / FRAME.w, y: y / FRAME.h, width: w / FRAME.w, height: h / FRAME.h, widthCm,
});
const img = (name: string) => `/mockups/${name}.png`;
/** Рукава рисуются на виде спереди — отдельного фото рукава нет. */
const views = (front: string, back: string): Record<Side, string> => ({
  front: img(front), back: img(back), sleeve_left: img(front), sleeve_right: img(front),
});

/**
 * Зоны обоих рукавов на виде спереди. Правый рукав (слева на фото) — разметка из исходных данных;
 * левый — зеркально, `leftX` подгоняет его под рукав на фото (мокапы сняты не идеально симметрично).
 */
const sleeves = (x: number, y: number, w: number, h: number, widthCm: number, leftX = FRAME.w - x - w) => ({
  sleeve_right: area(x, y, w, h, widthCm),
  sleeve_left: area(leftX, y, w, h, widthCm),
});

const HOODIE_BACK = area(120, 170, 160, 185, 32);
const HOODIE_SLEEVES = sleeves(80, 165, 28, 35, 8);

export const SHAPES: Record<ShapeId, GarmentShape> = {
  tshirt_regular: {
    images: views('tshirt_regular', 'tshirt_regular_back'),
    areas: { front: area(125, 112, 150, 282, 30), back: area(125, 90, 150, 304, 30), ...sleeves(52, 140, 34, 43, 8) },
  },
  tshirt_oversize: {
    images: views('tshirt_oversize', 'tshirt_oversize_back'),
    areas: { front: area(125, 126, 150, 257, 30), back: area(125, 82, 150, 300, 30), ...sleeves(55, 150, 34, 43, 8) },
  },
  longsleeve: {
    images: views('longsleeve', 'longsleeve_back'),
    areas: { front: area(130, 107, 140, 265, 28), back: area(130, 84, 140, 288, 28), ...sleeves(84, 125, 22, 44, 6) },
  },
  sweatshirt: {
    images: views('sweatshirt', 'sweatshirt_back'),
    areas: { front: area(125, 121, 150, 228, 30), back: area(125, 92, 150, 256, 30), ...sleeves(70, 160, 34, 43, 8) },
  },
  hoodie: {
    images: views('hoodie', 'hoodie_back'),
    areas: { front: area(130, 143, 140, 211, 28), back: HOODIE_BACK, ...HOODIE_SLEEVES },
  },
  ziphoodie: {
    images: views('ziphoodie', 'hoodie_back'),
    // на груди молния — только небольшой принт слева
    areas: { front: area(218, 145, 50, 50, 10), back: HOODIE_BACK, ...HOODIE_SLEEVES },
  },
};

/** Подбор мокапа к модели из каталога сайта. null — мокапа нет, рисуем силуэт. */
export function shapeFor(type: GarmentType, modelName: string): ShapeId | null {
  const n = modelName.toLowerCase();
  switch (type) {
    case 'tshirt':
      return n.includes('oversize') ? 'tshirt_oversize' : 'tshirt_regular';
    case 'longsleeve':
      return 'longsleeve';
    case 'sweatshirt':
      return 'sweatshirt';
    case 'hoodie':
      return n.includes('зип') || n.includes('zip') ? 'ziphoodie' : 'hoodie';
    default:
      return null;
  }
}
