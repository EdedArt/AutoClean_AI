const { VALID_PHASES } = require('../simulation.service');

// Reference valid phase names directly from VALID_PHASES to avoid redefining
const PHASE_PENDIENTE = VALID_PHASES.find((p) => p === 'PENDIENTE') || 'PENDIENTE';
const PHASE_REMOJO = VALID_PHASES.find((p) => p === 'REMOJO') || 'REMOJO';
const PHASE_LAVADO = VALID_PHASES.find((p) => p === 'LAVADO') || 'LAVADO';
const PHASE_SECADO = VALID_PHASES.find((p) => p === 'SECADO') || 'SECADO';
const PHASE_LISTO = VALID_PHASES.find((p) => p === 'LISTO') || 'LISTO';

/**
 * Derives the verified wash phase from objective physical observations and order context
 * using a deterministic context-aware decision table.
 *
 * AutoClean AI MONITORS a car wash; it does NOT audit wash quality.
 * The AI must never flag "dirty after wash" or "quality review". Instead, the final phase
 * is decided by combining the photo observations with the order's CURRENT phase (backend history).
 * A dry car with no foam, no water and no drying activity is ambiguous on its own;
 * only the order context tells which.
 *
 * Decision Table Order:
 * 1. soapFoamVisible -> LAVADO
 * 2. waterOnCar && dryingInProgress -> SECADO
 * 3. waterOnCar && !dryingInProgress (no foam) -> REMOJO
 * 4. Dry car (!soapFoamVisible && !waterOnCar && !dryingInProgress):
 *    - if currentPhase is SECADO or LISTO -> LISTO (ignore visibleDirt and cleanAndGlossy; the wash already went through drying).
 *    - if currentPhase is PENDIENTE, REMOJO or LAVADO -> keep currentPhase (no change; the car is just dry/waiting; do not infer LISTO from how clean it looks).
 *    - if there is no currentPhase (smoke script / no order context) -> PENDIENTE if visibleDirt is not "none", otherwise PENDIENTE with lower confidence; never LISTO without context.
 * 5. Anything ambiguous -> the model's own phase with confidence capped at 0.7.
 *
 * @param {object} [observations]
 * @param {boolean} [observations.soapFoamVisible]
 * @param {boolean} [observations.waterOnCar]
 * @param {boolean} [observations.dryingInProgress]
 * @param {string} [observations.visibleDirt]
 * @param {boolean} [observations.cleanAndGlossy]
 * @param {string} [observations.observationNotes]
 * @param {object|string} [context={}] - Context object e.g. { currentPhase } or legacy string modelPhase
 * @param {string} [context.currentPhase]
 * @param {string} [context.modelPhase]
 * @param {number} [context.modelConfidence]
 * @param {string} [maybeModelPhase]
 * @param {number} [maybeModelConfidence=0.8]
 * @returns {{
 *   phase: string,
 *   confidence: number,
 *   source: "rules" | "model",
 *   reason: string
 * }}
 */
function decidePhase(observations, context = {}, maybeModelPhase, maybeModelConfidence) {
  let currentPhase = null;
  let modelPhase = null;
  let modelConfidence = 0.8;

  if (typeof context === 'string') {
    if (typeof maybeModelPhase === 'number') {
      // legacy derivePhase(observations, modelPhase, modelConfidence)
      modelPhase = context;
      modelConfidence = maybeModelPhase;
    } else {
      // decidePhase(observations, currentPhase, modelPhase, modelConfidence)
      currentPhase = context;
      modelPhase = typeof maybeModelPhase === 'string' ? maybeModelPhase : null;
      modelConfidence = typeof maybeModelConfidence === 'number' ? maybeModelConfidence : 0.8;
    }
  } else if (context && typeof context === 'object') {
    currentPhase = context.currentPhase || null;
    modelPhase = context.modelPhase || (typeof maybeModelPhase === 'string' ? maybeModelPhase : null);
    if (typeof context.modelConfidence === 'number') {
      modelConfidence = context.modelConfidence;
    } else if (typeof maybeModelConfidence === 'number') {
      modelConfidence = maybeModelConfidence;
    } else if (typeof maybeModelPhase === 'number') {
      modelConfidence = maybeModelPhase;
    }
  } else {
    modelPhase = typeof maybeModelPhase === 'string' ? maybeModelPhase : null;
    modelConfidence = typeof maybeModelConfidence === 'number' ? maybeModelConfidence : 0.8;
  }

  const safeConfidence = typeof modelConfidence === 'number' && !isNaN(modelConfidence)
    ? modelConfidence
    : 0.8;

  if (observations && typeof observations === 'object') {
    const {
      soapFoamVisible,
      waterOnCar,
      dryingInProgress,
      visibleDirt,
    } = observations;

    // 1. soapFoamVisible -> LAVADO (foam wins over everything)
    if (soapFoamVisible === true) {
      return {
        phase: PHASE_LAVADO,
        confidence: Math.min(safeConfidence, 0.95),
        source: 'rules',
        reason: 'Active soap foam or shampoo lather is visibly present on vehicle surface',
      };
    }

    // 2. waterOnCar && dryingInProgress -> SECADO
    if (waterOnCar === true && dryingInProgress === true) {
      return {
        phase: PHASE_SECADO,
        confidence: Math.min(safeConfidence, 0.95),
        source: 'rules',
        reason: 'Vehicle has water and drying process (microfiber towels/cloths/air blowers) is actively in progress',
      };
    }

    // 3. waterOnCar && !dryingInProgress (no foam) -> REMOJO
    if (waterOnCar === true && dryingInProgress === false) {
      return {
        phase: PHASE_REMOJO,
        confidence: Math.min(safeConfidence, 0.95),
        source: 'rules',
        reason: 'Water is present on the vehicle with no foam and drying is not in progress (pre-rinse/rinse stage)',
      };
    }

    // 4. Dry car (no foam, no water, not drying):
    if (soapFoamVisible === false && waterOnCar === false && dryingInProgress === false) {
      // 4a. if currentPhase is SECADO or LISTO -> LISTO (ignore visibleDirt and cleanAndGlossy; the wash already went through drying)
      if (currentPhase === PHASE_SECADO || currentPhase === PHASE_LISTO) {
        return {
          phase: PHASE_LISTO,
          confidence: Math.min(safeConfidence, 0.95),
          source: 'rules',
          reason: `dry car after ${currentPhase} -> LISTO`,
        };
      }

      // 4b. if currentPhase is PENDIENTE, REMOJO or LAVADO -> keep currentPhase (no change; the car is just dry/waiting; do not infer LISTO from how clean it looks)
      if (
        currentPhase === PHASE_PENDIENTE ||
        currentPhase === PHASE_REMOJO ||
        currentPhase === PHASE_LAVADO
      ) {
        return {
          phase: currentPhase,
          confidence: Math.min(safeConfidence, 0.95),
          source: 'rules',
          reason: `dry car during ${currentPhase} -> keep ${currentPhase}`,
        };
      }

      // 4c. if there is no currentPhase (smoke script / no order context) -> PENDIENTE if visibleDirt is not "none", otherwise PENDIENTE with lower confidence; never LISTO without context
      if (!currentPhase) {
        if (visibleDirt && visibleDirt !== 'none') {
          return {
            phase: PHASE_PENDIENTE,
            confidence: Math.min(safeConfidence, 0.95),
            source: 'rules',
            reason: 'dry car with visible dirt and no order context -> PENDIENTE',
          };
        }
        return {
          phase: PHASE_PENDIENTE,
          confidence: Math.min(safeConfidence, 0.7),
          source: 'rules',
          reason: 'dry car without order context -> PENDIENTE with lower confidence (never LISTO without context)',
        };
      }
    }
  }

  // 5. Anything ambiguous / contradictory -> fallback to model's own phase capped at 0.7
  let fallbackPhase = VALID_PHASES.includes(modelPhase) ? modelPhase : PHASE_PENDIENTE;
  // Without order context (or if order context is not SECADO or LISTO), never return LISTO
  if (fallbackPhase === PHASE_LISTO && (!currentPhase || (currentPhase !== PHASE_SECADO && currentPhase !== PHASE_LISTO))) {
    fallbackPhase = currentPhase && VALID_PHASES.includes(currentPhase) ? currentPhase : PHASE_PENDIENTE;
  }

  return {
    phase: fallbackPhase,
    confidence: Math.min(safeConfidence, 0.7),
    source: 'model',
    reason: 'Observations are ambiguous or contradictory; defaulted to model estimate with confidence capped at 0.7',
  };
}

module.exports = {
  decidePhase,
  derivePhase: decidePhase,
  PHASE_PENDIENTE,
  PHASE_REMOJO,
  PHASE_LAVADO,
  PHASE_SECADO,
  PHASE_LISTO,
};
