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

const HOODIE_BACK = area(120, 170, 160, 185, 32);

export const SHAPES: Record<ShapeId, GarmentShape> = {
  tshirt_regular: {
    images: { front: img('tshirt_regular'), back: img('tshirt_regular_back') },
    areas: { front: area(125, 112, 150, 282, 30), back: area(125, 90, 150, 304, 30) },
  },
  tshirt_oversize: {
    images: { front: img('tshirt_oversize'), back: img('tshirt_oversize_back') },
    areas: { front: area(125, 126, 150, 257, 30), back: area(125, 82, 150, 300, 30) },
  },
  longsleeve: {
    images: { front: img('longsleeve'), back: img('longsleeve_back') },
    areas: { front: area(130, 107, 140, 265, 28), back: area(130, 84, 140, 288, 28) },
  },
  sweatshirt: {
    images: { front: img('sweatshirt'), back: img('sweatshirt_back') },
    areas: { front: area(125, 121, 150, 228, 30), back: area(125, 92, 150, 256, 30) },
  },
  hoodie: {
    images: { front: img('hoodie'), back: img('hoodie_back') },
    areas: { front: area(130, 143, 140, 211, 28), back: HOODIE_BACK },
  },
  ziphoodie: {
    images: { front: img('ziphoodie'), back: img('hoodie_back') },
    // на груди молния — только небольшой принт слева
    areas: { front: area(218, 145, 50, 50, 10), back: HOODIE_BACK },
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
