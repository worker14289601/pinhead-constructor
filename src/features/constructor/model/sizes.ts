/** Шкала размеров по возрастанию. Неизвестные названия идут в конец, в исходном порядке. */
const SCALE = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL', '5XL'];
const ALIAS: Record<string, string> = { '2XL': 'XXL', '3XL': 'XXXL' };

const rank = (name: string) => {
  const key = name.trim().toUpperCase();
  return SCALE.indexOf(ALIAS[key] ?? key);
};

export function sortSizes(names: string[]): string[] {
  return names
    .map((name, i) => ({ name, i, r: rank(name) }))
    .sort((a, b) => (a.r < 0 ? 1e3 : a.r) - (b.r < 0 ? 1e3 : b.r) || a.i - b.i)
    .map((x) => x.name);
}
