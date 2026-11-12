import { shapeFor } from '../config/garment-shapes';
import { sortSizes } from '../model/sizes';
import type { ApiProduct, Garment, GarmentType, GarmentVariant } from '../model/types';

export const PNHD_API_URL = process.env.NEXT_PUBLIC_PNHD_API_URL ?? 'https://api.pnhd.ru';

const SUPPORTED: GarmentType[] = ['tshirt', 'longsleeve', 'sweatshirt', 'hoodie', 'totebag', 'cap'];

/** Цвета без stageColor в API — запасная палитра по названию. */
const COLOR_FALLBACK: Record<string, string> = {
  белый: '#ffffff', черный: '#2b2b2b', розовый: '#f4c2c9', молочный: '#f8f4ea', серый: '#9a9a9a',
};

/** «Футболка OVERSIZE черная» → «Футболка OVERSIZE». В API цвета — отдельные товары без общего id модели. */
export function modelNameOf(p: ApiProduct): string {
  const words = p.name.trim().split(/\s+/);
  return words.length > 2 ? words.slice(0, -1).join(' ') : p.name;
}

/**
 * Цвета, у которых stageColor из API не похож на ткань на плоском мокапе
 * (подобран под освещение 3D-сцены): чёрный там #424242 и выглядит тёмно-серым.
 */
const COLOR_OVERRIDE: Record<string, string> = {
  черный: '#1c1c1c',
};

/** Чистит описание из API: двойные пробелы, «bag.35x40» без пробела после точки. */
const tidy = (s = '') => s.replace(/([a-zа-яё])\.(?=[A-ZА-ЯЁ0-9])/gi, '$1. ').replace(/\s+/g, ' ').trim();

function toVariant(p: ApiProduct): GarmentVariant {
  const name = p.color.toLowerCase().replace('ё', 'е');
  const hex = COLOR_OVERRIDE[name] || p.stageColor || COLOR_FALLBACK[name] || '#d9d9d9';
  // editor_*_view в API — относительные пути, которые сейчас отдают 404; берём только абсолютные URL.
  const abs = (u: string) => (u?.startsWith('http') ? u : undefined);
  return {
    productId: p._id,
    colorName: p.color,
    hex,
    price: p.price,
    sizes: sortSizes(p.sizes.map((s) => s.name)),
    description: tidy(p.description),
    mockups: { front: abs(p.editor_front_view), back: abs(p.editor_back_view) },
  };
}

/** Группирует товары API в модели с цветами. Только isForPrinting. */
export function groupProducts(products: ApiProduct[]): Garment[] {
  const map = new Map<string, Garment>();
  for (const p of products) {
    if (!p.isForPrinting || !SUPPORTED.includes(p.type)) continue;
    const name = modelNameOf(p);
    const id = `${p.type}:${name.toLowerCase()}`;
    const g = map.get(id) ?? { id, type: p.type, name, shapeId: shapeFor(p.type, name), basePrice: p.price, variants: [] };
    g.variants.push(toVariant(p));
    g.basePrice = Math.min(g.basePrice, p.price);
    map.set(id, g);
  }
  return [...map.values()].sort(
    (a, b) => SUPPORTED.indexOf(a.type) - SUPPORTED.indexOf(b.type) || a.basePrice - b.basePrice,
  );
}

export async function fetchCatalog(signal?: AbortSignal): Promise<Garment[]> {
  const res = await fetch(`${PNHD_API_URL}/api/products`, { signal });
  if (!res.ok) throw new Error(`Каталог недоступен: ${res.status}`);
  const json = (await res.json()) as { data: ApiProduct[] };
  return groupProducts(json.data);
}
