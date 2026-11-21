// Arabic: remove tashkeel and tatweel, unify alef and yeh. Latin: remove accents.
export function normalizeText(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const toPlain = (attributes) =>
  attributes instanceof Map ? Object.fromEntries(attributes) : (attributes ?? {});

// The only text that is embedded. privateInfo is NEVER part of it: it is the owner's secret proof
// of ownership and must not influence, or leak through, any matching result.
export function buildEmbeddingText(declaration) {
  const attributeValues = Object.values(toPlain(declaration.attributes)).join(' ');
  return normalizeText(`${declaration.title}. ${declaration.description}. ${attributeValues}`);
}
