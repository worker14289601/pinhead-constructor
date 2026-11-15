import type { TextLayer } from '../model/types';

/**
 * Готовые принты: наборы текстовых слоёв, которые одним нажатием заменяют дизайн текущей стороны.
 * Цвет в шаблоне не хранится: слой помечен тоном, а конкретный цвет выбирается по ткани (templateFill).
 */
export type TemplateTone = 'main' | 'accent';

/** Слой шаблона — текстовый слой без id, стороны и цвета; x/y — центр надписи в долях зоны печати. */
export type TemplateLayer = Omit<TextLayer, 'id' | 'side' | 'kind' | 'fill'> & { tone: TemplateTone };

export interface PrintTemplate {
  id: string;
  title: string;
  category: string;
  layers: TemplateLayer[];
}

export const TEMPLATE_CATEGORIES = ['Команда', 'Праздник', 'Имя и номер', 'Надписи'] as const;

/** Цвет слоя по тону и ткани: основной — светлый на тёмной ткани и тёмный на светлой; акцент — лайм или тёмно-зелёный. */
export function templateFill(tone: TemplateTone, lightFabric: boolean): string {
  if (tone === 'main') return lightFabric ? '#111111' : '#ffffff';
  return lightFabric ? '#2f6b00' : '#99ff00';
}

/** Слой с типовыми значениями; в шаблонах переопределяется только то, что отличается. */
const t = (p: Pick<TemplateLayer, 'text' | 'fontFamily' | 'fontSize' | 'y'> & Partial<TemplateLayer>): TemplateLayer => ({
  align: 'center', bold: false, italic: false, lineHeight: 1.1, strokeWidth: 0, strokeColor: '#000000',
  arc: 0, x: 0.5, rotation: 0, tone: 'main', ...p,
});

export const TEMPLATES: PrintTemplate[] = [
  {
    id: 'team-word', title: 'Команда', category: 'Команда',
    layers: [
      t({ text: 'КОМАНДА', fontFamily: 'Unbounded', bold: true, fontSize: 0.13, y: 0.36 }),
      t({ text: 'вместе мы сильнее', fontFamily: 'Montserrat', fontSize: 0.06, y: 0.5, tone: 'accent' }),
    ],
  },
  {
    id: 'squad', title: 'Squad', category: 'Команда',
    layers: [t({ text: 'SQUAD', fontFamily: 'Rubik Mono One', fontSize: 0.16, y: 0.4 })],
  },
  {
    id: 'team-arc', title: 'Команда дугой', category: 'Команда',
    layers: [
      t({ text: 'НАША КОМАНДА', fontFamily: 'Montserrat', bold: true, fontSize: 0.07, y: 0.24, arc: 70 }),
      t({ text: '2026', fontFamily: 'Unbounded', bold: true, fontSize: 0.2, y: 0.5, tone: 'accent' }),
    ],
  },
  {
    id: 'birthday-ru', title: 'С днём рождения', category: 'Праздник',
    layers: [t({ text: 'С днём\nрождения', fontFamily: 'Lobster', fontSize: 0.13, y: 0.4, lineHeight: 1.05 })],
  },
  {
    id: 'birthday-en', title: 'Happy Birthday', category: 'Праздник',
    layers: [
      t({ text: 'HAPPY\nBIRTHDAY', fontFamily: 'Russo One', fontSize: 0.13, y: 0.38, lineHeight: 1.05 }),
      t({ text: 'make a wish', fontFamily: 'Caveat', bold: true, fontSize: 0.08, y: 0.6, tone: 'accent' }),
    ],
  },
  {
    id: 'name-number', title: 'Имя и номер', category: 'Имя и номер',
    layers: [
      t({ text: 'ИВАНОВ', fontFamily: 'Oswald', bold: true, fontSize: 0.14, y: 0.2 }),
      t({ text: '10', fontFamily: 'Oswald', bold: true, fontSize: 0.5, y: 0.52, tone: 'accent' }),
    ],
  },
  {
    id: 'name-number-arc', title: 'Имя дугой и номер', category: 'Имя и номер',
    layers: [
      t({ text: 'SMIRNOV', fontFamily: 'Montserrat', bold: true, fontSize: 0.09, y: 0.2, arc: 60 }),
      t({ text: '07', fontFamily: 'Russo One', fontSize: 0.42, y: 0.5, tone: 'accent' }),
    ],
  },
  {
    id: 'founded', title: 'Год основания', category: 'Надписи',
    layers: [
      t({ text: 'ОСНОВАНО В', fontFamily: 'Montserrat', bold: true, fontSize: 0.05, y: 0.3 }),
      t({ text: '2026', fontFamily: 'Playfair Display', bold: true, fontSize: 0.24, y: 0.43, tone: 'accent' }),
    ],
  },
  {
    id: 'slogan-ru', title: 'Делаем с душой', category: 'Надписи',
    layers: [t({ text: 'Делаем\nс душой', fontFamily: 'Caveat', bold: true, fontSize: 0.17, y: 0.4, lineHeight: 1 })],
  },
  {
    id: 'hello-summer', title: 'Hello, summer', category: 'Надписи',
    layers: [
      t({ text: 'Hello,\nsummer', fontFamily: 'Lobster', fontSize: 0.15, y: 0.38, lineHeight: 1.05, rotation: -6 }),
    ],
  },
  {
    id: 'limited', title: 'Limited edition', category: 'Надписи',
    layers: [
      t({ text: 'LIMITED EDITION', fontFamily: 'Montserrat', bold: true, fontSize: 0.065, y: 0.24, arc: 70 }),
      t({ text: '№001', fontFamily: 'Oswald', bold: true, fontSize: 0.22, y: 0.48, tone: 'accent' }),
    ],
  },
];
