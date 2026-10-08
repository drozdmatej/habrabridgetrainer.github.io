export function matchesSearch(text: string, query: string): boolean {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("cs").trim();
  return normalize(text).includes(normalize(query));
}
