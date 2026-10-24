const { VALID_PHASES, NEXT_PHASE_MAP } = require('../simulation.service');
const { decidePhase, derivePhase } = require('./phaseRules');

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
 * Generates plausible physical observations consistent with a target wash phase.
 *
 * @param {string} phase
 * @param {string} [dirtLevel="Moderado"]
 * @returns {{
 *   soapFoamVisible: boolean,
 *   waterOnCar: boolean,
 *   dryingInProgress: boolean,
 *   visibleDirt: "none"|"light"|"heavy",
 *   cleanAndGlossy: boolean,
 *   observationNotes: string
 * }}
 */
function getObservationsForPhase(phase, dirtLevel = 'Moderado') {
  switch (phase) {
    case 'PENDIENTE':
      return {
        soapFoamVisible: false,
        waterOnCar: false,
        dryingInProgress: false,
        visibleDirt: dirtLevel === 'Severo' ? 'heavy' : 'light',
        cleanAndGlossy: false,
        observationNotes: 'Vehicle parked in bay, dry surface with visible dust and road dirt',
      };
    case 'REMOJO':
      return {
        soapFoamVisible: false,
        waterOnCar: true,
        dryingInProgress: false,
        visibleDirt: 'light',
        cleanAndGlossy: false,
        observationNotes: 'Vehicle being pre-rinsed with water spray, wet surface with no soap foam',
      };
    case 'LAVADO':
      return {
        soapFoamVisible: true,
        waterOnCar: true,
        dryingInProgress: false,
        visibleDirt: 'none',
        cleanAndGlossy: false,
        observationNotes: 'Vehicle covered in thick shampoo foam and active scrubbing',
      };
    case 'SECADO':
      return {
        soapFoamVisible: false,
        waterOnCar: true,
        dryingInProgress: true,
        visibleDirt: 'none',
        cleanAndGlossy: false,
        observationNotes: 'Vehicle rinsed and damp, drying actively in progress with cloths and blowers',
      };
    case 'LISTO':
    default:
      return {
        soapFoamVisible: false,
        waterOnCar: false,
        dryingInProgress: false,
        visibleDirt: 'none',
        cleanAndGlossy: true,
        observationNotes: 'Vehicle clean and dry with uniform, glossy reflective paint finish',
      };
  }
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
 *   observations: object,
 *   phase: string,
 *   phaseConfidence: number,
 *   modelPhase: string,
 *   modelPhaseConfidence: number,
 *   phaseSource: "rules"|"model",
 *   phaseReason: string,
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

  let rawPlate = expectedPlate || 'ABC-123';
  let rawPlateConf = plateConfidence;
  let targetPhase = nextPhase;
  let rawPhaseConf = phaseConfidence;
  let scenarioNote = 'Deterministic simulated vision analysis';

  // Demo scenarios (honored ONLY by simulated provider)
  if (scenario === 'wrong_vehicle') {
    rawPlate = (expectedPlate && expectedPlate.toUpperCase() === 'ZZZ-999')
      ? 'WRG-000'
      : 'ZZZ-999';
    rawPlateConf = 0.95;
    scenarioNote = 'Simulated vision analysis (scenario: wrong_vehicle)';
  } else if (scenario === 'unreadable') {
    rawPlate = null;
    rawPlateConf = 0.0;
    scenarioNote = 'Simulated vision analysis (scenario: unreadable)';
  } else if (scenario === 'regression') {
    const earlierIdx = Math.max(0, safePhaseIdx - 1);
    targetPhase = VALID_PHASES[earlierIdx];
    rawPlateConf = 0.94;
    rawPhaseConf = 0.92;
    scenarioNote = 'Simulated vision analysis (scenario: regression)';
  } else if (scenario === 'low_confidence') {
    rawPlateConf = 0.90;
    rawPhaseConf = 0.40; // Below default 0.6 threshold
    scenarioNote = 'Simulated vision analysis (scenario: low_confidence)';
  }

  const observations = getObservationsForPhase(targetPhase, dirtLevel);
  const derived = decidePhase(observations, {
    currentPhase,
    modelPhase: targetPhase,
    modelConfidence: rawPhaseConf,
  });

  const notesWithReason = `${scenarioNote} [Phase: ${derived.phase} via ${derived.source} - ${derived.reason}]`;

  return {
    plateDetected: rawPlate,
    plateConfidence: rawPlateConf,
    observations,
    phase: derived.phase,
    phaseConfidence: derived.confidence,
    modelPhase: targetPhase,
    modelPhaseConfidence: rawPhaseConf,
    phaseSource: derived.source,
    phaseReason: derived.reason,
    dirtLevel,
    notes: notesWithReason,
  };
}

module.exports = {
  analyzeImage,
  getDeterministicConfidence,
  getObservationsForPhase,
};

