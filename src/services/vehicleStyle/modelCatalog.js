const { tokenize } = require('./normalize');

/**
 * Static body-type table for models that are popular in Colombia.
 * Keys are compact (no spaces, hyphens or accents): "CX-30" -> "cx30", "Corolla Cross" -> "corollacross".
 * Models sold in several body styles use the one most common on Colombian roads.
 * Anything not listed here falls through to the AI classifier (see bodyTypeClassifier.js).
 */
const CATALOG = {
  chevrolet: {
    spark: 'HATCHBACK', sparkgt: 'HATCHBACK', beat: 'HATCHBACK', joy: 'HATCHBACK',
    onix: 'SEDAN', sail: 'SEDAN', aveo: 'SEDAN', cruze: 'SEDAN', optra: 'SEDAN', corsa: 'SEDAN',
    tracker: 'SUV', captiva: 'SUV', equinox: 'SUV', trailblazer: 'SUV', tahoe: 'SUV', groove: 'SUV',
    blazer: 'SUV', vitara: 'SUV', grandvitara: 'SUV',
    dmax: 'PICKUP', luv: 'PICKUP', luvdmax: 'PICKUP', colorado: 'PICKUP', silverado: 'PICKUP', montana: 'PICKUP',
    n300: 'VAN', n400: 'VAN',
  },
  renault: {
    kwid: 'HATCHBACK', sandero: 'HATCHBACK', stepway: 'HATCHBACK', sanderostepway: 'HATCHBACK',
    clio: 'HATCHBACK', twingo: 'HATCHBACK', megane: 'HATCHBACK',
    logan: 'SEDAN', symbol: 'SEDAN', fluence: 'SEDAN',
    duster: 'SUV', koleos: 'SUV', captur: 'SUV', arkana: 'SUV',
    oroch: 'PICKUP', dusteroroch: 'PICKUP', alaskan: 'PICKUP',
    kangoo: 'VAN', master: 'VAN', trafic: 'VAN',
  },
  mazda: {
    2: 'HATCHBACK', 3: 'SEDAN', 6: 'SEDAN', 323: 'SEDAN', allegro: 'SEDAN',
    cx3: 'SUV', cx30: 'SUV', cx5: 'SUV', cx50: 'SUV', cx60: 'SUV', cx7: 'SUV', cx9: 'SUV', cx90: 'SUV',
    bt50: 'PICKUP',
  },
  kia: {
    picanto: 'HATCHBACK', rio: 'SEDAN', soluto: 'SEDAN', cerato: 'SEDAN', k3: 'SEDAN',
    sportage: 'SUV', sorento: 'SUV', seltos: 'SUV', sonet: 'SUV', stonic: 'SUV', niro: 'SUV', ev6: 'SUV',
    carnival: 'VAN',
  },
  hyundai: {
    i10: 'HATCHBACK', grandi10: 'HATCHBACK', atos: 'HATCHBACK', i20: 'HATCHBACK',
    i25: 'SEDAN', accent: 'SEDAN', elantra: 'SEDAN',
    tucson: 'SUV', creta: 'SUV', santafe: 'SUV', kona: 'SUV', venue: 'SUV', ix35: 'SUV', palisade: 'SUV',
    h1: 'VAN', staria: 'VAN',
  },
  toyota: {
    yaris: 'HATCHBACK',
    corolla: 'SEDAN', camry: 'SEDAN',
    corollacross: 'SUV', fortuner: 'SUV', prado: 'SUV', landcruiser: 'SUV', rav4: 'SUV', chr: 'SUV',
    fjcruiser: 'SUV', '4runner': 'SUV', raize: 'SUV',
    hilux: 'PICKUP', tacoma: 'PICKUP', tundra: 'PICKUP',
    hiace: 'VAN',
  },
  nissan: {
    march: 'HATCHBACK', tiida: 'HATCHBACK', note: 'HATCHBACK',
    versa: 'SEDAN', sentra: 'SEDAN', almera: 'SEDAN',
    kicks: 'SUV', qashqai: 'SUV', xtrail: 'SUV', murano: 'SUV', pathfinder: 'SUV', patrol: 'SUV',
    frontier: 'PICKUP', navara: 'PICKUP', np300: 'PICKUP',
    urvan: 'VAN',
  },
  suzuki: {
    swift: 'HATCHBACK', alto: 'HATCHBACK', celerio: 'HATCHBACK', baleno: 'HATCHBACK', spresso: 'HATCHBACK',
    dzire: 'SEDAN', ciaz: 'SEDAN',
    vitara: 'SUV', grandvitara: 'SUV', jimny: 'SUV', scross: 'SUV',
  },
  volkswagen: {
    gol: 'HATCHBACK', polo: 'HATCHBACK', golf: 'HATCHBACK', up: 'HATCHBACK',
    voyage: 'SEDAN', virtus: 'SEDAN', jetta: 'SEDAN', vento: 'SEDAN',
    nivus: 'SUV', tcross: 'SUV', taos: 'SUV', tiguan: 'SUV', touareg: 'SUV',
    amarok: 'PICKUP', saveiro: 'PICKUP',
    crafter: 'VAN', transporter: 'VAN',
  },
  ford: {
    fiesta: 'HATCHBACK', focus: 'HATCHBACK', ka: 'HATCHBACK',
    fusion: 'SEDAN', mustang: 'SEDAN',
    ecosport: 'SUV', escape: 'SUV', explorer: 'SUV', edge: 'SUV', territory: 'SUV', bronco: 'SUV',
    expedition: 'SUV',
    ranger: 'PICKUP', f150: 'PICKUP', maverick: 'PICKUP',
    transit: 'VAN',
  },
  mitsubishi: {
    mirage: 'HATCHBACK', lancer: 'SEDAN',
    montero: 'SUV', monterosport: 'SUV', outlander: 'SUV', asx: 'SUV', eclipsecross: 'SUV', nativa: 'SUV',
    l200: 'PICKUP',
  },
  isuzu: { dmax: 'PICKUP' },
  jeep: {
    wrangler: 'SUV', compass: 'SUV', renegade: 'SUV', cherokee: 'SUV', grandcherokee: 'SUV', commander: 'SUV',
    gladiator: 'PICKUP',
  },
  honda: {
    fit: 'HATCHBACK',
    civic: 'SEDAN', city: 'SEDAN', accord: 'SEDAN',
    crv: 'SUV', hrv: 'SUV', wrv: 'SUV', pilot: 'SUV',
  },
  peugeot: {
    208: 'HATCHBACK', 206: 'HATCHBACK', 207: 'HATCHBACK',
    301: 'SEDAN', 308: 'HATCHBACK', 408: 'SEDAN',
    2008: 'SUV', 3008: 'SUV', 5008: 'SUV',
    partner: 'VAN', expert: 'VAN',
  },
  citroen: { c3: 'HATCHBACK', c3aircross: 'SUV', c4cactus: 'SUV', c5aircross: 'SUV', berlingo: 'VAN' },
  fiat: {
    mobi: 'HATCHBACK', argo: 'HATCHBACK', uno: 'HATCHBACK', palio: 'HATCHBACK', 500: 'HATCHBACK',
    cronos: 'SEDAN', siena: 'SEDAN',
    pulse: 'SUV', fastback: 'SUV',
    strada: 'PICKUP', toro: 'PICKUP',
    fiorino: 'VAN', ducato: 'VAN',
  },
  byd: {
    dolphin: 'HATCHBACK', dolphinmini: 'HATCHBACK', seagull: 'HATCHBACK',
    seal: 'SEDAN', han: 'SEDAN',
    yuan: 'SUV', yuanplus: 'SUV', atto3: 'SUV', song: 'SUV', songplus: 'SUV', tang: 'SUV',
    shark: 'PICKUP',
  },
  chery: { tiggo: 'SUV', tiggo2: 'SUV', tiggo4: 'SUV', tiggo7: 'SUV', tiggo8: 'SUV' },
  subaru: { impreza: 'HATCHBACK', forester: 'SUV', xv: 'SUV', crosstrek: 'SUV', outback: 'SUV' },
  mercedesbenz: { gla: 'SUV', glb: 'SUV', glc: 'SUV', gle: 'SUV', sprinter: 'VAN', vito: 'VAN' },
  bmw: { x1: 'SUV', x2: 'SUV', x3: 'SUV', x4: 'SUV', x5: 'SUV', x6: 'SUV' },
  audi: { a1: 'HATCHBACK', a3: 'SEDAN', a4: 'SEDAN', a6: 'SEDAN', q2: 'SUV', q3: 'SUV', q5: 'SUV', q7: 'SUV' },
  volvo: { xc40: 'SUV', xc60: 'SUV', xc90: 'SUV' },
  ram: { 700: 'PICKUP', 1000: 'PICKUP', 1500: 'PICKUP', 2500: 'PICKUP' },
  dodge: { journey: 'SUV' },
  greatwall: { poer: 'PICKUP', wingle: 'PICKUP', haval: 'SUV', h6: 'SUV' },
  jac: { t6: 'PICKUP', t8: 'PICKUP' },
};

/** Common spellings of brand names, mapped to the CATALOG key (compact form). */
const BRAND_ALIASES = {
  chevy: 'chevrolet',
  vw: 'volkswagen',
  mercedes: 'mercedesbenz',
  benz: 'mercedesbenz',
  gwm: 'greatwall',
  haval: 'greatwall',
};

/** Model keys that appear under exactly one brand (used when the brand is misspelled). */
const UNIQUE_MODEL_INDEX = (() => {
  const seen = new Map();
  for (const [brand, models] of Object.entries(CATALOG)) {
    for (const [model, bodyType] of Object.entries(models)) {
      if (model.length < 3 || /^\d+$/.test(model)) continue; // "3", "208" are too ambiguous alone
      const prev = seen.get(model);
      if (prev === undefined) {
        seen.set(model, { brand, bodyType });
      } else if (prev && prev.bodyType !== bodyType) {
        seen.set(model, null); // ambiguous across brands
      }
    }
  }
  const index = new Map();
  for (const [model, entry] of seen) {
    if (entry) index.set(model, entry.bodyType);
  }
  return index;
})();

/**
 * Normalized brand key: "Mercedes-Benz" -> "mercedesbenz", "Chevy" -> "chevrolet".
 *
 * @param {unknown} brand
 * @returns {string}
 */
function normalizeBrandKey(brand) {
  const compact = tokenize(brand).join('');
  return BRAND_ALIASES[compact] || compact;
}

/**
 * Candidate model keys, longest first, built from token prefixes of the model.
 * "Corolla Cross XEi" -> ["corollacrossxei", "corollacross", "corolla"];
 * the brand is stripped when the model repeats it ("Mazda 3" under Mazda -> "3").
 *
 * @param {string} brandKey
 * @param {unknown} model
 * @returns {string[]}
 */
function modelCandidates(brandKey, model) {
  let tokens = tokenize(model);

  // Strip a repeated brand prefix ("Mazda 3", "Renault Kwid", "Mercedes Benz GLC", "Mazda3")
  if (brandKey) {
    let stripped = false;
    for (let k = Math.min(3, tokens.length - 1); k >= 1; k--) {
      if (normalizeBrandKey(tokens.slice(0, k).join(' ')) === brandKey) {
        tokens = tokens.slice(k);
        stripped = true;
        break;
      }
    }
    const first = tokens[0] || '';
    if (!stripped && first.startsWith(brandKey) && first.length > brandKey.length) {
      tokens = [first.slice(brandKey.length), ...tokens.slice(1)];
    }
  }

  const candidates = [];
  for (let len = tokens.length; len >= 1; len--) {
    candidates.push(tokens.slice(0, len).join(''));
  }
  return candidates;
}

/**
 * Looks up a body type in the static table (accent and case insensitive).
 *
 * @param {unknown} brand
 * @param {unknown} model
 * @returns {string|null} One of BODY_TYPES, or null if the model is not in the table
 */
function lookupBodyType(brand, model) {
  const brandKey = normalizeBrandKey(brand);
  const brandModels = CATALOG[brandKey];
  const candidates = modelCandidates(brandKey, model);

  if (brandModels) {
    for (const key of candidates) {
      if (Object.prototype.hasOwnProperty.call(brandModels, key)) {
        return brandModels[key];
      }
    }
  }

  for (const key of candidates) {
    if (UNIQUE_MODEL_INDEX.has(key)) {
      return UNIQUE_MODEL_INDEX.get(key);
    }
  }
  return null;
}

/**
 * Stable cache key for a brand + model pair ("Mazda", "CX-30" -> "mazda|cx30").
 *
 * @param {unknown} brand
 * @param {unknown} model
 * @returns {string}
 */
function catalogKey(brand, model) {
  return `${normalizeBrandKey(brand)}|${tokenize(model).join('')}`;
}

module.exports = {
  CATALOG,
  lookupBodyType,
  catalogKey,
  normalizeBrandKey,
};
