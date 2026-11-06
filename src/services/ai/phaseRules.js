const { VALID_PHASES, doesOrderIncludePolichado } = require('../simulation.service');

// Reference valid phase names directly from VALID_PHASES to avoid redefining
const PHASE_PENDIENTE = VALID_PHASES.find((p) => p === 'PENDIENTE') || 'PENDIENTE';
const PHASE_REMOJO = VALID_PHASES.find((p) => p === 'REMOJO') || 'REMOJO';
const PHASE_LAVADO = VALID_PHASES.find((p) => p === 'LAVADO') || 'LAVADO';
const PHASE_SECADO = VALID_PHASES.find((p) => p === 'SECADO') || 'SECADO';
const PHASE_POLICHADO = VALID_PHASES.find((p) => p === 'POLICHADO') || 'POLICHADO';
const PHASE_LISTO = VALID_PHASES.find((p) => p === 'LISTO') || 'LISTO';

/**
 * Derives the verified wash phase from objective physical observations and order context
 * using a deterministic context-aware decision table.
 *
 * Visual key for POLICHADO vs LAVADO/ENJABONADO:
 * - POLICHADO = dry car + opaque white wax/paste compound (not airy foam) +
 *   operator buffing with microfiber cloth or rotary polisher in small zones.
 * - LAVADO/ENJABONADO = wet car + airy soap foam with bubbles + running water + wide coverage.
 *
 * Transitions with POLICHADO:
 * - If currentPhase is SECADO and package includes polichado:
 *   - If signs of polishing are detected (dry car + white paste/wax or polishing activity) -> POLICHADO.
 *   - Never jump directly from SECADO to LISTO when package includes polichado.
 * - If currentPhase is POLICHADO:
 *   - If signs that polishing finished (dry, clean, glossy, no paste residue) -> LISTO.
 *   - If polishing is still active -> keep POLICHADO.
 * - LISTO is only reached from POLICHADO (when package includes polichado) or from SECADO (when it does not).
 *
 * @param {object} [observations]
 * @param {boolean} [observations.soapFoamVisible]
 * @param {boolean} [observations.waterOnCar]
 * @param {boolean} [observations.dryingInProgress]
 * @param {boolean} [observations.polishingInProgress]
 * @param {boolean} [observations.waxOrPolishVisible]
 * @param {string} [observations.visibleDirt]
 * @param {boolean} [observations.cleanAndGlossy]
 * @param {string} [observations.observationNotes]
 * @param {object|string} [context={}] - Context object e.g. { currentPhase, incluyePolichado } or legacy string modelPhase
 * @param {string} [context.currentPhase]
 * @param {boolean} [context.incluyePolichado]
 * @param {object} [context.package]
 * @param {object} [context.paquete]
 * @param {object} [context.order]
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
  let incluyePolichado = false;

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
    currentPhase = context.currentPhase || context.order?.faseActual || null;
    modelPhase = context.modelPhase || (typeof maybeModelPhase === 'string' ? maybeModelPhase : null);
    incluyePolichado = Boolean(
      doesOrderIncludePolichado(context) ||
        doesOrderIncludePolichado(context.order) ||
        doesOrderIncludePolichado(context.package) ||
        doesOrderIncludePolichado(context.paquete) ||
        currentPhase === PHASE_POLICHADO
    );
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

  if (currentPhase === PHASE_POLICHADO) {
    incluyePolichado = true;
  }

  const safeConfidence =
    typeof modelConfidence === 'number' && !isNaN(modelConfidence) ? modelConfidence : 0.8;

  if (observations && typeof observations === 'object') {
    const {
      soapFoamVisible,
      waterOnCar,
      dryingInProgress,
      visibleDirt,
      cleanAndGlossy,
      observationNotes,
    } = observations;

    const explicitPolishingTrue =
      observations.polishingInProgress === true ||
      observations.waxOrPolishVisible === true ||
      observations.polishCompoundVisible === true ||
      observations.whitePasteVisible === true ||
      observations.waxPasteVisible === true ||
      observations.polichadoInProgress === true ||
      observations.buffingInProgress === true;

    const explicitPolishingFalse =
      observations.polishingInProgress === false &&
      observations.waxOrPolishVisible !== true &&
      observations.polishCompoundVisible !== true &&
      observations.whitePasteVisible !== true &&
      observations.waxPasteVisible !== true &&
      observations.polichadoInProgress !== true &&
      observations.buffingInProgress !== true;

    const notesStr = typeof observationNotes === 'string' ? observationNotes : '';
    const notesIndicatePolishing =
      /(?:polichad|polish|cera blanca|pasta blanca|wax paste|pulidora|buffing|frotando con pa[ñn]o)/i.test(
        notesStr
      ) && !/(?:sin residuos|terminado|finalizado|completed|no wax|no paste|free of)/i.test(notesStr);

    const hasPolishingSignals = explicitPolishingTrue || notesIndicatePolishing;

    // 1. soapFoamVisible -> LAVADO (wet airy soap foam wins over everything; do not confuse with dry polishing paste)
    if (soapFoamVisible === true && !(waterOnCar === false && hasPolishingSignals)) {
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
        reason:
          'Vehicle has water and drying process (microfiber towels/cloths/air blowers) is actively in progress',
      };
    }

    // 3. waterOnCar && !dryingInProgress (no foam) -> REMOJO
    if (waterOnCar === true && dryingInProgress === false) {
      return {
        phase: PHASE_REMOJO,
        confidence: Math.min(safeConfidence, 0.95),
        source: 'rules',
        reason:
          'Water is present on the vehicle with no foam and drying is not in progress (pre-rinse/rinse stage)',
      };
    }

    // 4. Dry car (no wet soap foam, no water, not drying water):
    if (
      (soapFoamVisible === false || (waterOnCar === false && hasPolishingSignals)) &&
      waterOnCar === false &&
      dryingInProgress === false
    ) {
      // 4a. Current phase is SECADO and package includes POLICHADO:
      // Must NEVER jump directly from SECADO to LISTO when package includes polichado.
      if (currentPhase === PHASE_SECADO && incluyePolichado) {
        if (
          hasPolishingSignals ||
          modelPhase === PHASE_POLICHADO ||
          (!explicitPolishingFalse && cleanAndGlossy === false)
        ) {
          return {
            phase: PHASE_POLICHADO,
            confidence: Math.min(safeConfidence, 0.95),
            source: 'rules',
            reason:
              'dry car after SECADO with opaque white wax/paste or polishing activity -> POLICHADO',
          };
        }

        // Dry car in SECADO (e.g. cleanAndGlossy=true before polishing starts): do NOT jump to LISTO
        return {
          phase: PHASE_SECADO,
          confidence: Math.min(safeConfidence, 0.95),
          source: 'rules',
          reason:
            'dry car in SECADO with polichado package but no polishing paste detected yet -> keep SECADO (never skip POLICHADO to LISTO)',
        };
      }

      // 4b. Current phase is POLICHADO:
      // Advance to LISTO only when polishing is finished (clean, glossy, no paste residue).
      if (currentPhase === PHASE_POLICHADO) {
        if (hasPolishingSignals) {
          return {
            phase: PHASE_POLICHADO,
            confidence: Math.min(safeConfidence, 0.95),
            source: 'rules',
            reason: 'dry car in POLICHADO with wax/paste still visible -> keep POLICHADO',
          };
        }

        return {
          phase: PHASE_LISTO,
          confidence: Math.min(safeConfidence, 0.95),
          source: 'rules',
          reason: 'dry clean and glossy car after POLICHADO with no paste residue -> LISTO',
        };
      }

      // 4c. Current phase is SECADO (without polichado) or LISTO -> LISTO
      if ((currentPhase === PHASE_SECADO && !incluyePolichado) || currentPhase === PHASE_LISTO) {
        return {
          phase: PHASE_LISTO,
          confidence: Math.min(safeConfidence, 0.95),
          source: 'rules',
          reason: `dry car after ${currentPhase} -> LISTO`,
        };
      }

      // 4d. if currentPhase is PENDIENTE, REMOJO or LAVADO -> keep currentPhase
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

      // 4e. if there is no currentPhase (smoke script / no order context) -> PENDIENTE
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
          reason:
            'dry car without order context -> PENDIENTE with lower confidence (never LISTO without context)',
        };
      }
    }
  }

  // 5. Anything ambiguous / contradictory -> fallback to model's own phase capped at 0.7
  let fallbackPhase = VALID_PHASES.includes(modelPhase) ? modelPhase : PHASE_PENDIENTE;

  // Enforce transition guards on fallbackPhase:
  // - Only reach LISTO from POLICHADO (if incluyePolichado) or from SECADO (if not incluyePolichado), or if already LISTO
  const canReachListo =
    currentPhase === PHASE_LISTO ||
    currentPhase === PHASE_POLICHADO ||
    (currentPhase === PHASE_SECADO && !incluyePolichado);

  if (fallbackPhase === PHASE_LISTO && !canReachListo) {
    if (currentPhase === PHASE_SECADO && incluyePolichado) {
      fallbackPhase = PHASE_SECADO;
    } else {
      fallbackPhase =
        currentPhase && VALID_PHASES.includes(currentPhase) ? currentPhase : PHASE_PENDIENTE;
    }
  }

  if (
    fallbackPhase === PHASE_POLICHADO &&
    (!incluyePolichado || (currentPhase !== PHASE_SECADO && currentPhase !== PHASE_POLICHADO))
  ) {
    fallbackPhase =
      currentPhase && VALID_PHASES.includes(currentPhase) ? currentPhase : PHASE_PENDIENTE;
  }

  return {
    phase: fallbackPhase,
    confidence: Math.min(safeConfidence, 0.7),
    source: 'model',
    reason:
      'Observations are ambiguous or contradictory; defaulted to model estimate with confidence capped at 0.7',
  };
}

module.exports = {
  decidePhase,
  derivePhase: decidePhase,
  PHASE_PENDIENTE,
  PHASE_REMOJO,
  PHASE_LAVADO,
  PHASE_SECADO,
  PHASE_POLICHADO,
  PHASE_LISTO,
};
