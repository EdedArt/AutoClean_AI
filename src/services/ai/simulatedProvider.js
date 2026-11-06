const {
  VALID_PHASES,
  NEXT_PHASE_MAP,
  MIN_PHASE_TIME_RATIO,
  doesOrderIncludePolichado,
  getEstimatedDurationForPhase,
  getNextPhase,
} = require('../simulation.service');
const { decidePhase } = require('./phaseRules');

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
 *   polishingInProgress: boolean,
 *   waxOrPolishVisible: boolean,
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
        polishingInProgress: false,
        waxOrPolishVisible: false,
        visibleDirt: dirtLevel === 'Severo' ? 'heavy' : 'light',
        cleanAndGlossy: false,
        observationNotes: 'Vehicle parked in bay, dry surface with visible dust and road dirt',
      };
    case 'REMOJO':
      return {
        soapFoamVisible: false,
        waterOnCar: true,
        dryingInProgress: false,
        polishingInProgress: false,
        waxOrPolishVisible: false,
        visibleDirt: 'light',
        cleanAndGlossy: false,
        observationNotes: 'Vehicle being pre-rinsed with water spray, wet surface with no soap foam',
      };
    case 'LAVADO':
      return {
        soapFoamVisible: true,
        waterOnCar: true,
        dryingInProgress: false,
        polishingInProgress: false,
        waxOrPolishVisible: false,
        visibleDirt: 'none',
        cleanAndGlossy: false,
        observationNotes: 'Vehicle covered in thick shampoo foam and active scrubbing',
      };
    case 'SECADO':
      return {
        soapFoamVisible: false,
        waterOnCar: true,
        dryingInProgress: true,
        polishingInProgress: false,
        waxOrPolishVisible: false,
        visibleDirt: 'none',
        cleanAndGlossy: false,
        observationNotes: 'Vehicle rinsed and damp, drying actively in progress with cloths and blowers',
      };
    case 'POLICHADO':
      return {
        soapFoamVisible: false,
        waterOnCar: false,
        dryingInProgress: false,
        polishingInProgress: true,
        waxOrPolishVisible: true,
        visibleDirt: 'none',
        cleanAndGlossy: false,
        observationNotes:
          'Dry vehicle surface with opaque white polishing paste/wax applied in small zones and operator buffing with polisher and microfiber cloth',
      };
    case 'LISTO':
    default:
      return {
        soapFoamVisible: false,
        waterOnCar: false,
        dryingInProgress: false,
        polishingInProgress: false,
        waxOrPolishVisible: false,
        visibleDirt: 'none',
        cleanAndGlossy: true,
        observationNotes:
          'Vehicle clean, dry, and glossy with uniform reflective paint finish and no wax paste residue',
      };
  }
}

/**
 * Deterministically simulates AI vision analysis of a car wash camera frame.
 * Respects minimum realistic phase duration (70% of estimated phase time) before
 * recommending an automatic phase advance.
 *
 * @param {object} params
 * @param {Buffer} [params.buffer]
 * @param {string} [params.mimeType]
 * @param {string} params.expectedPlate - Expected license plate of the order
 * @param {string} [params.currentPhase="PENDIENTE"] - Current phase of the service order
 * @param {number|string} [params.orderId=1] - ID of the service order
 * @param {string} [params.scenario] - Optional demo scenario: "wrong_vehicle" | "unreadable" | "regression" | "low_confidence" | "polichado"
 * @param {boolean} [params.incluyePolichado] - Whether the order's package includes polichado
 * @param {object} [params.order] - Optional order object with package and phaseEvents/updatedAt
 * @param {Date|string|number} [params.lastPhaseChangeAt] - Timestamp when current phase started
 * @param {Date|string|number} [params.now] - Optional current timestamp override for testing
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
 *   advanced: boolean,
 *   reason?: string,
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
  incluyePolichado: rawIncluyePolichado,
  order,
  lastPhaseChangeAt,
  now,
} = {}) {
  const idNum = Number(orderId) || 1;
  const normalizedScenario = typeof scenario === 'string' ? scenario.toLowerCase() : scenario;
  const incluyePolichado = Boolean(
    rawIncluyePolichado ||
      doesOrderIncludePolichado(order) ||
      normalizedScenario === 'polichado' ||
      currentPhase === 'POLICHADO'
  );

  const activeSequence = incluyePolichado
    ? VALID_PHASES
    : VALID_PHASES.filter((p) => p !== 'POLICHADO');
  const phaseIdx = activeSequence.indexOf(currentPhase);
  const safePhaseIdx = phaseIdx >= 0 ? phaseIdx : 0;
  const nextPhase =
    getNextPhase(currentPhase, { incluyePolichado }) || NEXT_PHASE_MAP[currentPhase] || 'LISTO';

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

  // Check if minimum phase duration (70% of estimated duration) has elapsed
  // Exceptions: PENDIENTE -> REMOJO is always immediate
  const resolvedLastChange =
    lastPhaseChangeAt ??
    order?.lastPhaseChangeAt ??
    (order?.phaseEvents && order.phaseEvents.length > 0 ? order.phaseEvents[0].createdAt : undefined) ??
    order?.updatedAt ??
    order?.createdAt;

  let minTimeNotReached = false;
  if (
    currentPhase !== 'PENDIENTE' &&
    currentPhase !== 'LISTO' &&
    resolvedLastChange !== undefined &&
    resolvedLastChange !== null
  ) {
    const nowMs = now !== undefined ? new Date(now).getTime() : Date.now();
    const lastChangeMs = new Date(resolvedLastChange).getTime();
    const minRequiredMs = getEstimatedDurationForPhase(currentPhase) * MIN_PHASE_TIME_RATIO;

    if (!isNaN(lastChangeMs) && nowMs - lastChangeMs < minRequiredMs) {
      minTimeNotReached = true;
    }
  }

  // Demo scenarios (honored ONLY by simulated provider)
  if (normalizedScenario === 'wrong_vehicle') {
    rawPlate = expectedPlate && expectedPlate.toUpperCase() === 'ZZZ-999' ? 'WRG-000' : 'ZZZ-999';
    rawPlateConf = 0.95;
    scenarioNote = 'Simulated vision analysis (scenario: wrong_vehicle)';
  } else if (normalizedScenario === 'unreadable') {
    rawPlate = null;
    rawPlateConf = 0.0;
    scenarioNote = 'Simulated vision analysis (scenario: unreadable)';
  } else if (normalizedScenario === 'regression') {
    const earlierIdx = Math.max(0, safePhaseIdx - 1);
    targetPhase = activeSequence[earlierIdx];
    rawPlateConf = 0.94;
    rawPhaseConf = 0.92;
    scenarioNote = 'Simulated vision analysis (scenario: regression)';
  } else if (normalizedScenario === 'low_confidence') {
    rawPlateConf = 0.90;
    rawPhaseConf = 0.40; // Below default 0.6 threshold
    scenarioNote = 'Simulated vision analysis (scenario: low_confidence)';
  } else if (normalizedScenario === 'polichado') {
    targetPhase = minTimeNotReached ? currentPhase : 'POLICHADO';
    scenarioNote = minTimeNotReached
      ? `Simulated vision analysis (scenario: polichado - phase ${currentPhase} still in progress, MIN_TIME_NOT_REACHED)`
      : 'Simulated vision analysis (scenario: polichado)';
  } else if (minTimeNotReached) {
    // Phase has not reached 70% of its estimated duration: keep current phase in progress
    targetPhase = currentPhase;
    scenarioNote = `Simulated vision analysis (phase ${currentPhase} still in progress, MIN_TIME_NOT_REACHED)`;
  }

  const observations = getObservationsForPhase(targetPhase, dirtLevel);
  const derived = decidePhase(observations, {
    currentPhase,
    incluyePolichado,
    modelPhase: targetPhase,
    modelConfidence: rawPhaseConf,
  });

  const advanced = derived.phase !== currentPhase && !minTimeNotReached;
  const notesWithReason = `${scenarioNote} [Phase: ${derived.phase} via ${derived.source} - ${derived.reason}]`;

  const response = {
    plateDetected: rawPlate,
    plateConfidence: rawPlateConf,
    observations,
    phase: derived.phase,
    phaseConfidence: derived.confidence,
    modelPhase: targetPhase,
    modelPhaseConfidence: rawPhaseConf,
    phaseSource: derived.source,
    phaseReason: derived.reason,
    advanced,
    dirtLevel,
    notes: notesWithReason,
  };

  if (minTimeNotReached) {
    response.reason = 'MIN_TIME_NOT_REACHED';
  }

  return response;
}

module.exports = {
  analyzeImage,
  getDeterministicConfidence,
  getObservationsForPhase,
};
