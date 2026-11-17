const env = require('../../config/env');
const { isBodyType } = require('./bodyTypes');
const { lookupBodyType, catalogKey } = require('./modelCatalog');

/**
 * Body-type classification for vehicle registration. It never throws and never fails
 * a registration: 1) static catalog, 2) AI provider with a hard timeout,
 * 3) null. Valid AI answers (including "unknown") are cached per brand+model; failures and
 * timeouts are not cached, so a later registration can try again.
 */

const CACHE_MAX_ENTRIES = 500;
const cache = new Map(); // catalogKey -> bodyType|null
const inFlight = new Map(); // catalogKey -> Promise<bodyType|null>

let customProvider; // undefined = default resolution, null = AI disabled

/** Injects a provider ({ name, classifyBodyType }) or null to disable AI (tests). */
function setBodyTypeProvider(provider) {
  customProvider = provider;
}

function resetBodyTypeProvider() {
  customProvider = undefined;
}

function clearBodyTypeCache() {
  cache.clear();
  inFlight.clear();
}

/** Default provider: Gemini when the AI subsystem would use it, otherwise no AI. */
function resolveProvider() {
  if (customProvider !== undefined) return customProvider;
  const hasKey = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim() !== '');
  if (env.AI_MODE === 'simulated' || !hasKey) return null;
  return require('../ai/geminiBodyTypeProvider');
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value); // drop the oldest entry
  }
  cache.set(key, value);
}

/**
 * Runs the provider with a hard timeout. Resolves null on timeout, error or invalid output.
 *
 * @returns {Promise<{ bodyType: string|null, ok: boolean }>}
 */
async function askProvider(provider, brand, model) {
  const timeoutMs = env.VEHICLE_CLASSIFIER_TIMEOUT_MS;
  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve({ bodyType: null, ok: false, reason: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);
  });

  const call = Promise.resolve()
    .then(() => provider.classifyBodyType({ brand, model, signal: controller.signal }))
    .then((value) => {
      if (value === null) return { bodyType: null, ok: true };
      if (isBodyType(value)) return { bodyType: value, ok: true };
      return { bodyType: null, ok: false, reason: 'invalid provider output' };
    })
    .catch((err) => ({ bodyType: null, ok: false, reason: err && err.message ? err.message : 'error' }));

  try {
    const outcome = await Promise.race([call, timeout]);
    if (!outcome.ok) {
      console.warn(`[VehicleStyle] Body-type classification unavailable (${outcome.reason}); leaving it null.`);
    }
    return outcome;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Classifies a brand + model into one of BODY_TYPES, or null.
 *
 * @param {string} brand
 * @param {string} model
 * @returns {Promise<{ bodyType: string|null, source: 'catalog'|'cache'|'ai'|'none' }>}
 */
async function classifyBodyType(brand, model) {
  try {
    const fromCatalog = lookupBodyType(brand, model);
    if (fromCatalog) return { bodyType: fromCatalog, source: 'catalog' };

    const key = catalogKey(brand, model);
    if (cache.has(key)) return { bodyType: cache.get(key), source: 'cache' };

    const provider = resolveProvider();
    if (!provider || typeof provider.classifyBodyType !== 'function') {
      return { bodyType: null, source: 'none' };
    }

    let pending = inFlight.get(key);
    if (!pending) {
      pending = askProvider(provider, brand, model).then((outcome) => {
        if (outcome.ok) cacheSet(key, outcome.bodyType);
        return outcome.bodyType;
      });
      inFlight.set(key, pending);
      pending.finally(() => inFlight.delete(key)).catch(() => {});
    }
    const bodyType = await pending;
    return { bodyType, source: bodyType ? 'ai' : 'none' };
  } catch (err) {
    console.warn(`[VehicleStyle] Body-type classification failed: ${err && err.message}`);
    return { bodyType: null, source: 'none' };
  }
}

module.exports = {
  classifyBodyType,
  setBodyTypeProvider,
  resetBodyTypeProvider,
  clearBodyTypeCache,
  CACHE_MAX_ENTRIES,
};
