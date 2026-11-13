import type { GarmentType, PrintArea, Side } from '../model/types';
import { BASE_PATH } from './base-path';

/**
 * Плоские мокапы изделий: серые фото (яркость 128 = основной цвет ткани), которые
 * перекрашиваются в цвет варианта с сохранением складок. Лежат в /public/mockups.
 * Координаты зон — в системе кадра 400×460 (так размечены фото), ширина зоны — в см.
 */
export const FRAME = { w: 400, h: 460 };

export type ShapeId = 'tshirt_regular' | 'tshirt_oversize' | 'longsleeve' | 'sweatshirt' | 'hoodie' | 'ziphoodie' | 'totebag';

type Flat = 'front' | 'back';

/** Перед и спина есть у всех мокапов; рукава — только у одежды (у шоппера их нет). */
export interface GarmentShape {
  images: Record<Flat, string> & Partial<Record<Side, string>>;
  areas: Record<Flat, PrintArea> & Partial<Record<Side, PrintArea>>;
}

/** Прямоугольник в единицах кадра → доли. */
const area = (x: number, y: number, w: number, h: number, widthCm: number): PrintArea => ({
  x: x / FRAME.w, y: y / FRAME.h, width: w / FRAME.w, height: h / FRAME.h, widthCm,
});
const img = (name: string) => `${BASE_PATH}/mockups/${name}.png`;
/**
 * Мокапы рукавов — кадр 1200×1380 (3× от логического). Рукава — на виде сбоку: `<name>_side` — левый бок (перед изделия смотрит влево), `<name>_side_r` — тот же снимок
 * зеркально для правого рукава.
 */
const views = (front: string, back: string, side: string): Record<Side, string> => ({
  front: img(front), back: img(back), sleeve_left: img(`${side}_side`), sleeve_right: img(`${side}_side_r`),
});

type Outline = NonNullable<PrintArea['outline']>;

/**
 * Зона рукава на виде сбоку; правый рукав — зеркально по кадру.
 * outline — фигурная зона по форме рукава (доли рамки зоны, по часовой стрелке); для правого рукава
 * зеркалится по x, порядок точек разворачивается, чтобы обход остался по часовой.
 */
const sleeves = (x: number, y: number, w: number, h: number, widthCm: number, outline?: Outline) => ({
  sleeve_left: { ...area(x, y, w, h, widthCm), outline },
  sleeve_right: {
    ...area(FRAME.w - x - w, y, w, h, widthCm),
    outline: outline?.map(([px, py]): [number, number] => [1 - px, py]).reverse(),
  },
});

/** Рукав лонгслива: контур снят по швам на снимке (с отступом ~3 ед.) — сверху по плечевому шву, книзу сужается к манжете. */
const LONGSLEEVE_SLEEVE: Outline = [[0.052, 0.103], [0.155, 0.048], [0.328, 0.014], [0.552, 0.0], [0.81, 0.007], [0.966, 0.034], [1.0, 0.075], [0.983, 0.151], [0.931, 0.253], [0.931, 0.356], [0.914, 0.425], [0.897, 0.493], [0.862, 0.562], [0.81, 0.699], [0.741, 0.836], [0.69, 0.938], [0.655, 0.979], [0.603, 1.0], [0.241, 1.0], [0.207, 0.979], [0.19, 0.938], [0.172, 0.836], [0.155, 0.699], [0.155, 0.562], [0.138, 0.493], [0.103, 0.425], [0.086, 0.356], [0.052, 0.253], [0.0, 0.151]];
/** Короткий рукав футболки: сверху по дуге плечевого шва, снизу — над подгибкой. */
const TSHIRT_SLEEVE: Outline = [[0.0, 0.402], [0.08, 0.196], [0.227, 0.062], [0.427, 0.0], [0.653, 0.021], [0.84, 0.093], [0.973, 0.216], [1.0, 0.351], [1.0, 0.711], [1.0, 1.0], [0.0, 1.0], [0.0, 0.711]];
/** Рукав оверсайза: от спущенного плечевого шва до подгибки. */
const OVERSIZE_SLEEVE: Outline = [[0.0, 0.15], [0.133, 0.05], [0.32, 0.01], [0.613, 0.0], [0.88, 0.04], [1.0, 0.13], [1.0, 0.6], [1.0, 1.0], [0.0, 1.0], [0.0, 0.6]];
/** Рукав свитшота: контур по швам на снимке, с отступом ~3 ед.; снизу — до манжеты. */
const SWEATSHIRT_SLEEVE: Outline = [[0.044, 0.098], [0.132, 0.049], [0.309, 0.014], [0.544, 0.0], [0.779, 0.007], [0.926, 0.035], [0.985, 0.077], [1.0, 0.14], [0.985, 0.21], [0.971, 0.35], [0.941, 0.42], [0.926, 0.49], [0.912, 0.559], [0.897, 0.629], [0.882, 0.699], [0.868, 0.769], [0.838, 0.839], [0.809, 0.909], [0.779, 0.951], [0.735, 0.986], [0.691, 1.0], [0.235, 1.0], [0.191, 0.979], [0.162, 0.944], [0.132, 0.909], [0.132, 0.839], [0.103, 0.769], [0.088, 0.629], [0.074, 0.49], [0.059, 0.35], [0.044, 0.21], [0.0, 0.14]];
/** Рукав худи: контур по швам на снимке, с отступом ~3 ед. */
const HOODIE_SLEEVE: Outline = [[0.05, 0.075], [0.15, 0.035], [0.35, 0.008], [0.583, 0.0], [0.817, 0.008], [0.95, 0.035], [1.0, 0.075], [1.0, 0.154], [1.0, 0.272], [0.983, 0.35], [0.95, 0.429], [0.933, 0.508], [0.9, 0.587], [0.867, 0.665], [0.85, 0.744], [0.817, 0.823], [0.783, 0.902], [0.75, 0.949], [0.7, 0.988], [0.65, 1.0], [0.117, 1.0], [0.067, 0.98], [0.05, 0.941], [0.033, 0.862], [0.017, 0.783], [0.0, 0.665], [0.0, 0.587], [0.0, 0.508], [0.0, 0.429], [0.0, 0.272], [0.017, 0.193], [0.033, 0.134]];
/** Рукав зип-худи: контур по швам на снимке, с отступом ~3 ед. */
const ZIP_SLEEVE: Outline = [[0.017, 0.078], [0.121, 0.035], [0.328, 0.009], [0.552, 0.0], [0.793, 0.009], [0.931, 0.039], [0.983, 0.082], [1.0, 0.134], [1.0, 0.264], [0.983, 0.351], [0.983, 0.437], [0.966, 0.524], [0.948, 0.61], [0.931, 0.697], [0.897, 0.784], [0.862, 0.87], [0.828, 0.939], [0.793, 0.97], [0.741, 0.991], [0.69, 1.0], [0.19, 1.0], [0.138, 0.983], [0.121, 0.939], [0.086, 0.87], [0.069, 0.784], [0.034, 0.697], [0.017, 0.61], [0.0, 0.524], [0.0, 0.437], [0.0, 0.264], [0.0, 0.177], [0.0, 0.113]];

/**
 * Перед и спина: зона во всю ширину корпуса (≈80%, с запасом от боковых швов, 40 см) и по высоте — от ворота
 * до нижнего шва (у моделей с резинкой — до резинки). Принт крупнее формата A3+ помечается для менеджера.
 */
const HOODIE_BACK = area(123, 160, 154, 205, 40);
/**
 * Рукава худи: зона по форме рукава (контур HOODIE_SLEEVE); сантиметры — по шкале рукава (5 ед. кадра ≈ 1 см).
 */
const HOODIE_SLEEVES = sleeves(165, 131, 60, 254, 12.0, HOODIE_SLEEVE);
/** Зип-худи — свой вид сбоку и своя разметка рукава. */
const ZIP_SLEEVES = sleeves(170, 139, 58, 231, 11.6, ZIP_SLEEVE);

/**
 * Шоппер 35×40 см: одна картинка на обе стороны. Корпус сумки — 223 ед. кадра ≈ 35 см;
 * зона 29 × 27 см — ниже строчек ручек, с отступом ~3 см от боковых швов и ~2,5 см от дна.
 */
const TOTE_AREA = area(108, 222, 185, 173, 29);

export const SHAPES: Record<ShapeId, GarmentShape> = {
  totebag: {
    images: { front: img('totebag'), back: img('totebag') },
    areas: { front: TOTE_AREA, back: TOTE_AREA },
  },
  tshirt_regular: {
    images: views('tshirt_regular', 'tshirt_regular_back', 'tshirt_regular'),
    areas: { front: area(124, 85, 153, 325, 40), back: area(124, 78, 153, 332, 40), ...sleeves(175, 91, 75, 97, 15.0, TSHIRT_SLEEVE) },
  },
  tshirt_oversize: {
    images: views('tshirt_oversize', 'tshirt_oversize_back', 'tshirt_oversize'),
    areas: { front: area(111, 78, 178, 332, 46), back: area(111, 72, 178, 338, 46), ...sleeves(168, 140, 75, 100, 15.0, OVERSIZE_SLEEVE) },
  },
  longsleeve: {
    images: views('longsleeve', 'longsleeve_back', 'longsleeve'),
    areas: { front: area(120, 92, 160, 309, 47), back: area(120, 80, 160, 321, 47), ...sleeves(180, 96, 58, 292, 11.6, LONGSLEEVE_SLEEVE) },
  },
  sweatshirt: {
    images: views('sweatshirt', 'sweatshirt_back', 'sweatshirt'),
    areas: { front: area(130, 90, 140, 266, 40), back: area(130, 78, 140, 277, 40), ...sleeves(167, 100, 68, 286, 13.6, SWEATSHIRT_SLEEVE) },
  },
  hoodie: {
    images: views('hoodie', 'hoodie_back', 'hoodie'),
    // перед: от груди до верха кармана-кенгуру (на карман не печатаем)
    areas: { front: area(123, 120, 154, 142, 40), back: HOODIE_BACK, ...HOODIE_SLEEVES },
  },
  ziphoodie: {
    images: views('ziphoodie', 'hoodie_back', 'ziphoodie'),
    // на груди молния — только небольшой принт слева
    areas: { front: area(236, 135, 48, 48, 10), back: HOODIE_BACK, ...ZIP_SLEEVES },
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
    case 'totebag':
      return 'totebag';
    default:
      return null;
  }
}
