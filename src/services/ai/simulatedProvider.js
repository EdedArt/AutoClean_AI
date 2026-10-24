const { VALID_PHASES, NEXT_PHASE_MAP } = require('../simulation.service');

/**
 * Calculates a deterministic confidence score in [0.85, 0.97].
 *
 * @param {number|string} orderId
 * @param {string} currentPhase
 * @param {number} salt
 * @returns {number}
 */
function getDeterministicConfidence(orderId, currentPhase, salt = 0) {
  const phaseIndex = VALID_PHASES.indexOf(currentPhase);
  const idNum = Number(orderId) || 1;
  const seed = idNum * 37 + (phaseIndex + 1) * 19 + salt * 7;
  // Modulo 120 yields a value between 0 and 119 -> mapped to [0.85, 0.97]
  const offset = (seed % 120) / 1000;
  return Number((0.85 + offset).toFixed(2));
}

/**
 * Deterministically simulates AI vision analysis of a car wash camera frame.
 *
 * @param {object} params
 * @param {Buffer} [params.buffer]
 * @param {string} [params.mimeType]
 * @param {string} params.expectedPlate - Expected license plate of the order
 * @param {string} [params.currentPhase="PENDIENTE"] - Current phase of the service order
 * @param {number|string} [params.orderId=1] - ID of the service order
 * @param {string} [params.scenario] - Optional demo scenario: "wrong_vehicle" | "unreadable" | "regression" | "low_confidence"
 * @returns {Promise<{
 *   plateDetected: string|null,
 *   plateConfidence: number,
 *   phase: string,
 *   phaseConfidence: number,
 *   dirtLevel: string|null,
 *   notes: string
 * }>}
 */
async function analyzeImage({
  buffer,
  mimeType,
  expectedPlate,
  currentPhase = 'PENDIENTE',
  orderId = 1,
  scenario,
}) {
  const idNum = Number(orderId) || 1;
  const phaseIdx = VALID_PHASES.indexOf(currentPhase);
  const safePhaseIdx = phaseIdx >= 0 ? phaseIdx : 0;
  const nextPhase = NEXT_PHASE_MAP[currentPhase] || 'LISTO';

  // Base deterministic values
  const plateConfidence = getDeterministicConfidence(idNum, currentPhase, 1);
  const phaseConfidence = getDeterministicConfidence(idNum, currentPhase, 2);
  const dirtLevels = ['Leve', 'Moderado', 'Severo'];
  const dirtLevel = dirtLevels[idNum % 3];

  // Demo scenarios (honored ONLY by simulated provider)
  if (scenario === 'wrong_vehicle') {
    const wrongPlate = (expectedPlate && expectedPlate.toUpperCase() === 'ZZZ-999')
      ? 'WRG-000'
      : 'ZZZ-999';

    return {
      plateDetected: wrongPlate,
      plateConfidence: 0.95,
      phase: nextPhase,
      phaseConfidence,
      dirtLevel,
      notes: 'Simulated vision analysis (scenario: wrong_vehicle)',
    };
  }

  if (scenario === 'unreadable') {
    return {
      plateDetected: null,
      plateConfidence: 0.0,
      phase: nextPhase,
      phaseConfidence,
      dirtLevel,
      notes: 'Simulated vision analysis (scenario: unreadable)',
    };
  }

  if (scenario === 'regression') {
    // Earlier phase than current, or stay at PENDIENTE if already at first phase
    const earlierIdx = Math.max(0, safePhaseIdx - 1);
    const earlierPhase = VALID_PHASES[earlierIdx];

    return {
      plateDetected: expectedPlate || 'ABC-123',
      plateConfidence: 0.94,
      phase: earlierPhase,
      phaseConfidence: 0.92,
      dirtLevel,
      notes: 'Simulated vision analysis (scenario: regression)',
    };
  }

  if (scenario === 'low_confidence') {
    return {
      plateDetected: expectedPlate || 'ABC-123',
      plateConfidence: 0.90,
      phase: nextPhase,
      phaseConfidence: 0.40, // Below default 0.6 threshold
      dirtLevel,
      notes: 'Simulated vision analysis (scenario: low_confidence)',
    };
  }

  // Default behavior: matches expected plate and advances to next phase
  return {
    plateDetected: expectedPlate || 'ABC-123',
    plateConfidence,
    phase: nextPhase,
    phaseConfidence,
    dirtLevel,
    notes: 'Deterministic simulated vision analysis',
  };
}

module.exports = {
  analyzeImage,
  getDeterministicConfidence,
};
