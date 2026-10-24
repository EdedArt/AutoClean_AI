const { VALID_PHASES } = require('../simulation.service');

// Reference valid phase names directly from VALID_PHASES to avoid redefining
const PHASE_PENDIENTE = VALID_PHASES.find((p) => p === 'PENDIENTE') || 'PENDIENTE';
const PHASE_REMOJO = VALID_PHASES.find((p) => p === 'REMOJO') || 'REMOJO';
const PHASE_LAVADO = VALID_PHASES.find((p) => p === 'LAVADO') || 'LAVADO';
const PHASE_SECADO = VALID_PHASES.find((p) => p === 'SECADO') || 'SECADO';
const PHASE_LISTO = VALID_PHASES.find((p) => p === 'LISTO') || 'LISTO';

/**
 * Derives the verified wash phase from objective physical observations
 * using a deterministic decision table.
 *
 * Decision Table Order:
 * 1. soapFoamVisible -> LAVADO (foam wins over everything)
 * 2. waterOnCar && dryingInProgress -> SECADO
 * 3. waterOnCar && !dryingInProgress -> REMOJO
 * 4. !waterOnCar && visibleDirt === "none" && cleanAndGlossy -> LISTO
 * 5. !waterOnCar && (visibleDirt is "light" or "heavy") && !cleanAndGlossy -> PENDIENTE
 * 6. anything else (contradictory or ambiguous) -> model's own phase, capped at 0.7
 *
 * @param {object} [observations]
 * @param {boolean} [observations.soapFoamVisible]
 * @param {boolean} [observations.waterOnCar]
 * @param {boolean} [observations.dryingInProgress]
 * @param {string} [observations.visibleDirt]
 * @param {boolean} [observations.cleanAndGlossy]
 * @param {string} [observations.observationNotes]
 * @param {string} [modelPhase] - Secondary phase guessed directly by the model
 * @param {number} [modelConfidence=0.8] - Confidence returned by the model
 * @returns {{
 *   phase: string,
 *   confidence: number,
 *   source: "rules" | "model",
 *   reason: string
 * }}
 */
function derivePhase(observations, modelPhase, modelConfidence = 0.8) {
  const safeConfidence = typeof modelConfidence === 'number' && !isNaN(modelConfidence)
    ? modelConfidence
    : 0.8;

  if (observations && typeof observations === 'object') {
    const {
      soapFoamVisible,
      waterOnCar,
      dryingInProgress,
      visibleDirt,
      cleanAndGlossy,
    } = observations;

    // 1. soapFoamVisible -> LAVADO (Foam takes absolute precedence)
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

    // 3. waterOnCar && !dryingInProgress -> REMOJO
    if (waterOnCar === true && dryingInProgress === false) {
      return {
        phase: PHASE_REMOJO,
        confidence: Math.min(safeConfidence, 0.95),
        source: 'rules',
        reason: 'Water is present on the vehicle with no foam and drying is not in progress (pre-rinse/rinse stage)',
      };
    }

    // 4. !waterOnCar && visibleDirt === "none" && cleanAndGlossy -> LISTO
    if (waterOnCar === false && visibleDirt === 'none' && cleanAndGlossy === true) {
      return {
        phase: PHASE_LISTO,
        confidence: Math.min(safeConfidence, 0.95),
        source: 'rules',
        reason: 'Vehicle is completely dry, clean with no visible dirt, and has a glossy reflective finish',
      };
    }

    // 5. !waterOnCar && (visibleDirt is "light" or "heavy") && !cleanAndGlossy -> PENDIENTE
    if (
      waterOnCar === false &&
      (visibleDirt === 'light' || visibleDirt === 'heavy') &&
      cleanAndGlossy === false
    ) {
      return {
        phase: PHASE_PENDIENTE,
        confidence: Math.min(safeConfidence, 0.95),
        source: 'rules',
        reason: 'Vehicle is dry with visible dirt or road grime and is not clean/glossy (awaiting wash cycle)',
      };
    }
  }

  // 6. Contradictory, ambiguous, or missing observations -> fallback to model's own phase capped at 0.7
  const fallbackPhase = VALID_PHASES.includes(modelPhase) ? modelPhase : PHASE_PENDIENTE;
  return {
    phase: fallbackPhase,
    confidence: Math.min(safeConfidence, 0.7),
    source: 'model',
    reason: 'Observations are ambiguous or contradictory; defaulted to model estimate with confidence capped at 0.7',
  };
}

module.exports = {
  derivePhase,
  PHASE_PENDIENTE,
  PHASE_REMOJO,
  PHASE_LAVADO,
  PHASE_SECADO,
  PHASE_LISTO,
};
