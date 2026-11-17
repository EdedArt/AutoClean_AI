/**
 * Text normalization shared by the model catalog and the color mapper.
 * Lowercases, strips accents/diacritics and turns any non-alphanumeric run into one space.
 *
 * @example normalizeText('  Gris  PLATA-Metálico ') // 'gris plata metalico'
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Normalized text split into tokens.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function tokenize(value) {
  const text = normalizeText(value);
  return text ? text.split(' ') : [];
}

module.exports = {
  normalizeText,
  tokenize,
};
