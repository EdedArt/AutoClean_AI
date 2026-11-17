const { tokenize } = require('./normalize');

/**
 * Free-text vehicle color -> display hex.
 *
 * KEEP IN SYNC with Frontend/src/lib/vehicleColor.ts (same keys, words and hex values):
 * the backend sends `colorHex`, the app uses the same table to show a translated color name.
 */

/** Neutral gray used when the color text is not recognized. */
const FALLBACK_COLOR_HEX = '#9CA3AF';

/** Canonical color keys and their paint hex. */
const COLOR_HEX = Object.freeze({
  white: '#F8FAFC',
  black: '#111827',
  silver: '#C0C6CE',
  gray: '#6B7280',
  darkGray: '#374151',
  lightGray: '#B8BEC6',
  red: '#C62828',
  wine: '#7B1E2B',
  blue: '#1E5BB8',
  darkBlue: '#1E2F5C',
  lightBlue: '#6FB3E8',
  green: '#2E7D32',
  darkGreen: '#1B4D2E',
  lightGreen: '#7CC47F',
  yellow: '#F2C230',
  orange: '#EF7D22',
  brown: '#6D4C3D',
  beige: '#D8C7A5',
  gold: '#C9A646',
  purple: '#6A3FA0',
  pink: '#E58FB5',
  champagne: '#E3D3B0',
  bronze: '#8C6239',
});

/** Base color words (Spanish with gender variants, and English), already accent-free. */
const BASE_WORDS = {
  blanco: 'white', blanca: 'white', white: 'white',
  negro: 'black', negra: 'black', black: 'black',
  plata: 'silver', plateado: 'silver', plateada: 'silver', silver: 'silver',
  gris: 'gray', gray: 'gray', grey: 'gray',
  grafito: 'darkGray', graphite: 'darkGray',
  rojo: 'red', roja: 'red', red: 'red',
  vinotinto: 'wine', vino: 'wine', granate: 'wine', burdeos: 'wine', burgundy: 'wine', maroon: 'wine', wine: 'wine',
  azul: 'blue', blue: 'blue',
  celeste: 'lightBlue',
  verde: 'green', green: 'green',
  amarillo: 'yellow', amarilla: 'yellow', yellow: 'yellow',
  naranja: 'orange', anaranjado: 'orange', anaranjada: 'orange', orange: 'orange',
  cafe: 'brown', marron: 'brown', brown: 'brown',
  beige: 'beige', beis: 'beige', crema: 'beige', cream: 'beige',
  dorado: 'gold', dorada: 'gold', oro: 'gold', gold: 'gold', golden: 'gold',
  morado: 'purple', morada: 'purple', violeta: 'purple', lila: 'purple', purple: 'purple', violet: 'purple',
  rosado: 'pink', rosada: 'pink', rosa: 'pink', fucsia: 'pink', pink: 'pink',
  champana: 'champagne', champan: 'champagne', champagne: 'champagne',
  bronce: 'bronze', bronze: 'bronze',
};

const DARK_WORDS = new Set(['oscuro', 'oscura', 'dark', 'marino', 'navy']);
const LIGHT_WORDS = new Set(['claro', 'clara', 'light']);
/** Finish words: recognized but they do not change the color. */
const FINISH_WORDS = new Set([
  'metalico', 'metalica', 'metalizado', 'metalizada', 'metallic',
  'perlado', 'perlada', 'perla', 'pearl', 'perlescent',
  'mate', 'matte', 'brillante', 'glossy', 'solido', 'solida', 'solid',
]);

/** Dark/light variants for the bases that have them ("azul oscuro" -> darkBlue). */
const SHADE_VARIANTS = {
  gray: { dark: 'darkGray', light: 'lightGray' },
  blue: { dark: 'darkBlue', light: 'lightBlue' },
  green: { dark: 'darkGreen', light: 'lightGreen' },
  red: { dark: 'wine' },
};

/**
 * Maps a free-text color ("Blanca", "gris plata", "Azul Oscuro Metálico", "dark blue") to a hex.
 *
 * - `isKnown`: a base color was recognized, so `hex` reflects the real paint.
 * - `exact`: every word was recognized and only one base color appeared, so the
 *   canonical `key` can be shown translated instead of the typed text.
 *
 * @param {unknown} text
 * @returns {{ key: string|null, hex: string, isKnown: boolean, exact: boolean }}
 */
function mapColor(text) {
  const tokens = tokenize(text);
  const bases = [];
  let dark = false;
  let light = false;
  let unknownWords = 0;

  for (const token of tokens) {
    if (BASE_WORDS[token]) {
      bases.push(BASE_WORDS[token]);
    } else if (DARK_WORDS.has(token)) {
      dark = true;
    } else if (LIGHT_WORDS.has(token)) {
      light = true;
    } else if (!FINISH_WORDS.has(token)) {
      unknownWords += 1;
    }
  }

  if (bases.length === 0) {
    return { key: null, hex: FALLBACK_COLOR_HEX, isKnown: false, exact: false };
  }

  // "gris plata" / "plata gris" is silver
  let key = bases.includes('silver') && bases.every((b) => b === 'silver' || b === 'gray') ? 'silver' : bases[0];
  const distinctBases = new Set(bases.map((b) => (b === 'gray' && key === 'silver' ? 'silver' : b)));

  const variants = SHADE_VARIANTS[key];
  if (variants) {
    if (dark && !light && variants.dark) key = variants.dark;
    else if (light && !dark && variants.light) key = variants.light;
  }

  return {
    key,
    hex: COLOR_HEX[key],
    isKnown: true,
    exact: unknownWords === 0 && distinctBases.size === 1,
  };
}

module.exports = {
  mapColor,
  COLOR_HEX,
  FALLBACK_COLOR_HEX,
};
